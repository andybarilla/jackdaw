import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { Workspace } from "../../shared/domain/workspace.js";
import { indexWorkspaceArtifacts } from "./artifact-index.js";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jackdaw-artifacts-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createWorkspace(repoPath: string): Workspace {
  return {
    id: "ws-test",
    name: "Test Workspace",
    repoRoots: [{ id: "repo-test", path: repoPath, name: "repo" }],
    worktrees: [],
    sessionIds: ["session-plan"],
    artifactIds: [],
    preferences: {},
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
  };
}

function createSession(repoPath: string): WorkspaceSession {
  return {
    id: "session-plan",
    workspaceId: "ws-test",
    name: "Plan work",
    repoRoot: repoPath,
    cwd: repoPath,
    runtime: {},
    status: "running",
    liveSummary: "Editing the plan.",
    recentFiles: [{ path: "docs/superpowers/plans/2026-04-24-workspace-context.md", operation: "edited", timestamp: "2026-04-24T10:05:00.000Z" }],
    linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
    connectionState: "live",
    updatedAt: "2026-04-24T10:05:00.000Z",
  };
}

describe("indexWorkspaceArtifacts", () => {
  it("indexes durable workspace docs by file path, type, and session linkage", async () => {
    const repoPath = await createTempRepo();
    await mkdir(path.join(repoPath, "docs/superpowers/specs"), { recursive: true });
    await mkdir(path.join(repoPath, "docs/superpowers/plans"), { recursive: true });
    await mkdir(path.join(repoPath, "docs/notes"), { recursive: true });
    await writeFile(path.join(repoPath, "docs/superpowers/specs/2026-04-24-workspace-context-design.md"), "# Workspace context design\n\nSpec body.", { encoding: "utf8" });
    await writeFile(path.join(repoPath, "docs/superpowers/plans/2026-04-24-workspace-context.md"), "# Workspace context plan\n\nPlan body.", { encoding: "utf8" });
    await writeFile(path.join(repoPath, "docs/notes/random.md"), "# Not an artifact\n", { encoding: "utf8" });

    const artifacts = await indexWorkspaceArtifacts({
      workspace: createWorkspace(repoPath),
      sessions: [createSession(repoPath)],
    });

    expect(artifacts).toHaveLength(2);
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: "ws-test",
        kind: "spec",
        title: "Workspace context design",
        filePath: "docs/superpowers/specs/2026-04-24-workspace-context-design.md",
        linkedSessionIds: [],
        repoRootId: "repo-test",
      }),
      expect.objectContaining({
        workspaceId: "ws-test",
        kind: "plan",
        title: "Workspace context plan",
        filePath: "docs/superpowers/plans/2026-04-24-workspace-context.md",
        linkedSessionIds: ["session-plan"],
        repoRootId: "repo-test",
      }),
    ]));
    expect(artifacts[0]?.id).toMatch(/^artifact-ws-test-[a-f0-9]{16}$/);
  });

  it("returns an empty index when a repo has no docs directory", async () => {
    const repoPath = await createTempRepo();

    await expect(indexWorkspaceArtifacts({ workspace: createWorkspace(repoPath), sessions: [] })).resolves.toEqual([]);
  });
});
