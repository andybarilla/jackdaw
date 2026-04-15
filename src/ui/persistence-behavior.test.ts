import { describe, expect, it } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { renderOverviewLines } from "./overview.js";
import { renderSessionDetailLines } from "./session-detail.js";

function session(overrides: Partial<WorkbenchSession>): WorkbenchSession {
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
  };
}

describe("historical session rendering", () => {
  it("marks historical sessions in the overview", () => {
    const lines = renderOverviewLines(
      [
        session({
          id: "historical",
          name: "Historical Session",
          status: "idle",
          summary: "Saved metadata only",
          connectionState: "historical",
        }),
      ],
      "historical",
    );

    expect(lines[0]).toContain("historical");
  });

  it("explains unreconnectable sessions in the detail view", () => {
    const lines = renderSessionDetailLines(
      session({
        status: "running",
        summary: "Saved metadata only",
        connectionState: "historical",
        reconnectNote: "Could not reconnect after restart. Metadata remains visible locally.",
      }),
      [],
    );

    expect(lines).toContain("Connection: historical");
    expect(lines).toContain("Reconnect: Could not reconnect after restart. Metadata remains visible locally.");
  });
});
