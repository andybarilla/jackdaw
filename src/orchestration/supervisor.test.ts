import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAgentSessionMock = vi.fn();
const sessionManagerCreateMock = vi.fn();
const sessionManagerOpenMock = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: createAgentSessionMock,
  SessionManager: {
    create: sessionManagerCreateMock,
    open: sessionManagerOpenMock,
  },
}));

describe("WorkbenchSupervisor persistence", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workbench-"));
    createAgentSessionMock.mockReset();
    sessionManagerCreateMock.mockReset();
    sessionManagerOpenMock.mockReset();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("restores persisted metadata and preferences on initialize", async () => {
    const { WorkbenchStore } = await import("../persistence/store.js");
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    const store = WorkbenchStore.default(projectRoot);
    await store.save({
      version: 1,
      sessions: [
        {
          id: "session-1",
          name: "Renamed Session",
          cwd: "/repo",
          model: "gpt-5.4",
          taskLabel: "task",
          status: "idle",
          tags: ["alpha", "urgent"],
          lastUpdateAt: 101,
          summary: "Latest summary",
          pinnedSummary: "Pinned summary",
          recentFiles: ["src/ui/dashboard.ts"],
          connectionState: "historical",
          reconnectNote: "Could not reconnect after restart.",
        },
      ],
      selectedSessionId: "session-1",
      lastOpenedAt: 202,
      preferences: {
        detailViewMode: "log",
      },
    });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();

    const state = supervisor.registry.getState();
    expect(state.selectedSessionId).toBe("session-1");
    expect(state.preferences.detailViewMode).toBe("log");
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      name: "Renamed Session",
      tags: ["alpha", "urgent"],
      pinnedSummary: "Pinned summary",
      recentFiles: ["src/ui/dashboard.ts"],
      connectionState: "historical",
      reconnectNote: "Could not reconnect after restart.",
    });
  });

  it("does not overwrite unreadable persisted state on startup", async () => {
    const { WorkbenchStore } = await import("../persistence/store.js");
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    const store = WorkbenchStore.default(projectRoot);
    const statePath = path.join(projectRoot, ".jackdaw-workbench", "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"sessions":[');

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    await supervisor.openWorkbench();

    expect(supervisor.registry.getState().sessions).toEqual([]);
    expect(await readFile(statePath, "utf8")).toBe('{"sessions":[');
    await expect(store.load()).rejects.toThrow("Failed to load persisted workbench state");
  });

  it("keeps unreconnectable sessions visible as historical entries", async () => {
    const { WorkbenchStore } = await import("../persistence/store.js");
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerOpenMock.mockReturnValue({ opened: true });
    createAgentSessionMock.mockRejectedValue(new Error("session file missing"));

    const store = WorkbenchStore.default(projectRoot);
    await store.save({
      version: 1,
      sessions: [
        {
          id: "session-2",
          name: "Original Session",
          cwd: "/repo",
          model: "gpt-5.4",
          taskLabel: "task",
          status: "running",
          tags: [],
          lastUpdateAt: 303,
          summary: "Still visible",
          sessionFile: "session.json",
        },
      ],
      preferences: {
        detailViewMode: "summary",
      },
    });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();

    const restored = supervisor.registry.listSessions()[0];
    expect(restored).toMatchObject({
      id: "session-2",
      name: "Original Session",
      summary: "Still visible",
      connectionState: "historical",
    });
    expect(restored.reconnectNote).toContain("Could not reconnect after restart");
    expect(supervisor.isManaged("session-2")).toBe(false);

    const persisted = await supervisor.store.load();
    expect(persisted.sessions[0]?.connectionState).toBe("historical");
    expect(persisted.sessions[0]?.reconnectNote).toContain("Metadata remains visible locally");
  });
});
