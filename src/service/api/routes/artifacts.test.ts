import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { Workspace } from "../../../shared/domain/workspace.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import type { ArtifactDetailDto, WorkspaceDetailDto } from "../../../shared/transport/dto.js";

const tempDirs: string[] = [];
let app: FastifyInstance | undefined;

async function createTempRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jackdaw-artifact-routes-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }

  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createWorkspace(repoPath: string): Workspace {
  return {
    id: "ws-route-test",
    name: "Route Test Workspace",
    repoRoots: [{ id: "repo-route-test", path: repoPath, name: "repo" }],
    worktrees: [],
    sessionIds: ["session-route-test"],
    artifactIds: ["artifact-seeded-plan"],
    preferences: {},
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
  };
}

function createSession(repoPath: string): WorkspaceSession {
  return {
    id: "session-route-test",
    workspaceId: "ws-route-test",
    name: "Route test session",
    repoRoot: repoPath,
    cwd: repoPath,
    runtime: {},
    status: "running",
    liveSummary: "Opening a linked seeded plan.",
    recentFiles: [],
    linkedResources: { artifactIds: ["artifact-seeded-plan"], workItemIds: [], reviewIds: [] },
    connectionState: "live",
    updatedAt: "2026-04-24T10:05:00.000Z",
  };
}

function createSeededArtifact(): WorkspaceArtifact {
  return {
    id: "artifact-seeded-plan",
    workspaceId: "ws-route-test",
    kind: "plan",
    title: "Seeded route plan",
    filePath: "docs/superpowers/plans/2026-04-24-route-plan.md",
    linkedSessionIds: ["session-route-test"],
    linkedWorkItemIds: [],
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  };
}

function createStore(detail: WorkspaceDetailDto): DemoStateStore {
  return {
    listWorkspaces: () => [],
    getWorkspaceDetail: (workspaceId: string) => workspaceId === detail.workspace.id ? detail : undefined,
    getWorkspaceSessions: () => undefined,
    getSessionWorkspaceId: () => undefined,
    createWorkspace: () => { throw new Error("not implemented"); },
    updateWorkspace: () => undefined,
    addWorkspaceRepo: () => undefined,
    createWorkspaceSession: () => undefined,
    steerSession: () => undefined,
    followUpSession: () => undefined,
    abortSession: () => undefined,
    pinSessionSummary: () => undefined,
    openSessionPath: () => undefined,
    runSessionShell: () => undefined,
  };
}

describe("artifact routes", () => {
  it("opens a linked seeded artifact using its canonical id", async () => {
    const repoPath = await createTempRepo();
    const artifactPath = path.join(repoPath, "docs/superpowers/plans/2026-04-24-route-plan.md");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "# Route plan\n\nSeeded content.", { encoding: "utf8" });

    app = createServer({
      appDataDir: "/tmp/jackdaw-test",
      store: createStore({
        workspace: createWorkspace(repoPath),
        sessions: [createSession(repoPath)],
        artifacts: [createSeededArtifact()],
        recentAttention: [],
      }),
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/workspaces/ws-route-test/artifacts/artifact-seeded-plan",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ArtifactDetailDto>()).toEqual(expect.objectContaining({
      artifact: expect.objectContaining({ id: "artifact-seeded-plan" }),
      content: "# Route plan\n\nSeeded content.",
      readOnly: true,
    }));
  });
});
