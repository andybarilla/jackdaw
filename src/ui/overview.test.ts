import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { renderOverviewLines } from "./overview.js";

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

describe("renderOverviewLines", () => {
  it("renders sessions in the supplied registry order", () => {
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

    expect(lines[0]).toContain("✓ done Done Session · finished 2m ago");
    expect(lines[1]).toContain("> ◉ input Needs Answer · Awaiting your choice");

    vi.useRealTimers();
  });

  it("prefers the pinned summary over status-specific fallback fields", () => {
    const lines = renderOverviewLines([
      session({
        id: "input",
        name: "Needs Answer",
        status: "awaiting-input",
        summary: "Live summary",
        pinnedSummary: "Frozen input summary",
        latestText: "Which option should I choose next?",
      }),
      session({
        id: "blocked",
        name: "Blocked Session",
        status: "blocked",
        summary: "Live blocked summary",
        pinnedSummary: "Frozen blocked summary",
        lastError: "Command exited 1",
      }),
      session({
        id: "failed",
        name: "Failed Session",
        status: "failed",
        summary: "Live failed summary",
        pinnedSummary: "Frozen failed summary",
        lastError: "Process crashed",
      }),
      session({
        id: "running",
        name: "Running Session",
        status: "running",
        summary: "Live running summary",
        pinnedSummary: "Frozen running summary",
        currentTool: "edit",
      }),
    ]);

    expect(lines[0]).toContain("Needs Answer · Frozen input summary");
    expect(lines[0]).not.toContain("Which option should I choose next?");
    expect(lines[1]).toContain("Blocked Session · Frozen blocked summary");
    expect(lines[1]).not.toContain("Command exited 1");
    expect(lines[2]).toContain("Failed Session · Frozen failed summary");
    expect(lines[2]).not.toContain("Process crashed");
    expect(lines[3]).toContain("Running Session · Frozen running summary");
    expect(lines[3]).not.toContain("running edit");
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
