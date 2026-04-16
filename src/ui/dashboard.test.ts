import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import type { WorkbenchDetailViewMode, WorkbenchSession, WorkbenchState } from "../types/workbench.js";
import { getDetailPanelTitle, getPinnedSummaryReplaceState, getPinnedSummaryToggleState, getShellActionHint, showWorkbenchDashboard } from "./dashboard.js";

function session(overrides: Partial<WorkbenchSession> = {}): WorkbenchSession {
  return {
    id: overrides.id ?? "s1",
    name: overrides.name ?? "Session 1",
    cwd: overrides.cwd ?? "/tmp/project",
    model: overrides.model ?? "gpt-5.4",
    taskLabel: overrides.taskLabel ?? "task",
    status: overrides.status ?? "idle",
    tags: overrides.tags ?? [],
    lastUpdateAt: overrides.lastUpdateAt ?? Date.now(),
    summary: overrides.summary ?? "summary",
    pinnedSummary: overrides.pinnedSummary,
    currentTool: overrides.currentTool,
    sessionFile: overrides.sessionFile,
    latestText: overrides.latestText,
    lastError: overrides.lastError,
    recentFiles: overrides.recentFiles,
    connectionState: overrides.connectionState,
    reconnectNote: overrides.reconnectNote,
    lastShellCommand: overrides.lastShellCommand,
    lastShellOutput: overrides.lastShellOutput,
    lastShellExitCode: overrides.lastShellExitCode,
    lastIntervention: overrides.lastIntervention,
  };
}

describe("getShellActionHint", () => {
  it("shows the shell shortcut for managed sessions", () => {
    expect(getShellActionHint(session(), true)).toBe("! shell");
  });

  it("shows reconnect guidance for historical sessions", () => {
    expect(getShellActionHint(session({ connectionState: "historical" }), false)).toBe("shell disabled • reconnect first");
  });
});

describe("getDetailPanelTitle", () => {
  it("includes the selected session name in summary mode", () => {
    expect(getDetailPanelTitle(session({ name: "Inventory pass" }), "summary")).toBe("Selected session · Inventory pass · summary");
  });

  it("reflects transcript and log modes", () => {
    expect(getDetailPanelTitle(session({ name: "Fix lint" }), "transcript")).toBe("Selected session · Fix lint · transcript");
    expect(getDetailPanelTitle(session({ name: "Fix lint" }), "log")).toBe("Selected session · Fix lint · log");
  });

  it("shows an explicit empty state when nothing is selected", () => {
    expect(getDetailPanelTitle(undefined, "summary")).toBe("Selected session · none · summary");
  });
});

describe("getPinnedSummaryToggleState", () => {
  it("pins the trimmed live summary instead of transient latest text", () => {
    expect(
      getPinnedSummaryToggleState(
        session({
          summary: "  Freeze this summary now  ",
          latestText: "transient streaming text",
        }),
      ),
    ).toMatchObject({
      kind: "pin",
      nextPinnedSummary: "Freeze this summary now",
      notificationMessage: "Pinned summary frozen: Freeze this summary now",
    });
  });

  it("unpins when a frozen snapshot already exists", () => {
    expect(
      getPinnedSummaryToggleState(
        session({
          summary: "New live summary",
          pinnedSummary: "Older frozen summary",
        }),
      ),
    ).toMatchObject({
      kind: "unpin",
      notificationMessage: "Pinned summary removed",
    });
  });

  it("re-pins by replacing the existing snapshot with the current live summary", () => {
    expect(
      getPinnedSummaryReplaceState(
        session({
          summary: "New live summary",
          pinnedSummary: "Older frozen summary",
        }),
      ),
    ).toMatchObject({
      kind: "repin",
      nextPinnedSummary: "New live summary",
      notificationMessage: "Pinned summary replaced: New live summary",
    });
  });

  it("returns a no-op when there is no live summary to pin", () => {
    expect(getPinnedSummaryToggleState(session({ summary: "   ", latestText: "still streaming" }))).toMatchObject({
      kind: "noop",
      notificationMessage: "No live summary available to pin",
    });
  });

  it("clips long pin notifications", () => {
    expect(
      getPinnedSummaryToggleState(
        session({
          summary: "This is a very long live summary that should be clipped in the confirmation message for the dashboard notification",
        }),
      ).notificationMessage,
    ).toBe("Pinned summary frozen: This is a very long live summary that should be…");
  });
});

describe("showWorkbenchDashboard intervention notifications", () => {
  it("surfaces steer notifications from the dashboard interaction layer", async () => {
    const notify = vi.fn();
    const steerSession = vi.fn().mockResolvedValue({
      ok: true,
      notificationMessage: "Steer accepted locally — pending observation",
      notificationLevel: "info",
    });
    const dashboard = await openDashboard({ notify, steerSession });

    dashboard.inputMode = {
      kind: "steer",
      sessionId: "s1",
      value: "Please focus on the flaky test",
      cursor: "Please focus on the flaky test".length,
    };

    await dashboard.submitInputMode();

    expect(steerSession).toHaveBeenCalledWith("s1", "Please focus on the flaky test");
    expect(notify).toHaveBeenCalledWith("Steer accepted locally — pending observation", "info");
  });

  it("surfaces follow-up notifications from the dashboard interaction layer", async () => {
    const notify = vi.fn();
    const followUpSession = vi.fn().mockResolvedValue({
      ok: true,
      notificationMessage: "Follow-up accepted locally — pending observation",
      notificationLevel: "info",
    });
    const dashboard = await openDashboard({ notify, followUpSession });

    dashboard.inputMode = {
      kind: "followup",
      sessionId: "s1",
      value: "Please confirm the rollback path",
      cursor: "Please confirm the rollback path".length,
    };

    await dashboard.submitInputMode();

    expect(followUpSession).toHaveBeenCalledWith("s1", "Please confirm the rollback path");
    expect(notify).toHaveBeenCalledWith("Follow-up accepted locally — pending observation", "info");
  });

  it("surfaces abort notifications from the dashboard interaction layer", async () => {
    const notify = vi.fn();
    const abortSession = vi.fn().mockResolvedValue({
      ok: true,
      notificationMessage: "Abort accepted locally — pending observation",
      notificationLevel: "info",
    });
    const dashboard = await openDashboard({ notify, abortSession });

    await dashboard.confirmAbort("s1");

    expect(abortSession).toHaveBeenCalledWith("s1");
    expect(notify).toHaveBeenCalledWith("Abort accepted locally — pending observation", "info");
  });
});

interface DashboardInstance {
  inputMode:
    | { kind: "none" }
    | { kind: "steer"; sessionId: string; value: string; cursor: number }
    | { kind: "followup"; sessionId: string; value: string; cursor: number };
  submitInputMode: () => Promise<void>;
  confirmAbort: (sessionId: string) => Promise<void>;
}

interface DashboardHarnessOptions {
  notify?: ReturnType<typeof vi.fn>;
  steerSession?: ReturnType<typeof vi.fn>;
  followUpSession?: ReturnType<typeof vi.fn>;
  abortSession?: ReturnType<typeof vi.fn>;
}

async function openDashboard(options: DashboardHarnessOptions): Promise<DashboardInstance> {
  let dashboard: DashboardInstance | undefined;
  const notify = options.notify ?? vi.fn();
  const selectedSession = session();
  const state: WorkbenchState = {
    sessions: [selectedSession],
    selectedSessionId: selectedSession.id,
    preferences: { detailViewMode: "summary" },
  };

  const supervisor = {
    initialize: vi.fn().mockResolvedValue(undefined),
    openWorkbench: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn(() => () => undefined),
    registry: {
      getState: (): WorkbenchState => state,
      getSelectedSession: (): WorkbenchSession => selectedSession,
      getActivities: (): never[] => [],
    },
    getProjectName: (): string => "jackdaw-revisited",
    getTranscriptLines: (): never[] => [],
    getLogLines: (): never[] => [],
    getTranscriptPreview: (): never[] => [],
    isManaged: (): boolean => true,
    selectNextSession: vi.fn().mockResolvedValue(undefined),
    updatePreferences: vi.fn().mockResolvedValue(undefined),
    spawnSession: vi.fn().mockResolvedValue(selectedSession),
    steerSession: options.steerSession ?? vi.fn().mockResolvedValue({ ok: true, notificationMessage: "steer", notificationLevel: "info" }),
    followUpSession:
      options.followUpSession ?? vi.fn().mockResolvedValue({ ok: true, notificationMessage: "follow-up", notificationLevel: "info" }),
    abortSession: options.abortSession ?? vi.fn().mockResolvedValue({ ok: true, notificationMessage: "abort", notificationLevel: "info" }),
    executeShellCommand: vi.fn().mockResolvedValue(true),
    updateSessionMetadata: vi.fn().mockResolvedValue(true),
  };

  const ctx = {
    cwd: "/tmp/project",
    model: "gpt-5.4",
    ui: {
      notify,
      custom: vi.fn().mockImplementation(async (renderDashboard: (tui: { requestRender: () => void }, theme: Theme, kb: unknown, done: () => void) => DashboardInstance) => {
        dashboard = renderDashboard({ requestRender: () => undefined }, createTheme(), undefined, () => undefined);
      }),
    },
  } as unknown as ExtensionCommandContext;

  await showWorkbenchDashboard(ctx, supervisor as never);

  expect(dashboard).toBeDefined();
  return dashboard!;
}

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string): string => text,
    bg: (_color: string, text: string): string => text,
  } as Theme;
}
