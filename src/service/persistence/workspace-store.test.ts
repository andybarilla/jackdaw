import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspacePersistencePaths } from "./paths.js";
import { WorkspaceStore } from "./workspace-store.js";
import type { PersistedWorkspaceState } from "./schema.js";

const persistedWorkspaceState: PersistedWorkspaceState = {
  version: 1,
  workspace: {
    id: "ws-1",
    name: "Workspace 1",
    description: "Local workspace",
    repoRoots: [
      {
        id: "repo-1",
        path: "/repos/jackdaw",
        name: "jackdaw",
        defaultBranch: "main",
      },
    ],
    worktrees: [
      {
        id: "worktree-1",
        repoRootId: "repo-1",
        path: "/repos/jackdaw/.worktrees/task-3",
        branch: "task-3",
        label: "Task 3",
      },
    ],
    sessionIds: ["session-1"],
    artifactIds: ["artifact-1"],
    preferences: {
      selectedSessionId: "session-1",
      detailView: "summary",
    },
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T11:00:00.000Z",
  },
  sessions: [
    {
      id: "session-1",
      workspaceId: "ws-1",
      name: "Implement task 3",
      repoRoot: "/repos/jackdaw",
      worktree: "/repos/jackdaw/.worktrees/task-3",
      cwd: "/repos/jackdaw/.worktrees/task-3",
      branch: "task-3",
      runtime: {
        agent: "implementer",
        model: "sonnet",
        runtime: "pi",
      },
      status: "idle",
      liveSummary: "summary",
      pinnedSummary: "Pinned summary",
      recentFiles: [
        {
          path: "src/service/workspace/workspace-registry.ts",
          operation: "edited",
          timestamp: "2026-04-24T11:00:00.000Z",
        },
      ],
      linkedResources: {
        artifactIds: ["artifact-1"],
        workItemIds: ["task-3"],
        reviewIds: ["review-1"],
      },
      connectionState: "historical",
      reconnectNote: "Metadata remains visible locally.",
      updatedAt: "2026-04-24T11:00:00.000Z",
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      workspaceId: "ws-1",
      kind: "plan",
      title: "Workspace plan",
      filePath: "docs/plan.md",
      sourceSessionId: "session-1",
      linkedSessionIds: ["session-1"],
      linkedWorkItemIds: ["task-3"],
      createdAt: "2026-04-24T10:30:00.000Z",
      updatedAt: "2026-04-24T11:00:00.000Z",
    },
  ],
};

describe("WorkspaceStore", () => {
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

  it("returns undefined when the workspace persistence file is missing", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-store-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const store = WorkspaceStore.default("ws-1");

    await expect(store.load()).resolves.toBeUndefined();
  });

  it("rejects malformed persisted data safely", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-store-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const paths = resolveWorkspacePersistencePaths("ws-1");
    await mkdir(paths.workspaceDirectoryPath, { recursive: true });
    await writeFile(paths.workspaceStateFilePath, '{"version":1,"workspace":"oops"}');

    const store = WorkspaceStore.default("ws-1");

    await expect(store.load()).rejects.toThrow("Failed to load persisted workspace state");
  });

  it("saves workspace state atomically via temporary file rename", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-store-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const store = WorkspaceStore.default("ws-1");
    const paths = resolveWorkspacePersistencePaths("ws-1");

    await store.save(persistedWorkspaceState);

    await expect(store.load()).resolves.toEqual(persistedWorkspaceState);
    expect(await readFile(paths.workspaceStateFilePath, "utf8")).toContain('"workspace"');
    expect((await readdir(paths.workspaceDirectoryPath)).sort()).toEqual(["artifacts", "cache", "workspace.json"]);
  });

  it("creates restrictive persistence directories and preserves session and artifact links on reload", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-store-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const store = WorkspaceStore.default("ws-1");
    const paths = resolveWorkspacePersistencePaths("ws-1");

    await store.save(persistedWorkspaceState);

    const reloadedState = await store.load();

    expect(reloadedState).toEqual(persistedWorkspaceState);
    expect(reloadedState?.sessions[0]?.linkedResources.artifactIds).toEqual(["artifact-1"]);
    expect(reloadedState?.artifacts[0]?.linkedSessionIds).toEqual(["session-1"]);
    expect((await stat(paths.workspaceDirectoryPath)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.workspaceStateFilePath)).mode & 0o777).toBe(0o600);
  });

  it("serializes concurrent saves and keeps only the latest workspace state", async () => {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-store-"));
    directories.push(appDataDir);
    process.env.JACKDAW_APP_DATA_DIR = appDataDir;

    const store = WorkspaceStore.default("ws-1");
    const paths = resolveWorkspacePersistencePaths("ws-1");
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);

    try {
      await Promise.all([
        store.save(persistedWorkspaceState),
        store.save({
          ...persistedWorkspaceState,
          workspace: {
            ...persistedWorkspaceState.workspace,
            updatedAt: "2026-04-24T11:05:00.000Z",
          },
        }),
      ]);
    } finally {
      dateNowSpy.mockRestore();
    }

    await expect(store.load()).resolves.toEqual({
      ...persistedWorkspaceState,
      workspace: {
        ...persistedWorkspaceState.workspace,
        updatedAt: "2026-04-24T11:05:00.000Z",
      },
    });
    expect((await readdir(paths.workspaceDirectoryPath)).sort()).toEqual(["artifacts", "cache", "workspace.json"]);
  });
});
