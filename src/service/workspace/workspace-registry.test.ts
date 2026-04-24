import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { WorkspaceRepoRoot, WorkspaceWorktree } from "../../shared/domain/workspace.js";
import { WorkspaceRegistry } from "./workspace-registry.js";
import { AppStore } from "../persistence/app-store.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import type { PersistedAppState } from "../persistence/schema.js";

const repoRoot: WorkspaceRepoRoot = {
  id: "repo-1",
  path: "/repos/jackdaw",
  name: "jackdaw",
  defaultBranch: "main",
};

const worktree: WorkspaceWorktree = {
  id: "worktree-1",
  repoRootId: repoRoot.id,
  path: "/repos/jackdaw/.worktrees/task-3",
  branch: "task-3",
  label: "Task 3",
};

function createSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: overrides.id ?? "session-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    name: overrides.name ?? "Implement task 3",
    repoRoot: overrides.repoRoot ?? repoRoot.path,
    worktree: overrides.worktree ?? worktree.path,
    cwd: overrides.cwd ?? worktree.path,
    branch: overrides.branch ?? worktree.branch,
    runtime: overrides.runtime ?? {
      agent: "implementer",
      model: "sonnet",
      runtime: "pi",
    },
    status: overrides.status ?? "idle",
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
    updatedAt: overrides.updatedAt ?? "2026-04-24T11:00:00.000Z",
    completedAt: overrides.completedAt,
    hqSessionId: overrides.hqSessionId,
  };
}

function createArtifact(overrides: Partial<WorkspaceArtifact> = {}): WorkspaceArtifact {
  return {
    id: overrides.id ?? "artifact-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    kind: overrides.kind ?? "plan",
    title: overrides.title ?? "Workspace plan",
    filePath: overrides.filePath ?? "docs/plan.md",
    sourceSessionId: overrides.sourceSessionId,
    linkedSessionIds: overrides.linkedSessionIds ?? [],
    linkedWorkItemIds: overrides.linkedWorkItemIds ?? [],
    createdAt: overrides.createdAt ?? "2026-04-24T10:30:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-24T11:00:00.000Z",
    hqArtifactId: overrides.hqArtifactId,
  };
}

describe("WorkspaceRegistry", () => {
  const directories: string[] = [];
  let originalAppDataDir: string | undefined;

  beforeEach(() => {
    originalAppDataDir = process.env.JACKDAW_APP_DATA_DIR;
  });

  afterEach(async () => {
    if (originalAppDataDir === undefined) {
      delete process.env.JACKDAW_APP_DATA_DIR;
    } else {
      process.env.JACKDAW_APP_DATA_DIR = originalAppDataDir;
    }

    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("creates, persists, and reloads a workspace with linked sessions and artifacts", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-registry-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const registry = await WorkspaceRegistry.load();
    await registry.createWorkspace({
      id: "ws-1",
      name: "Workspace 1",
      description: "Local workspace",
      repoRoots: [repoRoot],
      worktrees: [worktree],
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z",
    });
    await registry.upsertSession(createSession({
      linkedResources: {
        artifactIds: ["artifact-1"],
        workItemIds: ["task-3"],
        reviewIds: ["review-1"],
      },
    }), "2026-04-24T11:05:00.000Z");
    await registry.upsertArtifact(createArtifact({
      sourceSessionId: "session-1",
      linkedSessionIds: ["session-1"],
      linkedWorkItemIds: ["task-3"],
    }));

    const reloadedRegistry = await WorkspaceRegistry.load();
    const detail = reloadedRegistry.getWorkspaceDetail("ws-1");

    expect(detail?.workspace.sessionIds).toEqual(["session-1"]);
    expect(detail?.workspace.artifactIds).toEqual(["artifact-1"]);
    expect(detail?.sessions[0]?.linkedResources.artifactIds).toEqual(["artifact-1"]);
    expect(detail?.artifacts[0]?.linkedSessionIds).toEqual(["session-1"]);
    expect(detail?.lastOpenedAt).toBe("2026-04-24T11:05:00.000Z");
  });

  it("removes repo roots without silently deleting historical sessions", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-registry-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const registry = await WorkspaceRegistry.load();
    await registry.createWorkspace({
      id: "ws-1",
      name: "Workspace 1",
      repoRoots: [repoRoot],
      worktrees: [worktree],
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z",
    });
    await registry.upsertSession(createSession({
      status: "done",
      reconnectNote: "Keep this historical session visible.",
      completedAt: "2026-04-24T11:00:00.000Z",
    }));

    const updatedDetail = await registry.removeRepoRoot("ws-1", repoRoot.id, "2026-04-24T11:10:00.000Z");

    expect(updatedDetail?.workspace.repoRoots).toEqual([]);
    expect(updatedDetail?.workspace.worktrees).toEqual([]);
    expect(updatedDetail?.workspace.sessionIds).toEqual(["session-1"]);
    expect(updatedDetail?.sessions).toHaveLength(1);
    expect(updatedDetail?.sessions[0]).toMatchObject({
      id: "session-1",
      status: "done",
      repoRoot: repoRoot.path,
      worktree: worktree.path,
    });
  });

  it("rejects workspace creation when a worktree points to a missing repo root", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-registry-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const registry = await WorkspaceRegistry.load();

    await expect(() => registry.createWorkspace({
      id: "ws-1",
      name: "Workspace 1",
      repoRoots: [repoRoot],
      worktrees: [
        {
          ...worktree,
          repoRootId: "missing-repo-root",
        },
      ],
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z",
    })).rejects.toThrow(/missing repo root/i);
  });

  it("updates workspace metadata without losing persisted local state", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-registry-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const registry = await WorkspaceRegistry.load();
    await registry.createWorkspace({
      id: "ws-1",
      name: "Workspace 1",
      repoRoots: [repoRoot],
      worktrees: [worktree],
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z",
    });
    await registry.upsertSession(createSession({ id: "session-1" }));
    await registry.upsertSession(createSession({
      id: "session-2",
      name: "Follow-up session",
      updatedAt: "2026-04-24T11:01:00.000Z",
    }));

    const updatedDetail = await registry.updateWorkspace("ws-1", {
      description: "Updated local metadata",
      preferences: {
        selectedSessionId: "session-2",
        detailView: "events",
      },
      updatedAt: "2026-04-24T11:15:00.000Z",
    });

    expect(updatedDetail?.workspace.description).toBe("Updated local metadata");
    expect(updatedDetail?.workspace.preferences).toMatchObject({
      selectedSessionId: "session-2",
      detailView: "events",
    });
    expect(updatedDetail?.workspace.sessionIds).toEqual(["session-1", "session-2"]);
    expect(updatedDetail?.sessions.map((session) => session.id)).toEqual(["session-1", "session-2"]);
  });

  it("keeps in-memory state unchanged when app-state persistence fails and recovers the workspace on next load", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-registry-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    class FailingAppStore extends AppStore {
      override async load(): Promise<PersistedAppState> {
        return {
          version: 1,
          workspaces: [],
        };
      }

      override async save(): Promise<void> {
        throw new Error("app-state write failed");
      }
    }

    const registry = await WorkspaceRegistry.load({
      appStore: new FailingAppStore(path.join(appDataDir, "app-state.json")),
      workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
      workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
    });

    await expect(() => registry.createWorkspace({
      id: "ws-1",
      name: "Workspace 1",
      repoRoots: [repoRoot],
      worktrees: [worktree],
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T10:00:00.000Z",
    })).rejects.toThrow(/app-state write failed/i);

    expect(registry.listWorkspaces()).toEqual([]);
    expect(registry.getWorkspaceDetail("ws-1")).toBeUndefined();

    const recoveredRegistry = await WorkspaceRegistry.load({
      appStore: new AppStore(path.join(appDataDir, "app-state.json")),
      workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir, "workspaces", workspaceId, "workspace.json")),
      workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
    });

    expect(recoveredRegistry.listWorkspaces().map((workspace) => workspace.id)).toEqual(["ws-1"]);
    expect(recoveredRegistry.getWorkspaceDetail("ws-1")?.workspace.name).toBe("Workspace 1");
    await expect(readFile(path.join(appDataDir, "app-state.json"), "utf8")).resolves.toContain('"id": "ws-1"');
  });
});
