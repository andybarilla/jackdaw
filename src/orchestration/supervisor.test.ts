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
          lastIntervention: {
            kind: "steer",
            text: "Keep going",
            status: "pending-observation",
            requestedAt: 150,
            summary: "Steer",
          },
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
      lastIntervention: {
        kind: "steer",
        text: "Keep going",
        status: "pending-observation",
        requestedAt: 150,
        summary: "Steer",
      },
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

  it("runs a shell fallback command in the selected session cwd without recording through pi", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-shell",
      sessionFile: "session-shell.json",
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const shellCwd = path.join(projectRoot, "shell-cwd");
    await mkdir(shellCwd, { recursive: true });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: shellCwd, task: "task" });

    const ok = await supervisor.executeShellCommand(session.id, "pwd");

    expect(ok).toBe(true);
    expect(managedSession.executeBash).not.toHaveBeenCalled();
    expect(supervisor.registry.getSelectedSession()).toMatchObject({
      id: "session-shell",
      lastShellCommand: "pwd",
      lastShellOutput: shellCwd,
      lastShellExitCode: 0,
      summary: "Shell fallback completed: pwd",
      currentTool: undefined,
    });
    expect(supervisor.registry.getActivities("session-shell").map((activity) => activity.summary)).toEqual(
      expect.arrayContaining(["Shell fallback: pwd", "Shell fallback completed: pwd"]),
    );

    const persisted = await supervisor.store.load();
    expect(persisted.sessions[0]).toMatchObject({
      lastShellCommand: "pwd",
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
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    await expect(
      supervisor.executeShellCommand(
        session.id,
        `node -e "process.stdout.write('safe\\u001b]8;;https://example.com\\u0007link\\u001b]8;;\\u0007\\nnext\\u001b[31m red\\u009b2J')"`,
      ),
    ).resolves.toBe(true);

    expect(managedSession.executeBash).not.toHaveBeenCalled();
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

  it("records steer as sent before local submission, then pending observation after success", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-steer",
      sessionFile: "session-steer.json",
      steer: vi.fn().mockImplementation(async () => {
        expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
          kind: "steer",
          status: "sent",
          text: "Please focus on the failing test",
          summary: "Steer",
        });
      }),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    const result = await supervisor.steerSession(session.id, "Please focus on the failing test");

    expect(result).toEqual({
      ok: true,
      notificationMessage: "Steer accepted locally — pending observation",
      notificationLevel: "info",
    });
    expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
      kind: "steer",
      status: "pending-observation",
      text: "Please focus on the failing test",
      summary: "Steer",
    });
    expect(supervisor.registry.getActivities(session.id).at(-1)).toMatchObject({
      summary: "Steering queued: Please focus on the failing test",
      origin: "operator",
      meaningful: false,
    });
  });

  it("marks a pending intervention observed only after later meaningful non-local activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));

    try {
      const { WorkbenchSupervisor } = await import("./supervisor.js");

      sessionManagerCreateMock.mockReturnValue({ created: true });
      const managedSession = createManagedSession({
        sessionId: "session-followup",
        sessionFile: "session-followup.json",
      });
      createAgentSessionMock.mockResolvedValue({ session: managedSession });

      const supervisor = new WorkbenchSupervisor(projectRoot);
      await supervisor.initialize();
      const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

      await supervisor.followUpSession(session.id, "Please confirm the migration path");
      const requestedAt = supervisor.registry.getSelectedSession()!.lastIntervention!.requestedAt;

      (supervisor as unknown as { handleSessionEvent: (sessionId: string, event: unknown) => void }).handleSessionEvent(session.id, {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "streaming" },
      });
      expect(supervisor.registry.getSelectedSession()?.lastIntervention?.status).toBe("pending-observation");

      vi.advanceTimersByTime(1);
      (supervisor as unknown as { handleSessionEvent: (sessionId: string, event: unknown) => void }).handleSessionEvent(session.id, {
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "src/index.ts" },
      });
      await supervisor.openWorkbench();

      expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
        kind: "followup",
        status: "observed",
        observedAt: expect.any(Number),
      });
      expect(supervisor.registry.getSelectedSession()!.lastIntervention!.observedAt).toBeGreaterThan(requestedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clear pending observation on later session-idle churn", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-followup-idle",
      sessionFile: "session-followup-idle.json",
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    await supervisor.followUpSession(session.id, "Please confirm the migration path");
    const requestedAt = supervisor.registry.getSelectedSession()!.lastIntervention!.requestedAt;

    (supervisor as unknown as { handleSessionEvent: (sessionId: string, event: unknown) => void }).handleSessionEvent(session.id, {
      type: "agent_end",
      messages: [],
    });

    expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
      kind: "followup",
      status: "pending-observation",
      requestedAt,
    });
    expect(supervisor.registry.getSelectedSession()?.lastIntervention?.observedAt).toBeUndefined();
  });

  it("records successful follow-up submissions as sent before pending observation", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-followup-success",
      sessionFile: "session-followup-success.json",
      followUp: vi.fn().mockImplementation(async (text: string) => {
        expect(text).toBe("Please verify the migration fallback");
        expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
          kind: "followup",
          status: "sent",
          text: "Please verify the migration fallback",
          summary: "Follow-up",
        });
      }),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    const result = await supervisor.followUpSession(session.id, "Please verify the migration fallback");

    expect(result).toEqual({
      ok: true,
      notificationMessage: "Follow-up accepted locally — pending observation",
      notificationLevel: "info",
    });
    expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
      kind: "followup",
      status: "pending-observation",
      text: "Please verify the migration fallback",
      summary: "Follow-up",
    });
    expect(supervisor.registry.getActivities(session.id).at(-1)).toMatchObject({
      summary: "Follow-up queued: Please verify the migration fallback",
      origin: "operator",
      meaningful: false,
    });
  });

  it("records successful abort submissions as sent before pending observation", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-abort-success",
      sessionFile: "session-abort-success.json",
      abort: vi.fn().mockImplementation(async () => {
        expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
          kind: "abort",
          status: "sent",
          text: "Abort requested",
          summary: "Abort",
        });
      }),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    const result = await supervisor.abortSession(session.id);

    expect(result).toEqual({
      ok: true,
      notificationMessage: "Abort accepted locally — pending observation",
      notificationLevel: "info",
    });
    expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
      kind: "abort",
      status: "pending-observation",
      text: "Abort requested",
      summary: "Abort",
    });
    expect(supervisor.registry.getActivities(session.id).at(-1)).toMatchObject({
      summary: "Abort requested",
      origin: "operator",
      meaningful: false,
    });
  });

  it("stores failed abort submissions and returns explicit local failure feedback", async () => {
    const { WorkbenchSupervisor } = await import("./supervisor.js");

    sessionManagerCreateMock.mockReturnValue({ created: true });
    const managedSession = createManagedSession({
      sessionId: "session-abort",
      sessionFile: "session-abort.json",
      abort: vi.fn().mockRejectedValue(new Error("abort transport disconnected")),
    });
    createAgentSessionMock.mockResolvedValue({ session: managedSession });

    const supervisor = new WorkbenchSupervisor(projectRoot);
    await supervisor.initialize();
    const session = await supervisor.spawnSession({ cwd: projectRoot, task: "task" });

    const result = await supervisor.abortSession(session.id);

    expect(result).toEqual({
      ok: false,
      notificationMessage: "Abort failed locally: abort transport disconnected",
      notificationLevel: "error",
    });
    expect(supervisor.registry.getSelectedSession()?.lastIntervention).toMatchObject({
      kind: "abort",
      status: "failed",
      text: "Abort requested",
      errorMessage: "abort transport disconnected",
      summary: "Abort",
    });

    const persisted = await supervisor.store.load();
    expect(persisted.sessions[0]?.lastIntervention).toMatchObject({
      kind: "abort",
      status: "failed",
      errorMessage: "abort transport disconnected",
    });
  });
});
