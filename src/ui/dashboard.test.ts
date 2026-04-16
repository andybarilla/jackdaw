import { describe, expect, it } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { getDetailPanelTitle, getPinnedSummaryReplaceState, getPinnedSummaryToggleState, getShellActionHint } from "./dashboard.js";

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
