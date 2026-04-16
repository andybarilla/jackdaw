import { describe, expect, it } from "vitest";
import type { WorkbenchActivity, WorkbenchSession, WorkbenchState } from "../types/workbench.js";
import { WorkbenchRegistry } from "./registry.js";

function session(overrides: Partial<WorkbenchSession>): WorkbenchSession {
  return {
    id: overrides.id ?? "session",
    name: overrides.name ?? "Session",
    cwd: overrides.cwd ?? "/tmp/project",
    model: overrides.model ?? "gpt-5.4",
    taskLabel: overrides.taskLabel ?? "task",
    status: overrides.status ?? "idle",
    tags: overrides.tags ?? [],
    lastUpdateAt: overrides.lastUpdateAt ?? 0,
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

function state(sessions: WorkbenchSession[]): WorkbenchState {
  return {
    sessions,
    preferences: { detailViewMode: "summary" },
  };
}

function activity(overrides: Partial<WorkbenchActivity>): WorkbenchActivity {
  return {
    id: overrides.id ?? "activity",
    sessionId: overrides.sessionId ?? "session",
    type: overrides.type ?? "message_streaming",
    summary: overrides.summary ?? "updated",
    timestamp: overrides.timestamp ?? 0,
  };
}

describe("WorkbenchRegistry ordering", () => {
  it("preserves hydrated session order", () => {
    const registry = new WorkbenchRegistry();

    registry.hydrate(state([
      session({ id: "running", status: "running", lastUpdateAt: 300 }),
      session({ id: "awaiting", status: "awaiting-input", lastUpdateAt: 100 }),
      session({ id: "done", status: "done", lastUpdateAt: 500 }),
    ]));

    expect(registry.listSessions().map((item) => item.id)).toEqual(["running", "awaiting", "done"]);
    expect(registry.getState().sessions.map((item) => item.id)).toEqual(["running", "awaiting", "done"]);
  });

  it("orders new same-band sessions by lastUpdateAt newest-first even when inserted out of order", () => {
    const registry = new WorkbenchRegistry();

    registry.hydrate(state([
      session({ id: "awaiting", status: "awaiting-input", lastUpdateAt: 100 }),
      session({ id: "blocked", status: "blocked", lastUpdateAt: 90 }),
      session({ id: "running-a", status: "running", lastUpdateAt: 80 }),
      session({ id: "running-b", status: "running", lastUpdateAt: 70 }),
      session({ id: "idle", status: "idle", lastUpdateAt: 60 }),
    ]));

    registry.upsertSession(session({ id: "running-d", status: "running", lastUpdateAt: 120 }));
    registry.upsertSession(session({ id: "running-c", status: "running", lastUpdateAt: 110 }));

    expect(registry.listSessions().map((item) => item.id)).toEqual([
      "awaiting",
      "blocked",
      "running-d",
      "running-c",
      "running-a",
      "running-b",
      "idle",
    ]);
  });

  it("keeps relative order when a patch stays in the same band", () => {
    const registry = new WorkbenchRegistry();

    registry.hydrate(state([
      session({ id: "running-a", status: "running", lastUpdateAt: 100 }),
      session({ id: "running-b", status: "running", lastUpdateAt: 90 }),
      session({ id: "idle", status: "idle", lastUpdateAt: 80 }),
    ]));

    registry.patchSession("running-b", {
      summary: "still running",
      currentTool: "edit",
      lastUpdateAt: 200,
    });

    expect(registry.listSessions().map((item) => item.id)).toEqual(["running-a", "running-b", "idle"]);
  });

  it("moves a session to the top of its new band when status changes even if an existing peer is newer", () => {
    const registry = new WorkbenchRegistry();

    registry.hydrate(state([
      session({ id: "blocked-a", status: "blocked", lastUpdateAt: 200 }),
      session({ id: "running-a", status: "running", lastUpdateAt: 100 }),
      session({ id: "running-b", status: "running", lastUpdateAt: 90 }),
      session({ id: "idle", status: "idle", lastUpdateAt: 80 }),
    ]));

    registry.patchSession("running-b", {
      status: "blocked",
      lastUpdateAt: 50,
      summary: "tool failed",
    });

    expect(registry.listSessions().map((item) => item.id)).toEqual(["running-b", "blocked-a", "running-a", "idle"]);
  });

  it("keeps same-band activity updates stable but moves band transitions to the top of the destination band", () => {
    const registry = new WorkbenchRegistry();

    registry.hydrate(state([
      session({ id: "awaiting-a", status: "awaiting-input", lastUpdateAt: 400, summary: "already waiting" }),
      session({ id: "running-a", status: "running", lastUpdateAt: 100, summary: "working" }),
      session({ id: "running-b", status: "running", lastUpdateAt: 90, summary: "working" }),
      session({ id: "idle", status: "idle", lastUpdateAt: 80, summary: "waiting" }),
    ]));

    registry.addActivity(activity({
      id: "stream",
      sessionId: "running-b",
      type: "message_streaming",
      summary: "still working",
      timestamp: 200,
    }));

    expect(registry.listSessions().map((item) => item.id)).toEqual(["awaiting-a", "running-a", "running-b", "idle"]);

    registry.addActivity(activity({
      id: "attention",
      sessionId: "idle",
      type: "awaiting_user",
      summary: "Need your answer",
      timestamp: 50,
    }));

    expect(registry.listSessions().map((item) => item.id)).toEqual(["idle", "awaiting-a", "running-a", "running-b"]);
  });
});
