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

interface MockManagedSession {
  sessionId: string;
  sessionFile: string;
  model: { id: string };
  prompt: ReturnType<typeof vi.fn>;
  steer: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  executeBash: ReturnType<typeof vi.fn>;
}

function createManagedSession(overrides: Partial<MockManagedSession> = {}): MockManagedSession {
  return {
    sessionId: overrides.sessionId ?? "managed-session",
    sessionFile: overrides.sessionFile ?? "managed-session.json",
    model: overrides.model ?? { id: "gpt-5.4" },
    prompt: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
    steer: overrides.steer ?? vi.fn().mockResolvedValue(undefined),
    followUp: overrides.followUp ?? vi.fn().mockResolvedValue(undefined),
    abort: overrides.abort ?? vi.fn().mockResolvedValue(undefined),
    subscribe: overrides.subscribe ?? vi.fn(() => () => undefined),
    executeBash: overrides.executeBash ?? vi.fn().mockResolvedValue({ output: "", exitCode: 0, cancelled: false, truncated: false }),
  };
}

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

  it("does not overwrite parseable but malformed persisted state on startup", async () => {
    const { WorkbenchStore } = await import("../persistence/store.js");
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    const store = WorkbenchStore.default(projectRoot);
    const statePath = path.join(projectRoot, ".jackdaw-workbench", "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"sessions":"oops"}');

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    await supervisor.openWorkbench();

    expect(supervisor.registry.getState().sessions).toEqual([]);
    expect(await readFile(statePath, "utf8")).toBe('{"sessions":"oops"}');
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

  it("serializes persistence triggered by rapid session events", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    supervisor.registry.upsertSession({
      id: "session-3",
      name: "Event Session",
      cwd: "/repo",
      model: "gpt-5.4",
      taskLabel: "task",
      status: "running",
      tags: [],
      lastUpdateAt: 404,
      summary: "Waiting",
      connectionState: "historical",
    });

    let activeSaves = 0;
    let maxConcurrentSaves = 0;
    const saveSpy = vi.spyOn(supervisor.store, "save").mockImplementation(async () => {
      activeSaves += 1;
      maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaves);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      activeSaves -= 1;
    });

    try {
      (supervisor as unknown as { handleSessionEvent: (sessionId: string, event: unknown) => void }).handleSessionEvent(
        "session-3",
        { type: "agent_start" },
      );
      (supervisor as unknown as { handleSessionEvent: (sessionId: string, event: unknown) => void }).handleSessionEvent(
        "session-3",
        { type: "agent_start" },
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
    } finally {
      saveSpy.mockRestore();
    }

    expect(maxConcurrentSaves).toBe(1);
  });

  it("runs a shell fallback command in the selected session context", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-shell",
      sessionFile: "session-shell.json",
      executeBash: vi.fn().mockResolvedValue({
        output: "M src/ui/dashboard.ts\n?? src/ui/dashboard.test.ts\n",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      }),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: "/repo", task: "task" });

    const ok = await supervisor.executeShellCommand(session.id, "git status --short");

    expect(ok).toBe(true);
    expect(managedSession.executeBash).toHaveBeenCalledWith("git status --short");
    expect(supervisor.registry.getSelectedSession()).toMatchObject({
      id: "session-shell",
      lastShellCommand: "git status --short",
      lastShellOutput: "M src/ui/dashboard.ts\n?? src/ui/dashboard.test.ts",
      lastShellExitCode: 0,
      summary: "Shell fallback completed: git status --short",
      currentTool: undefined,
    });
    expect(supervisor.registry.getActivities("session-shell").map((activity) => activity.summary)).toEqual(
      expect.arrayContaining(["Shell fallback: git status --short", "Shell fallback completed: git status --short"]),
    );

    const persisted = await supervisor.store.load();
    expect(persisted.sessions[0]).toMatchObject({
      lastShellCommand: "git status --short",
      lastShellExitCode: 0,
    });
    expect(persisted.sessions[0]?.lastShellOutput).toBeUndefined();
  });

  it("sanitizes shell fallback output before keeping it in memory", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-shell-sanitized",
      sessionFile: "session-shell-sanitized.json",
      executeBash: vi.fn().mockResolvedValue({
        output: "safe\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\nnext\u001b[31m red\u009b2J",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      }),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: "/repo", task: "task" });

    await expect(supervisor.executeShellCommand(session.id, "printf test")).resolves.toBe(true);

    expect(supervisor.registry.getSelectedSession()).toMatchObject({
      lastShellOutput: "safelink\nnext red",
      lastShellExitCode: 0,
    });
  });

  it("rejects shell fallback for unmanaged historical sessions", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    supervisor.registry.upsertSession({
      id: "session-historical",
      name: "Historical Session",
      cwd: "/repo",
      model: "gpt-5.4",
      taskLabel: "task",
      status: "idle",
      tags: [],
      lastUpdateAt: 505,
      summary: "Visible only",
      connectionState: "historical",
    });

    await expect(supervisor.executeShellCommand("session-historical", "pwd")).resolves.toBe(false);
  });
});
