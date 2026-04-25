import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { WorkspaceRepoRoot, WorkspaceWorktree } from "../../shared/domain/workspace.js";
import { AppStore } from "../persistence/app-store.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import { WorkspaceRegistry } from "../workspace/workspace-registry.js";
import type {
  ManagedPiSession,
  PiSessionAdapter,
  PiSessionEventListener,
  ReconnectPiSessionOptions,
  SpawnPiSessionOptions,
} from "./session-adapter.js";
import { ReconnectManager } from "./reconnect-manager.js";
import { RuntimeManager, type ShellCommandExecutionResult, type ShellExecutor } from "./runtime-manager.js";

class FakeManagedSession implements ManagedPiSession {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly modelId: string | undefined;
  readonly prompt = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly steer = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly followUp = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly abort = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  readonly dispose = vi.fn<() => void>();
  private listener: PiSessionEventListener | undefined;

  constructor(sessionId: string, sessionFile: string | undefined = `${sessionId}.json`, modelId: string | undefined = "sonnet") {
    this.sessionId = sessionId;
    this.sessionFile = sessionFile;
    this.modelId = modelId;
  }

  subscribe(listener: PiSessionEventListener): () => void {
    this.listener = listener;
    return (): void => {
      if (this.listener === listener) {
        this.listener = undefined;
      }
    };
  }

  async emit(event: unknown): Promise<void> {
    await this.listener?.(event);
  }
}

class FakeSessionAdapter implements PiSessionAdapter {
  readonly spawnInputs: SpawnPiSessionOptions[] = [];
  readonly reconnectInputs: ReconnectPiSessionOptions[] = [];
  readonly spawnedSessions: FakeManagedSession[];
  reconnectResult: FakeManagedSession | Error | undefined;

  constructor(spawnedSessions: FakeManagedSession[] = []) {
    this.spawnedSessions = [...spawnedSessions];
  }

  async spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    this.spawnInputs.push(options);
    return this.spawnedSessions.shift() ?? new FakeManagedSession(`ses-${this.spawnInputs.length}`);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    this.reconnectInputs.push(options);
    if (this.reconnectResult instanceof Error) {
      throw this.reconnectResult;
    }

    return this.reconnectResult ?? new FakeManagedSession(options.sessionId, options.sessionFile);
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })));
});

async function createRegistry(): Promise<{ registry: WorkspaceRegistry; appDataDir: string }> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-runtime-manager-"));
  temporaryDirectories.push(appDataDir);
  const registry = await WorkspaceRegistry.load({
    appStore: new AppStore(path.join(appDataDir, "app-state.json")),
    workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
    workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
  });

  return { registry, appDataDir };
}

async function addWorkspace(registry: WorkspaceRegistry, appDataDir: string, workspaceId: string, repoName: string): Promise<{
  repoRoot: WorkspaceRepoRoot;
  worktree: WorkspaceWorktree;
}> {
  const repoPath = path.join(appDataDir, repoName);
  const worktreePath = path.join(repoPath, ".worktrees", "task");
  await mkdir(worktreePath, { recursive: true });

  const repoRoot: WorkspaceRepoRoot = {
    id: `${workspaceId}-repo-1`,
    path: repoPath,
    name: repoName,
    defaultBranch: "main",
  };
  const worktree: WorkspaceWorktree = {
    id: `${workspaceId}-worktree-1`,
    repoRootId: repoRoot.id,
    path: worktreePath,
    branch: "task-4-pi-backed-orchestration-service",
    label: "Task 4",
  };

  await registry.createWorkspace({
    id: workspaceId,
    name: `Workspace ${workspaceId}`,
    repoRoots: [repoRoot],
    worktrees: [worktree],
    createdAt: "2026-04-25T09:00:00.000Z",
    updatedAt: "2026-04-25T09:00:00.000Z",
  });

  return { repoRoot, worktree };
}

function createPersistedSession(overrides: Partial<WorkspaceSession>): WorkspaceSession {
  return {
    id: overrides.id ?? "ses-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    name: overrides.name ?? "Persisted session",
    repoRoot: overrides.repoRoot ?? "/workspace/repo",
    worktree: overrides.worktree,
    cwd: overrides.cwd ?? overrides.repoRoot ?? "/workspace/repo",
    branch: overrides.branch,
    runtime: overrides.runtime ?? { agent: "implementer", model: "sonnet", runtime: "pi" },
    status: overrides.status ?? "running",
    liveSummary: overrides.liveSummary ?? "Running",
    pinnedSummary: overrides.pinnedSummary,
    latestMeaningfulUpdate: overrides.latestMeaningfulUpdate,
    currentActivity: overrides.currentActivity,
    currentTool: overrides.currentTool,
    lastIntervention: overrides.lastIntervention,
    recentFiles: overrides.recentFiles ?? [],
    linkedResources: overrides.linkedResources ?? { artifactIds: [], workItemIds: [], reviewIds: [] },
    connectionState: overrides.connectionState ?? "live",
    sessionFile: overrides.sessionFile,
    reconnectNote: overrides.reconnectNote,
    startedAt: overrides.startedAt,
    updatedAt: overrides.updatedAt ?? "2026-04-25T09:30:00.000Z",
    completedAt: overrides.completedAt,
    hqSessionId: overrides.hqSessionId,
  };
}

describe("RuntimeManager", () => {
  it("tracks active sessions by workspace id plus session id", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspaceOne = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    const workspaceTwo = await addWorkspace(registry, appDataDir, "ws-2", "repo-two");
    const adapter = new FakeSessionAdapter([
      new FakeManagedSession("pi-shared", "ws-1-session.json"),
      new FakeManagedSession("pi-shared", "ws-2-session.json"),
    ]);
    const runtimeManager = new RuntimeManager({ registry, adapter });

    const first = await runtimeManager.spawnSession({
      workspaceId: "ws-1",
      cwd: workspaceOne.worktree.path,
      repoRoot: workspaceOne.repoRoot.path,
      worktree: workspaceOne.worktree.path,
      branch: workspaceOne.worktree.branch,
      task: "Implement first workspace task",
    });
    const second = await runtimeManager.spawnSession({
      workspaceId: "ws-2",
      cwd: workspaceTwo.worktree.path,
      repoRoot: workspaceTwo.repoRoot.path,
      worktree: workspaceTwo.worktree.path,
      branch: workspaceTwo.worktree.branch,
      task: "Implement second workspace task",
    });

    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(runtimeManager.listActiveSessionKeys()).toEqual(["ws-1::pi-shared", "ws-2::pi-shared"]);
    expect(registry.getWorkspaceDetail("ws-1")?.sessions).toHaveLength(1);
    expect(registry.getWorkspaceDetail("ws-2")?.sessions).toHaveLength(1);
  });

  it("keeps same-band updates stable while urgent statuses outrank running", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    const firstManaged = new FakeManagedSession("ses-first");
    const secondManaged = new FakeManagedSession("ses-second");
    const adapter = new FakeSessionAdapter([firstManaged, secondManaged]);
    const runtimeManager = new RuntimeManager({ registry, adapter });

    await runtimeManager.spawnSession({
      workspaceId: "ws-1",
      cwd: workspace.worktree.path,
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      task: "First running task",
    });
    await runtimeManager.spawnSession({
      workspaceId: "ws-1",
      cwd: workspace.worktree.path,
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      task: "Second running task",
    });

    expect(runtimeManager.listWorkspaceSessions("ws-1").map((session) => session.id)).toEqual(["ses-first", "ses-second"]);

    await secondManaged.emit({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "src/index.ts" },
    });

    expect(runtimeManager.listWorkspaceSessions("ws-1").map((session) => session.id)).toEqual(["ses-first", "ses-second"]);

    await secondManaged.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Please confirm which approach to use?" }],
      },
    });

    expect(runtimeManager.listWorkspaceSessions("ws-1").map((session) => session.id)).toEqual(["ses-second", "ses-first"]);
    expect(runtimeManager.listRecentAttention("ws-1")[0]).toMatchObject({
      sessionId: "ses-second",
      band: "needs-operator",
      title: "Awaiting operator input",
    });
  });

  it("ranks awaiting-input, blocked, and failed sessions ahead of running sessions", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    const runtimeManager = new RuntimeManager({ registry, adapter: new FakeSessionAdapter() });

    await registry.upsertSession(createPersistedSession({
      id: "running",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      status: "running",
    }));
    await registry.upsertSession(createPersistedSession({
      id: "failed",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      status: "failed",
    }));
    await registry.upsertSession(createPersistedSession({
      id: "blocked",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      status: "blocked",
    }));
    await registry.upsertSession(createPersistedSession({
      id: "awaiting",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      status: "awaiting-input",
    }));

    expect(runtimeManager.listWorkspaceSessions("ws-1").map((session) => session.id)).toEqual([
      "awaiting",
      "blocked",
      "failed",
      "running",
    ]);
  });

  it("reattaches restart sessions as live when pi reconnect succeeds", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    await registry.upsertSession(createPersistedSession({
      id: "ses-live",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      sessionFile: "persisted-session.json",
      connectionState: "historical",
      status: "running",
      runtime: { agent: "implementer", model: "old-model", runtime: "pi" },
    }));
    const adapter = new FakeSessionAdapter();
    adapter.reconnectResult = new FakeManagedSession("ses-live", "restored-session.json", "new-model");
    const runtimeManager = new RuntimeManager({ registry, adapter });
    const reconnectManager = new ReconnectManager(runtimeManager);

    const results = await reconnectManager.reconnectAll();
    const session = registry.getWorkspaceDetail("ws-1")?.sessions[0];

    expect(results).toEqual([{ workspaceId: "ws-1", sessionId: "ses-live", connectionState: "live" }]);
    expect(session).toMatchObject({
      id: "ses-live",
      connectionState: "live",
      reconnectNote: undefined,
      sessionFile: "restored-session.json",
      runtime: { model: "new-model", runtime: "pi" },
    });
    expect(runtimeManager.listActiveSessionKeys()).toEqual(["ws-1::ses-live"]);
  });

  it("preserves historical-only visibility when restart reconnect fails", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    await registry.upsertSession(createPersistedSession({
      id: "ses-historical",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      sessionFile: "missing-session.json",
      connectionState: "live",
      status: "running",
    }));
    const adapter = new FakeSessionAdapter();
    adapter.reconnectResult = new Error("session file missing");
    const runtimeManager = new RuntimeManager({ registry, adapter });
    const reconnectManager = new ReconnectManager(runtimeManager);

    const results = await reconnectManager.reconnectAll();
    const detail = registry.getWorkspaceDetail("ws-1");

    expect(results).toEqual([{ workspaceId: "ws-1", sessionId: "ses-historical", connectionState: "historical" }]);
    expect(detail?.sessions).toHaveLength(1);
    expect(detail?.sessions[0]).toMatchObject({
      id: "ses-historical",
      connectionState: "historical",
      reconnectNote: expect.stringContaining("Could not reconnect after restart"),
    });
    expect(runtimeManager.listActiveSessionKeys()).toEqual([]);
  });

  it("runs shell fallback as a bounded one-off command in session context", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir, "ws-1", "repo-one");
    const managedSession = new FakeManagedSession("ses-shell");
    const adapter = new FakeSessionAdapter([managedSession]);
    const shellExecutor: ShellExecutor = vi.fn(async (command: string, cwd: string): Promise<ShellCommandExecutionResult> => {
      expect(command).toBe("pwd");
      expect(cwd).toBe(workspace.worktree.path);
      return {
        command,
        cwd,
        exitCode: 0,
        output: workspace.worktree.path,
        timedOut: false,
      };
    });
    const runtimeManager = new RuntimeManager({ registry, adapter, shellExecutor });

    const spawned = await runtimeManager.spawnSession({
      workspaceId: "ws-1",
      cwd: workspace.worktree.path,
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      task: "Need shell fallback",
    });
    const result = await runtimeManager.runShellFallback(spawned.session!.id, "pwd");
    const session = registry.getWorkspaceDetail("ws-1")?.sessions[0];

    expect(result.ok).toBe(true);
    expect(shellExecutor).toHaveBeenCalledOnce();
    expect(session).toMatchObject({
      id: "ses-shell",
      status: "idle",
      liveSummary: "Shell fallback completed: pwd",
      currentActivity: "Shell fallback completed: pwd",
    });
  });
});
