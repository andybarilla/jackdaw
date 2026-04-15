import { describe, expect, it } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { getShellActionHint } from "./dashboard.js";

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
