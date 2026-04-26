import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
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
import { RuntimeManager } from "./runtime-manager.js";

class FakeManagedSession implements ManagedPiSession {
  readonly prompt = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly steer = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly followUp = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly abort = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  readonly dispose = vi.fn<() => void>();

  constructor(
    readonly sessionId: string,
    readonly sessionFile: string | undefined,
    readonly modelId: string | undefined = "sonnet",
  ) {}

  subscribe(_listener: PiSessionEventListener): () => void {
    return (): void => undefined;
  }
}

class FakeSessionAdapter implements PiSessionAdapter {
  readonly reconnectInputs: ReconnectPiSessionOptions[] = [];
  reconnectResult: ManagedPiSession | Error | undefined;

  async spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    return new FakeManagedSession(`spawned-${options.workspaceId}`, `${options.cwd}/session.json`, options.modelId);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    this.reconnectInputs.push(options);
    if (this.reconnectResult instanceof Error) {
      throw this.reconnectResult;
    }

    return this.reconnectResult ?? new FakeManagedSession(options.sessionId, options.sessionFile, options.modelId);
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })));
});

describe("ReconnectManager", () => {
  it("delegates through a structural reconnect runtime instead of requiring an in-process RuntimeManager instance", async () => {
    const reconnectPersistedSessions = vi.fn<(_: string | undefined) => Promise<[]>>().mockResolvedValue([]);
    const reconnectManager = new ReconnectManager({ runtimeManager: { reconnectPersistedSessions } });

    await expect(reconnectManager.reconnectAll()).resolves.toEqual([]);
    await expect(reconnectManager.reconnectWorkspace("ws-remote-ready")).resolves.toEqual([]);

    expect(reconnectPersistedSessions).toHaveBeenNthCalledWith(1);
    expect(reconnectPersistedSessions).toHaveBeenNthCalledWith(2, "ws-remote-ready");
  });

  it("keeps already historical sessions visible without changing their restart ordering", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir);
    await registry.upsertSession(createPersistedSession({
      id: "ses-history",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      status: "done",
      connectionState: "historical",
      liveSummary: "Completed historical summary.",
      updatedAt: "2026-04-25T09:10:00.000Z",
      reconnectNote: "Completed earlier and retained for history.",
    }));
    await registry.updateWorkspace("ws-1", {
      preferences: { selectedSessionId: "ses-history" },
      updatedAt: "2026-04-25T09:11:00.000Z",
    });
    const adapter = new FakeSessionAdapter();
    const runtimeManager = new RuntimeManager({ registry, adapter });
    const reconnectManager = new ReconnectManager(runtimeManager);

    const results = await reconnectManager.reconnectAll();
    const detail = registry.getWorkspaceDetail("ws-1");
    const session = detail?.sessions.find((candidate) => candidate.id === "ses-history");

    expect(results).toEqual([{ workspaceId: "ws-1", sessionId: "ses-history", connectionState: "historical" }]);
    expect(adapter.reconnectInputs).toEqual([]);
    expect(detail?.workspace.preferences.selectedSessionId).toBe("ses-history");
    expect(session).toMatchObject({
      connectionState: "historical",
      liveSummary: "Completed historical summary.",
      reconnectNote: "Completed earlier and retained for history.",
      updatedAt: "2026-04-25T09:10:00.000Z",
    });
  });

  it("falls back unreconnectable live sessions to explicit historical-only records with context intact", async () => {
    const { registry, appDataDir } = await createRegistry();
    const workspace = await addWorkspace(registry, appDataDir);
    await registry.upsertArtifact(createArtifact(workspace.repoRoot.path));
    await registry.upsertSession(createPersistedSession({
      id: "ses-unreconnectable",
      workspaceId: "ws-1",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      branch: workspace.worktree.branch,
      status: "running",
      connectionState: "live",
      liveSummary: "Implemented restart recovery hardening.",
      linkedResources: { artifactIds: ["artifact-plan"], workItemIds: ["task-10"], reviewIds: ["review-10"] },
      recentFiles: [{ path: "src/service/orchestration/reconnect-manager.ts", operation: "edited" }],
      updatedAt: "2026-04-25T09:20:00.000Z",
    }));
    await registry.updateWorkspace("ws-1", {
      preferences: { selectedSessionId: "ses-unreconnectable" },
      updatedAt: "2026-04-25T09:21:00.000Z",
    });
    const runtimeManager = new RuntimeManager({ registry, adapter: new FakeSessionAdapter() });
    const reconnectManager = new ReconnectManager(runtimeManager);

    const results = await reconnectManager.reconnectAll();
    const detail = registry.getWorkspaceDetail("ws-1");
    const session = detail?.sessions.find((candidate) => candidate.id === "ses-unreconnectable");

    expect(results).toEqual([{ workspaceId: "ws-1", sessionId: "ses-unreconnectable", connectionState: "historical" }]);
    expect(detail?.workspace.preferences.selectedSessionId).toBe("ses-unreconnectable");
    expect(session).toMatchObject({
      id: "ses-unreconnectable",
      connectionState: "historical",
      liveSummary: "Implemented restart recovery hardening.",
      repoRoot: workspace.repoRoot.path,
      worktree: workspace.worktree.path,
      cwd: workspace.worktree.path,
      branch: workspace.worktree.branch,
      linkedResources: { artifactIds: ["artifact-plan"], workItemIds: ["task-10"], reviewIds: ["review-10"] },
      recentFiles: [{ path: "src/service/orchestration/reconnect-manager.ts", operation: "edited" }],
      reconnectNote: expect.stringContaining("Historical-only state"),
    });
  });
});

async function createRegistry(): Promise<{ registry: WorkspaceRegistry; appDataDir: string }> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-reconnect-manager-"));
  temporaryDirectories.push(appDataDir);
  const registry = await WorkspaceRegistry.load({
    appStore: new AppStore(path.join(appDataDir, "app-state.json")),
    workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
    workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
  });

  return { registry, appDataDir };
}

async function addWorkspace(registry: WorkspaceRegistry, appDataDir: string): Promise<{
  repoRoot: WorkspaceRepoRoot;
  worktree: WorkspaceWorktree;
}> {
  const repoPath = path.join(appDataDir, "repo-one");
  const worktreePath = path.join(repoPath, ".worktrees", "task-10");
  await mkdir(worktreePath, { recursive: true });

  const repoRoot: WorkspaceRepoRoot = {
    id: "repo-1",
    path: repoPath,
    name: "repo-one",
    defaultBranch: "main",
  };
  const worktree: WorkspaceWorktree = {
    id: "worktree-1",
    repoRootId: repoRoot.id,
    path: worktreePath,
    branch: "task-10-restart-recovery-hardening",
    label: "Task 10",
  };

  await registry.createWorkspace({
    id: "ws-1",
    name: "Workspace 1",
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

function createArtifact(repoPath: string): WorkspaceArtifact {
  return {
    id: "artifact-plan",
    workspaceId: "ws-1",
    kind: "plan",
    title: "Task 10 plan",
    filePath: path.join(repoPath, "docs/superpowers/plans/2026-04-17-workspace-gui-successor.md"),
    sourceSessionId: undefined,
    linkedSessionIds: [],
    linkedWorkItemIds: ["task-10"],
    createdAt: "2026-04-25T09:05:00.000Z",
    updatedAt: "2026-04-25T09:05:00.000Z",
  };
}
