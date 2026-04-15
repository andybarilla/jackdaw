import { describe, expect, it } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
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
  };
}

describe("renderSessionDetailLines", () => {
  it("shows pinned summary separately when present", () => {
    const lines = renderSessionDetailLines(
      session({
        summary: "latest generated summary",
        pinnedSummary: "operator-pinned summary",
      }),
      [],
    );

    expect(lines).toContain("Pinned: operator-pinned summary");
    expect(lines).toContain("Summary: operator-pinned summary");
  });

  it("shows recent files when present", () => {
    const lines = renderSessionDetailLines(
      session({
        recentFiles: ["src/ui/dashboard.ts", "src/orchestration/activity.ts"],
      }),
      [],
    );

    expect(lines.some((line) => line.startsWith("Files: src/ui/dashboard.ts"))).toBe(true);
  });

  it("shows transcript preview when provided", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["User: Please inspect the repo", "Assistant: I found two issues to fix"],
    );

    expect(lines).toContain("Transcript preview:");
    expect(lines).toContain("- User: Please inspect the repo");
  });

  it("shows transcript window in transcript mode", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["User: one", "Assistant: two", "User: three"],
      "transcript",
      1,
      2,
    );

    expect(lines).toContain("Transcript (3 lines, showing 2-3 • ↑ more above • ↓ end)");
    expect(lines).toContain("- Assistant: two");
    expect(lines).toContain("- User: three");
  });

  it("wraps long transcript lines instead of clipping them", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["Assistant: This is a much longer line that should wrap across multiple visual rows in transcript mode"],
      "transcript",
      0,
      5,
      24,
    );

    expect(lines.some((line) => line === "- Assistant: This is a")).toBe(true);
    expect(lines.some((line) => line.includes("should wrap across"))).toBe(true);
  });

  it("shows when scrolling is not needed", () => {
    const lines = renderSessionDetailLines(session({}), [], ["User: one"], "log", 0, 8);
    expect(lines).toContain("Log (1 lines, showing 1-1 • no scrolling needed)");
  });
});
