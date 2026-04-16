import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, matchesKey, visibleWidth, type Component, type Focusable } from "@mariozechner/pi-tui";
import { WorkbenchSupervisor } from "../orchestration/supervisor.js";
import type { WorkbenchDetailViewMode, WorkbenchSession } from "../types/workbench.js";
import { renderOverviewLines } from "./overview.js";
import { renderSessionDetailLines } from "./session-detail.js";

const MIN_WIDTH = 72;

export async function showWorkbenchDashboard(ctx: ExtensionCommandContext, supervisor: WorkbenchSupervisor): Promise<void> {
  await supervisor.initialize();
  await supervisor.openWorkbench();

  let unregister = () => {};

  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const dashboard = new WorkbenchDashboard(tui, theme, ctx, supervisor, () => {
        unregister();
        done();
      });
      unregister = supervisor.onChange(() => {
        dashboard.invalidate();
        tui.requestRender();
      });
      return dashboard;
    },
    {
      overlay: true,
      overlayOptions: {
        width: "92%",
        maxHeight: "92%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}

type InputMode =
  | { kind: "none" }
  | { kind: "spawn"; value: string; cursor: number }
  | { kind: "steer"; sessionId: string; value: string; cursor: number }
  | { kind: "followup"; sessionId: string; value: string; cursor: number }
  | { kind: "shell"; sessionId: string; value: string; cursor: number }
  | { kind: "rename"; sessionId: string; value: string; cursor: number }
  | { kind: "tags"; sessionId: string; value: string; cursor: number }
  | { kind: "abort"; sessionId: string };

type EditableInputMode = Exclude<InputMode, { kind: "none" } | { kind: "abort" }>;

class WorkbenchDashboard implements Component, Focusable {
  focused = false;
  private busy = false;
  private inputMode: InputMode = { kind: "none" };
  private detailViewMode: WorkbenchDetailViewMode;
  private transcriptOffset = 0;
  private readonly transcriptWindow = 8;

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly ctx: ExtensionCommandContext,
    private readonly supervisor: WorkbenchSupervisor,
    private readonly done: () => void,
  ) {
    this.detailViewMode = supervisor.registry.getState().preferences.detailViewMode;
  }

  handleInput(data: string): void {
    if (this.inputMode.kind !== "none") {
      this.handleInputMode(data);
      return;
    }

    if (matchesKey(data, "escape") || data === "q") {
      this.done();
      return;
    }
    if ((this.detailViewMode === "transcript" || this.detailViewMode === "log") && data === "J") {
      this.transcriptOffset += this.transcriptWindow;
      this.tui.requestRender();
      return;
    }
    if ((this.detailViewMode === "transcript" || this.detailViewMode === "log") && data === "K") {
      this.transcriptOffset = Math.max(0, this.transcriptOffset - this.transcriptWindow);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "up") || data === "k") {
      if (this.detailViewMode === "transcript" || this.detailViewMode === "log") {
        this.transcriptOffset = Math.max(0, this.transcriptOffset - 1);
      } else {
        void this.supervisor.selectNextSession(-1);
        this.transcriptOffset = 0;
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      if (this.detailViewMode === "transcript" || this.detailViewMode === "log") {
        this.transcriptOffset += 1;
      } else {
        void this.supervisor.selectNextSession(1);
        this.transcriptOffset = 0;
      }
      this.tui.requestRender();
      return;
    }
    if (data === "r") {
      this.tui.requestRender();
      return;
    }
    if (data === "n") {
      this.beginSpawn();
      return;
    }
    if (data === "a") {
      this.beginAbort();
      return;
    }
    if (data === "s") {
      this.beginSteer();
      return;
    }
    if (data === "f") {
      this.beginFollowUp();
      return;
    }
    if (data === "!") {
      this.beginShellCommand();
      return;
    }
    if (data === "e") {
      this.beginRename();
      return;
    }
    if (data === "t") {
      this.beginTags();
      return;
    }
    if (data === "p") {
      void this.togglePinnedSummary();
      return;
    }
    if (data === "P") {
      void this.replacePinnedSummary();
      return;
    }
    if (data === "v") {
      this.detailViewMode = this.detailViewMode === "summary" ? "transcript" : "summary";
      this.transcriptOffset = 0;
      void this.supervisor.updatePreferences({ detailViewMode: this.detailViewMode });
      this.tui.requestRender();
      return;
    }
    if (data === "l") {
      this.detailViewMode = this.detailViewMode === "log" ? "summary" : "log";
      this.transcriptOffset = 0;
      void this.supervisor.updatePreferences({ detailViewMode: this.detailViewMode });
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const state = this.supervisor.registry.getState();
    const selected = this.supervisor.registry.getSelectedSession();
    const selectedActivities = selected ? this.supervisor.registry.getActivities(selected.id) : [];
    const transcriptLines = selected
      ? this.detailViewMode === "transcript"
        ? this.supervisor.getTranscriptLines(selected.id)
        : this.detailViewMode === "log"
          ? this.supervisor.getLogLines(selected.id)
          : this.supervisor.getTranscriptPreview(selected.id)
      : [];
    if (width < MIN_WIDTH) {
      return [
        fit(`${this.theme.fg("accent", "Jackdaw Workbench")} — terminal too narrow`, width),
        fit("Resize the terminal or widen the overlay to use the dashboard.", width),
      ];
    }

    const safeWidth = width;
    const innerWidth = safeWidth - 2;
    const leftWidth = Math.max(24, Math.floor(innerWidth * 0.34));
    const rightWidth = Math.max(24, innerWidth - leftWidth - 3);

    const overview = renderOverviewLines(state.sessions, state.selectedSessionId);
    const detail = renderSessionDetailLines(
      selected,
      selectedActivities,
      transcriptLines,
      this.detailViewMode,
      this.transcriptOffset,
      this.transcriptWindow,
      rightWidth - 2,
    );
    const status = this.busy ? this.theme.fg("warning", "busy") : this.theme.fg("success", "ready");
    const hints = this.renderHints();
    const detailTitle = getDetailPanelTitle(selected, this.detailViewMode);

    const leftLines = [
      `${this.supervisor.getProjectName()}`,
      `sessions ${state.sessions.length}`,
      "",
      ...overview,
    ];

    const rightLines = [
      `status ${status}`,
      "",
      ...detail,
    ];

    const bodyHeight = Math.max(leftLines.length, rightLines.length);
    const lines: string[] = [];

    lines.push(borderTop(innerWidth, this.theme));
    lines.push(frameLine(innerWidth, `${this.theme.fg("accent", "Jackdaw Workbench")} ${this.theme.fg("dim", "pi-native prototype")}`, this.theme));
    lines.push(frameLine(innerWidth, this.theme.fg("dim", hints), this.theme));
    lines.push(borderDivider(innerWidth, this.theme));
    lines.push(frameColumnsHeader(leftWidth, rightWidth, "Sessions", detailTitle, this.theme));
    lines.push(frameColumnsDivider(leftWidth, rightWidth, this.theme));

    for (let index = 0; index < bodyHeight; index++) {
      const left = leftLines[index] ?? "";
      const right = rightLines[index] ?? "";
      lines.push(frameColumns(leftWidth, rightWidth, left, right, this.theme));
    }

    lines.push(borderDivider(innerWidth, this.theme));
    lines.push(frameLine(innerWidth, hints, this.theme));
    lines.push(borderBottom(innerWidth, this.theme));

    if (this.inputMode.kind !== "none") {
      lines.push(renderInputOverlay(safeWidth, this.theme, this.inputMode, this.focused));
    }

    return lines.map((line) => ensureWidth(line, safeWidth));
  }

  invalidate(): void {}

  private beginSpawn(): void {
    if (this.busy) return;
    this.inputMode = { kind: "spawn", value: "", cursor: 0 };
    this.tui.requestRender();
  }

  private beginSteer(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    this.inputMode = { kind: "steer", sessionId: session.id, value: "", cursor: 0 };
    this.tui.requestRender();
  }

  private beginFollowUp(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    this.inputMode = { kind: "followup", sessionId: session.id, value: "", cursor: 0 };
    this.tui.requestRender();
  }

  private beginShellCommand(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    if (!this.supervisor.isManaged(session.id)) {
      this.ctx.ui.notify("Historical session is visible only. Reconnect first to run shell commands.", "info");
      this.tui.requestRender();
      return;
    }
    this.inputMode = { kind: "shell", sessionId: session.id, value: "", cursor: 0 };
    this.tui.requestRender();
  }

  private beginRename(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    this.inputMode = { kind: "rename", sessionId: session.id, value: session.name, cursor: session.name.length };
    this.tui.requestRender();
  }

  private beginTags(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    const value = session.tags.join(", ");
    this.inputMode = { kind: "tags", sessionId: session.id, value, cursor: value.length };
    this.tui.requestRender();
  }

  private beginAbort(): void {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;
    this.inputMode = { kind: "abort", sessionId: session.id };
    this.tui.requestRender();
  }

  private handleInputMode(data: string): void {
    if (matchesKey(data, "escape")) {
      this.inputMode = { kind: "none" };
      this.tui.requestRender();
      return;
    }

    if (this.inputMode.kind === "abort") {
      if (matchesKey(data, "return") || data === "y") {
        void this.confirmAbort(this.inputMode.sessionId);
        return;
      }
      if (data === "n") {
        this.inputMode = { kind: "none" };
        this.tui.requestRender();
      }
      return;
    }

    const mode = this.inputMode as EditableInputMode;

    if (matchesKey(data, "return")) {
      void this.submitInputMode();
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (mode.cursor > 0) {
        mode.value = mode.value.slice(0, mode.cursor - 1) + mode.value.slice(mode.cursor);
        mode.cursor--;
      }
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "left")) {
      mode.cursor = Math.max(0, mode.cursor - 1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "right")) {
      mode.cursor = Math.min(mode.value.length, mode.cursor + 1);
      this.tui.requestRender();
      return;
    }

    if (data.length === 1 && data >= " ") {
      mode.value = mode.value.slice(0, mode.cursor) + data + mode.value.slice(mode.cursor);
      mode.cursor += data.length;
      this.tui.requestRender();
    }
  }

  private async submitInputMode(): Promise<void> {
    if (this.inputMode.kind === "none" || this.inputMode.kind === "abort") return;

    const mode = this.inputMode;
    const text = mode.value.trim();
    if (!text) {
      this.inputMode = { kind: "none" };
      this.tui.requestRender();
      return;
    }

    this.busy = true;
    this.inputMode = { kind: "none" };
    this.tui.requestRender();

    try {
      if (mode.kind === "spawn") {
        await this.supervisor.spawnSession({
          cwd: this.ctx.cwd,
          task: text,
          tags: ["prototype"],
          model: this.ctx.model,
        });
      } else if (mode.kind === "steer") {
        const result = await this.supervisor.steerSession(mode.sessionId, text);
        this.ctx.ui.notify(result.notificationMessage, result.notificationLevel);
      } else if (mode.kind === "followup") {
        const result = await this.supervisor.followUpSession(mode.sessionId, text);
        this.ctx.ui.notify(result.notificationMessage, result.notificationLevel);
      } else if (mode.kind === "shell") {
        const ok = await this.supervisor.executeShellCommand(mode.sessionId, text);
        if (!ok) this.ctx.ui.notify("Selected session is not currently managed in-process", "error");
      } else if (mode.kind === "rename") {
        const ok = await this.supervisor.updateSessionMetadata(mode.sessionId, { name: text });
        if (!ok) this.ctx.ui.notify("Selected session could not be renamed", "error");
      } else if (mode.kind === "tags") {
        const tags = text
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        const ok = await this.supervisor.updateSessionMetadata(mode.sessionId, { tags });
        if (!ok) this.ctx.ui.notify("Selected session tags could not be updated", "error");
      }
    } finally {
      this.busy = false;
      this.tui.requestRender();
    }
  }

  private async confirmAbort(sessionId: string): Promise<void> {
    this.busy = true;
    this.inputMode = { kind: "none" };
    this.tui.requestRender();
    try {
      const result = await this.supervisor.abortSession(sessionId);
      this.ctx.ui.notify(result.notificationMessage, result.notificationLevel);
    } finally {
      this.busy = false;
      this.tui.requestRender();
    }
  }

  private renderHints(): string {
    const selectedSession = this.supervisor.registry.getSelectedSession();
    const shellActionHint = getShellActionHint(selectedSession, selectedSession ? this.supervisor.isManaged(selectedSession.id) : false);

    if (this.inputMode.kind === "spawn") {
      return this.theme.fg("warning", "New session task") + this.theme.fg("dim", " • Enter submit • Esc cancel");
    }
    if (this.inputMode.kind === "steer") {
      return this.theme.fg("warning", "Steering message") + this.theme.fg("dim", " • Enter queue • Esc cancel");
    }
    if (this.inputMode.kind === "followup") {
      return this.theme.fg("warning", "Follow-up message") + this.theme.fg("dim", " • Enter queue • Esc cancel");
    }
    if (this.inputMode.kind === "shell") {
      return this.theme.fg("warning", "One-off shell command") + this.theme.fg("dim", " • runs in selected session context • Enter run • Esc cancel");
    }
    if (this.inputMode.kind === "rename") {
      return this.theme.fg("warning", "Rename session") + this.theme.fg("dim", " • Enter save • Esc cancel");
    }
    if (this.inputMode.kind === "tags") {
      return this.theme.fg("warning", "Edit tags") + this.theme.fg("dim", " • comma separated • Enter save • Esc cancel");
    }
    if (this.inputMode.kind === "abort") {
      return this.theme.fg("warning", "Abort selected session?") + this.theme.fg("dim", " • y/Enter confirm • n/Esc cancel");
    }
    if (this.detailViewMode === "transcript") {
      return this.theme.fg(
        "dim",
        this.busy ? "Working…" : `v summary view • l log view • j/k scroll • J/K page • window 8 lines • ${shellActionHint} • n new • s steer • a abort • q close`,
      );
    }
    if (this.detailViewMode === "log") {
      return this.theme.fg(
        "dim",
        this.busy ? "Working…" : `l summary view • v transcript • j/k scroll • J/K page • window 8 lines • ${shellActionHint} • n new • s steer • a abort • q close`,
      );
    }
    return this.theme.fg(
      "dim",
      this.busy
        ? "Working…"
        : `↑/↓ or j/k select • v transcript • l log • ${shellActionHint} • n new • e rename • t tags • p pin/unpin • P refresh pin • s steer • f follow-up • a abort • q close`,
    );
  }

  private async togglePinnedSummary(): Promise<void> {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;

    await this.applyPinnedSummaryState(session.id, getPinnedSummaryToggleState(session));
  }

  private async replacePinnedSummary(): Promise<void> {
    const session = this.supervisor.registry.getSelectedSession();
    if (!session || this.busy) return;

    await this.applyPinnedSummaryState(session.id, getPinnedSummaryReplaceState(session));
  }

  private async applyPinnedSummaryState(sessionId: string, pinnedSummaryState: PinnedSummaryState): Promise<void> {
    if (pinnedSummaryState.kind === "noop") {
      this.ctx.ui.notify(pinnedSummaryState.notificationMessage, pinnedSummaryState.notificationLevel);
      this.tui.requestRender();
      return;
    }

    this.busy = true;
    this.tui.requestRender();
    try {
      const ok = await this.supervisor.updateSessionMetadata(sessionId, { pinnedSummary: pinnedSummaryState.nextPinnedSummary });
      if (!ok) {
        this.ctx.ui.notify("Selected session summary could not be updated", "error");
        return;
      }
      this.ctx.ui.notify(pinnedSummaryState.notificationMessage, pinnedSummaryState.notificationLevel);
    } finally {
      this.busy = false;
      this.tui.requestRender();
    }
  }
}

export interface PinnedSummaryState {
  kind: "pin" | "repin" | "unpin" | "noop";
  nextPinnedSummary?: string;
  notificationMessage: string;
  notificationLevel: "info";
}

export function getPinnedSummaryToggleState(session: WorkbenchSession): PinnedSummaryState {
  if (session.pinnedSummary) {
    return {
      kind: "unpin",
      nextPinnedSummary: undefined,
      notificationMessage: "Pinned summary removed",
      notificationLevel: "info",
    };
  }

  return getPinnedSummaryReplaceState(session);
}

export function getPinnedSummaryReplaceState(session: WorkbenchSession): PinnedSummaryState {
  const liveSummary = session.summary.trim();
  if (!liveSummary) {
    return {
      kind: "noop",
      notificationMessage: "No live summary available to pin",
      notificationLevel: "info",
    };
  }

  return {
    kind: session.pinnedSummary ? "repin" : "pin",
    nextPinnedSummary: liveSummary,
    notificationMessage: `${session.pinnedSummary ? "Pinned summary replaced" : "Pinned summary frozen"}: ${clipNotificationText(liveSummary)}`,
    notificationLevel: "info",
  };
}

export function getShellActionHint(session: WorkbenchSession | undefined, isManaged: boolean): string {
  if (!session) return "shell unavailable";
  if (!isManaged) return "shell disabled • reconnect first";
  return "! shell";
}

export function getDetailPanelTitle(
  session: WorkbenchSession | undefined,
  viewMode: WorkbenchDetailViewMode,
): string {
  const modeLabel =
    viewMode === "summary"
      ? "summary"
      : viewMode === "transcript"
        ? "transcript"
        : "log";

  if (!session) return `Selected session · none · ${modeLabel}`;
  return `Selected session · ${session.name} · ${modeLabel}`;
}

function borderTop(width: number, theme: Theme): string {
  return theme.fg("border", `╭${"─".repeat(width)}╮`);
}

function borderBottom(width: number, theme: Theme): string {
  return theme.fg("border", `╰${"─".repeat(width)}╯`);
}

function borderDivider(width: number, theme: Theme): string {
  return theme.fg("border", `├${"─".repeat(width)}┤`);
}

function frameLine(width: number, content: string, theme: Theme): string {
  return `${theme.fg("border", "│")}${fit(content, width)}${theme.fg("border", "│")}`;
}

function frameColumnsHeader(leftWidth: number, rightWidth: number, left: string, right: string, theme: Theme): string {
  return `${theme.fg("border", "│")}${fit(theme.fg("accent", left), leftWidth)} ${theme.fg("border", "│")} ${fit(theme.fg("accent", right), rightWidth)}${theme.fg("border", "│")}`;
}

function frameColumnsDivider(leftWidth: number, rightWidth: number, theme: Theme): string {
  return `${theme.fg("border", "│")}${theme.fg("border", "─".repeat(leftWidth))} ${theme.fg("border", "┆")} ${theme.fg("border", "─".repeat(rightWidth))}${theme.fg("border", "│")}`;
}

function frameColumns(leftWidth: number, rightWidth: number, left: string, right: string, theme: Theme): string {
  return `${theme.fg("border", "│")}${fit(left, leftWidth)} ${theme.fg("border", "│")} ${fit(right, rightWidth)}${theme.fg("border", "│")}`;
}

function ensureWidth(line: string, width: number): string {
  const visible = visibleWidth(line);
  if (visible >= width) return line;
  return `${line}${" ".repeat(width - visible)}`;
}

function renderInputOverlay(width: number, theme: Theme, mode: InputMode, focused: boolean): string {
  const innerWidth = Math.max(20, width - 2);

  if (mode.kind === "abort") {
    return frameLine(
      innerWidth,
      `${theme.fg("warning", "Abort selected session?")} ${theme.fg("dim", "Press y/Enter to confirm, n/Esc to cancel")}`,
      theme,
    );
  }

  const editableMode = mode as EditableInputMode;
  const label =
    editableMode.kind === "spawn"
      ? "Task"
      : editableMode.kind === "steer"
        ? "Steer"
        : editableMode.kind === "followup"
          ? "Follow-up"
          : editableMode.kind === "shell"
            ? "Shell"
            : editableMode.kind === "rename"
              ? "Name"
              : "Tags";

  const before = editableMode.value.slice(0, editableMode.cursor);
  const atCursor = editableMode.cursor < editableMode.value.length ? editableMode.value[editableMode.cursor] : " ";
  const after = editableMode.value.slice(editableMode.cursor + (editableMode.cursor < editableMode.value.length ? 1 : 0));
  const marker = focused ? CURSOR_MARKER : "";
  const input = `${before}${marker}\x1b[7m${atCursor}\x1b[27m${after}`;

  return frameLine(innerWidth, `${theme.fg("accent", `${label}:`)} ${input}`, theme);
}

function clipNotificationText(text: string, max = 48): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function fit(text: string, width: number): string {
  const clipped = clipVisible(text, width);
  const visible = visibleWidth(clipped);
  return `${clipped}${" ".repeat(Math.max(0, width - visible))}`;
}

function clipVisible(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;

  let result = "";
  let visible = 0;
  let inEscape = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    result += char;

    if (inEscape) {
      if ((char >= "@" && char <= "~") || char === "m") {
        inEscape = false;
      }
      continue;
    }

    if (char === "\u001b") {
      inEscape = true;
      continue;
    }

    visible += visibleWidth(char);
    if (visible >= Math.max(0, width - 1)) {
      break;
    }
  }

  return `${result}…`;
}
