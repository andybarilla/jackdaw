import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceSession } from "../shared/domain/session.js";
import type { WorkspaceRepoRoot, WorkspaceWorktree } from "../shared/domain/workspace.js";
import { AppStore } from "./persistence/app-store.js";
import { WorkspaceStore } from "./persistence/workspace-store.js";
import { WorkspaceRegistry } from "./workspace/workspace-registry.js";

export const TEST_WORKSPACE_ID = "ws-1";
export const TEST_AWAITING_INPUT_SESSION_ID = "ses-awaiting-input";
export const TEST_RUNNING_SESSION_ID = "ses-running";
export const TEST_IDLE_SESSION_ID = "ses-idle";

export interface SeededServiceState {
  appDataDir: string;
  workspaceId: string;
  repoRoot: WorkspaceRepoRoot;
  worktree: WorkspaceWorktree;
}

export async function createSeededServiceState(): Promise<SeededServiceState> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-service-"));
  const registry = await WorkspaceRegistry.load({
    appStore: new AppStore(path.join(appDataDir, "app-state.json")),
    workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
    workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
  });

  const repoRoot: WorkspaceRepoRoot = {
    id: "repo-1",
    path: "/workspace/jackdaw",
    name: "jackdaw",
    defaultBranch: "main",
  };
  const worktree: WorkspaceWorktree = {
    id: "worktree-1",
    repoRootId: repoRoot.id,
    path: "/workspace/jackdaw/.worktrees/task-3",
    branch: "task-3-workspace-persistence-registry",
    label: "Task 3",
  };

  await registry.createWorkspace({
    id: TEST_WORKSPACE_ID,
    name: "Seeded workspace",
    description: "Persisted workspace fixture for service tests.",
    repoRoots: [repoRoot],
    worktrees: [worktree],
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  });

  await registry.upsertSession(createSeededSession({
    id: TEST_AWAITING_INPUT_SESSION_ID,
    status: "awaiting-input",
    liveSummary: "Waiting for operator input.",
    latestMeaningfulUpdate: "Need direction before continuing.",
    updatedAt: "2026-04-24T09:05:00.000Z",
    pinnedSummary: "Pinned summary",
    lastIntervention: {
      kind: "follow-up",
      status: "pending-observation",
      text: "Please confirm next step.",
      requestedAt: "2026-04-24T09:04:00.000Z",
    },
    recentFiles: [{
      path: "src/service/server.ts",
      operation: "edited",
      timestamp: "2026-04-24T09:03:00.000Z",
    }],
  }));
  await registry.upsertSession(createSeededSession({
    id: TEST_RUNNING_SESSION_ID,
    status: "running",
    liveSummary: "Implementing persistence wiring.",
    updatedAt: "2026-04-24T09:06:00.000Z",
  }));
  await registry.upsertSession(createSeededSession({
    id: TEST_IDLE_SESSION_ID,
    status: "idle",
    liveSummary: "Waiting for more work.",
    updatedAt: "2026-04-24T09:07:00.000Z",
  }));

  return {
    appDataDir,
    workspaceId: TEST_WORKSPACE_ID,
    repoRoot,
    worktree,
  };
}

export async function createEmptyServiceState(): Promise<{ appDataDir: string }> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-service-empty-"));
  return {
    appDataDir,
  };
}

export async function removeSeededServiceState(appDataDir: string): Promise<void> {
  await rm(appDataDir, { recursive: true, force: true });
}

function createSeededSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: overrides.id ?? TEST_RUNNING_SESSION_ID,
    workspaceId: overrides.workspaceId ?? TEST_WORKSPACE_ID,
    name: overrides.name ?? "Seeded session",
    repoRoot: overrides.repoRoot ?? "/workspace/jackdaw",
    worktree: overrides.worktree ?? "/workspace/jackdaw/.worktrees/task-3",
    cwd: overrides.cwd ?? "/workspace/jackdaw/.worktrees/task-3",
    branch: overrides.branch ?? "task-3-workspace-persistence-registry",
    runtime: overrides.runtime ?? {
      agent: "implementer",
      model: "sonnet",
      runtime: "pi",
    },
    status: overrides.status ?? "running",
    liveSummary: overrides.liveSummary ?? "summary",
    pinnedSummary: overrides.pinnedSummary,
    latestMeaningfulUpdate: overrides.latestMeaningfulUpdate,
    currentActivity: overrides.currentActivity,
    currentTool: overrides.currentTool,
    lastIntervention: overrides.lastIntervention,
    recentFiles: overrides.recentFiles ?? [],
    linkedResources: overrides.linkedResources ?? {
      artifactIds: [],
      workItemIds: [],
      reviewIds: [],
    },
    connectionState: overrides.connectionState ?? "historical",
    sessionFile: overrides.sessionFile,
    reconnectNote: overrides.reconnectNote,
    startedAt: overrides.startedAt,
    updatedAt: overrides.updatedAt ?? "2026-04-24T09:00:00.000Z",
    completedAt: overrides.completedAt,
    hqSessionId: overrides.hqSessionId,
  };
}
