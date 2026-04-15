import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { compareSessions, renderOverviewLines } from "./overview.js";

function session(overrides: Partial<WorkbenchSession>): WorkbenchSession {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "session",
    cwd: "/tmp/project",
    model: "gpt-5.4",
    taskLabel: "task",
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

describe("compareSessions", () => {
  it("prioritizes awaiting-input over running and done", () => {
    const items = [
      session({ id: "done", status: "done", lastUpdateAt: 1000 }),
      session({ id: "running", status: "running", lastUpdateAt: 2000 }),
      session({ id: "input", status: "awaiting-input", lastUpdateAt: 500 }),
    ];

    const sorted = [...items].sort(compareSessions);
    expect(sorted.map((item) => item.id)).toEqual(["input", "running", "done"]);
  });

  it("breaks ties by recent activity", () => {
    const items = [
      session({ id: "older", status: "running", lastUpdateAt: 1000 }),
      session({ id: "newer", status: "running", lastUpdateAt: 2000 }),
    ];

    const sorted = [...items].sort(compareSessions);
    expect(sorted.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("renderOverviewLines", () => {
  it("renders compact attention reasons", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T20:00:00Z"));

    const lines = renderOverviewLines([
      session({
        id: "done",
        name: "Done Session",
        status: "done",
        lastUpdateAt: new Date("2026-04-15T19:58:00Z").getTime(),
      }),
      session({
        id: "input",
        name: "Needs Answer",
        status: "awaiting-input",
        latestText: "Which option should I choose next?",
        summary: "Awaiting your choice",
      }),
    ], "input");

    expect(lines[0]).toContain("> ◉ input Needs Answer · Which option should I choose next?");
    expect(lines[1]).toContain("✓ done Done Session · finished 2m ago");

    vi.useRealTimers();
  });

  it("shows recent file context when available", () => {
    const lines = renderOverviewLines([
      session({
        id: "running",
        name: "Edit Session",
        status: "running",
        currentTool: "edit",
        recentFiles: ["src/ui/dashboard.ts", "src/orchestration/activity.ts"],
      }),
    ], "running");

    expect(lines[0]).toContain("· files src/ui/dashboard.ts +1");
  });
});
