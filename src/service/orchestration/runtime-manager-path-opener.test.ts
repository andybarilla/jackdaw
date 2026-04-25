import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import { AppStore } from "../persistence/app-store.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import { WorkspaceRegistry } from "../workspace/workspace-registry.js";
import type { ManagedPiSession, PiSessionAdapter, ReconnectPiSessionOptions, SpawnPiSessionOptions } from "./session-adapter.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));

class UnusedSessionAdapter implements PiSessionAdapter {
  async spawnSession(_options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    throw new Error("spawnSession is not used in this test");
  }

  async reconnectSession(_options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    throw new Error("reconnectSession is not used in this test");
  }
}

interface FakeDetachedChildProcess extends EventEmitter {
  unref: () => void;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })));
});

beforeEach(() => {
  spawnMock.mockReset();
});

async function createRegistry(): Promise<{ registry: WorkspaceRegistry; appDataDir: string }> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-path-opener-"));
  temporaryDirectories.push(appDataDir);
  const registry = await WorkspaceRegistry.load({
    appStore: new AppStore(path.join(appDataDir, "app-state.json")),
    workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
    workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
  });

  return { registry, appDataDir };
}

function createPersistedSession(overrides: Partial<WorkspaceSession>): WorkspaceSession {
  return {
    id: overrides.id ?? "ses-open",
    workspaceId: overrides.workspaceId ?? "ws-1",
    name: overrides.name ?? "Open path session",
    repoRoot: overrides.repoRoot ?? "/workspace/repo",
    worktree: overrides.worktree,
    cwd: overrides.cwd ?? overrides.repoRoot ?? "/workspace/repo",
    branch: overrides.branch,
    runtime: overrides.runtime ?? { agent: "implementer", model: "sonnet", runtime: "pi" },
    status: overrides.status ?? "idle",
    liveSummary: overrides.liveSummary ?? "Idle",
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

function createErroredDetachedChildProcess(error: Error): FakeDetachedChildProcess {
  const child = new EventEmitter() as FakeDetachedChildProcess;
  child.unref = vi.fn<() => void>();
  queueMicrotask((): void => {
    child.emit("error", error);
  });
  return child;
}

describe("RuntimeManager default path opener", () => {
  it("rejects open path commands when the platform opener cannot spawn", async () => {
    const { RuntimeManager } = await import("./runtime-manager.js");
    const { registry, appDataDir } = await createRegistry();
    const repoPath = path.join(appDataDir, "repo-one");
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Repo\n");
    await registry.createWorkspace({
      id: "ws-1",
      name: "Workspace ws-1",
      repoRoots: [{ id: "repo-1", path: repoPath, name: "repo-one", defaultBranch: "main" }],
      worktrees: [],
      createdAt: "2026-04-25T09:00:00.000Z",
      updatedAt: "2026-04-25T09:00:00.000Z",
    });
    await registry.upsertSession(createPersistedSession({
      id: "ses-open",
      workspaceId: "ws-1",
      repoRoot: repoPath,
      cwd: repoPath,
    }));
    spawnMock.mockImplementation((_command: unknown, _args: unknown, _options: unknown): FakeDetachedChildProcess => {
      return createErroredDetachedChildProcess(new Error("platform opener missing"));
    });
    const runtimeManager = new RuntimeManager({ registry, adapter: new UnusedSessionAdapter() });

    const result = await runtimeManager.openSessionPath("ses-open", {
      workspaceId: "ws-1",
      path: "README.md",
      revealInFileManager: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "platform opener missing",
    });
    expect(spawnMock).toHaveBeenCalledOnce();
  });
});
