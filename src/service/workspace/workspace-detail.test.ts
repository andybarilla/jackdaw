import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { Workspace } from "../../shared/domain/workspace.js";
import type { WorkspaceDetailDto } from "../../shared/transport/dto.js";
import { mergeIndexedArtifacts } from "./workspace-detail.js";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jackdaw-detail-"));
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
    sessionIds: [],
    artifactIds: [],
    preferences: {},
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
  };
}

function createDetail(repoPath: string, artifacts: WorkspaceArtifact[]): WorkspaceDetailDto {
  return {
    workspace: createWorkspace(repoPath),
    sessions: [],
    artifacts,
    recentAttention: [],
  };
}

describe("mergeIndexedArtifacts", () => {
  it("removes stale file-backed artifacts when their files disappear", async () => {
    const repoPath = await createTempRepo();
    const planPath = path.join(repoPath, "docs/superpowers/plans/2026-04-24-workspace-context.md");
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, "# Workspace context plan\n", { encoding: "utf8" });

    const detailWithIndexedArtifacts = await mergeIndexedArtifacts(createDetail(repoPath, [{
      id: "artifact-summary",
      workspaceId: "ws-test",
      kind: "summary-snapshot",
      title: "Manual summary",
      linkedSessionIds: [],
      linkedWorkItemIds: [],
      createdAt: "2026-04-24T09:00:00.000Z",
      updatedAt: "2026-04-24T09:00:00.000Z",
    }]));
    const indexedArtifact = detailWithIndexedArtifacts.artifacts.find((artifact) => artifact.filePath !== undefined);
    expect(indexedArtifact).toEqual(expect.objectContaining({
      title: "Workspace context plan",
      filePath: "docs/superpowers/plans/2026-04-24-workspace-context.md",
      repoRootId: "repo-test",
    }));

    await unlink(planPath);

    const refreshedDetail = await mergeIndexedArtifacts(detailWithIndexedArtifacts);

    expect(refreshedDetail.artifacts).toEqual([expect.objectContaining({ id: "artifact-summary" })]);
  });
});
