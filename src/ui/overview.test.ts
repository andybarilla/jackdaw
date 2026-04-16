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
        summary: "Finished summary",
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

    expect(lines[0]).toContain("✓ done Done Session · Finished summary · finished 2m ago");
    expect(lines[1]).toContain("> ◉ needs input Needs Answer · Which option should I choose next?");

    vi.useRealTimers();
  });

  it("prefers live urgent reason text over pinned summaries for attention states", () => {
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
      session({
        id: "done-pinned",
        name: "Pinned Done Session",
        status: "done",
        summary: "Live done summary",
        pinnedSummary: "Frozen done summary",
      }),
      session({
        id: "done-live",
        name: "Live Done Session",
        status: "done",
        summary: "Live done summary",
      }),
    ]);

    expect(lines[0]).toContain("◉ needs input Needs Answer · Which option should I choose next?");
    expect(lines[0]).not.toContain("Frozen input summary");
    expect(lines[1]).toContain("◆ needs attention Blocked Session · Command exited 1");
    expect(lines[1]).not.toContain("Frozen blocked summary");
    expect(lines[2]).toContain("✖ needs attention Failed Session · Process crashed");
    expect(lines[2]).not.toContain("Frozen failed summary");
    expect(lines[3]).toContain("● running Running Session · Frozen running summary");
    expect(lines[3]).not.toContain("needs attention");
    expect(lines[3]).not.toContain("running edit");
    expect(lines[4]).toContain("Pinned Done Session · Frozen done summary");
    expect(lines[4]).not.toContain("Live done summary");
    expect(lines[5]).toContain("Live Done Session · Live done summary");
  });

  it("uses operator-facing attention wording and keeps live urgent reason after a pinned session transitions to attention", () => {
    const lines = renderOverviewLines([
      session({
        id: "input",
        name: "Needs Answer",
        status: "awaiting-input",
        summary: "Waiting on operator",
        pinnedSummary: "Pinned snapshot from earlier",
        latestText: "Should I ship the smaller fix first?",
      }),
      session({
        id: "blocked",
        name: "Blocked Session",
        status: "blocked",
        summary: "Investigating issue",
        lastError: "API token missing for deploy step",
      }),
      session({
        id: "failed",
        name: "Failed Session",
        status: "failed",
        summary: "Retrying",
        lastError: "Tests failed in CI",
      }),
      session({
        id: "running",
        name: "Running Session",
        status: "running",
        summary: "Generating release notes",
        currentTool: "write",
      }),
    ]);

    expect(lines[0]).toContain("◉ needs input Needs Answer · Should I ship the smaller fix first?");
    expect(lines[0]).not.toContain("Waiting on operator");
    expect(lines[0]).not.toContain("Pinned snapshot from earlier");
    expect(lines[1]).toContain("◆ needs attention Blocked Session · API token missing for deploy step");
    expect(lines[1]).not.toContain("Investigating issue");
    expect(lines[2]).toContain("✖ needs attention Failed Session · Tests failed in CI");
    expect(lines[2]).not.toContain("Retrying");
    expect(lines[3]).toContain("● running Running Session · Generating release notes");
    expect(lines[3]).not.toContain("needs attention");
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
