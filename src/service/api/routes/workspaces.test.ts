import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import {
  createEmptyServiceState,
  createSeededServiceState,
  removeSeededServiceState,
  TEST_WORKSPACE_ID,
} from "../../test-helpers.js";
import type {
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "../../../shared/transport/dto.js";
import type { HealthResponse } from "../../../shared/transport/api.js";

let app: FastifyInstance | undefined;
let appDataDir: string | undefined;

async function createTestServer(seed: boolean = true): Promise<FastifyInstance> {
  const serviceState = seed ? await createSeededServiceState() : await createEmptyServiceState();
  appDataDir = serviceState.appDataDir;
  app = createServer({ appDataDir });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }

  if (appDataDir !== undefined) {
    await removeSeededServiceState(appDataDir);
    appDataDir = undefined;
  }
});

describe("workspace routes", () => {
  it("returns health with service version metadata", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();

    expect(body.ok).toBe(true);
    expect(body.service).toBe("jackdaw-service");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("lists workspace summaries", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/workspaces",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceSummaryDto[]>();

    expect(body[0]?.id).toBe(TEST_WORKSPACE_ID);
  });

  it("creates a workspace and returns its detail", async () => {
    const server = await createTestServer(false);

    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Workspace API Test",
        description: "Created through the loopback API",
        repoRoots: ["/workspace/new-repo"],
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const createdWorkspace = createResponse.json<WorkspaceDetailDto>();

    expect(createdWorkspace.workspace.name).toBe("Workspace API Test");
    expect(createdWorkspace.workspace.repoRoots).toHaveLength(1);
    expect(createdWorkspace.sessions).toEqual([]);
    expect(createdWorkspace.recentAttention[0]?.title).toBe("Workspace created");
    expect(createdWorkspace.recentAttention[0]?.detail).toContain("Workspace API Test");

    const listResponse = await server.inject({
      method: "GET",
      url: "/workspaces",
    });

    const summaries = listResponse.json<WorkspaceSummaryDto[]>();

    expect(summaries.some((summary) => summary.id === createdWorkspace.workspace.id)).toBe(true);
  });

  it("does not reuse a corrupt discovered workspace directory id", async () => {
    const serviceState = await createEmptyServiceState();
    appDataDir = serviceState.appDataDir;
    const staleWorkspaceJsonPath = path.join(appDataDir, "workspaces", "ws-1", "workspace.json");
    await mkdir(path.dirname(staleWorkspaceJsonPath), { recursive: true });
    await writeFile(staleWorkspaceJsonPath, "{not-json", "utf8");

    app = createServer({ appDataDir });
    await app.ready();
    const server = app;

    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Workspace after corrupt state",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json<WorkspaceDetailDto>().workspace.id).toBe("ws-2");
    await expect(readFile(staleWorkspaceJsonPath, "utf8")).resolves.toBe("{not-json");
  });

  it("creates a workspace with an initial registered worktree", async () => {
    const server = await createTestServer(false);

    const response = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Workspace with worktree",
        repoRoots: ["/workspace/new-repo"],
        worktrees: [{
          repoRootPath: "/workspace/new-repo",
          path: "/workspace/new-repo/.worktrees/task-10",
          branch: "task-10",
          label: "Task 10",
        }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<WorkspaceDetailDto>().workspace.worktrees).toEqual([
      expect.objectContaining({
        repoRootId: "repo-1",
        path: "/workspace/new-repo/.worktrees/task-10",
        branch: "task-10",
        label: "Task 10",
      }),
    ]);
  });

  it("registers a worktree under an existing workspace repo root", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/worktrees`,
      payload: {
        repoRootId: "repo-1",
        path: "/workspace/jackdaw/.worktrees/task-10",
        branch: "task-10-restart-recovery-hardening",
        label: "Task 10",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<WorkspaceDetailDto>().workspace.worktrees).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "wt-1",
        repoRootId: "repo-1",
        path: "/workspace/jackdaw/.worktrees/task-10",
        branch: "task-10-restart-recovery-hardening",
        label: "Task 10",
      }),
    ]));
  });

  it("rejects invalid worktree registrations", async () => {
    const server = await createTestServer();

    const missingRepoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/worktrees`,
      payload: {
        repoRootId: "repo-missing",
        path: "/workspace/jackdaw/.worktrees/missing-repo",
      },
    });

    expect(missingRepoResponse.statusCode).toBe(400);
    expect(missingRepoResponse.json<{ error: string }>().error).toContain("repoRootId");

    const outsideRepoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/worktrees`,
      payload: {
        repoRootId: "repo-1",
        path: "/workspace/elsewhere/task-10",
      },
    });

    expect(outsideRepoResponse.statusCode).toBe(400);
    expect(outsideRepoResponse.json<{ error: string }>().error).toContain("must stay inside repo root");
  });

  it("rejects duplicate repo root paths when creating or updating workspaces", async () => {
    const server = await createTestServer();

    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Duplicate repo workspace",
        repoRoots: ["/workspace/dupe", "/workspace/dupe/"],
      },
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json<{ error: string }>().error).toContain("repo root path must be unique");

    const addRepoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/repos`,
      payload: {
        path: "/workspace/jackdaw/",
      },
    });

    expect(addRepoResponse.statusCode).toBe(400);
    expect(addRepoResponse.json<{ error: string }>().error).toContain("repo root path must be unique");

    const relativePathResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Relative repo workspace",
        repoRoots: ["relative/repo"],
      },
    });

    expect(relativePathResponse.statusCode).toBe(400);
    expect(relativePathResponse.json<{ error: string }>().error).toContain("absolute path");
  });

  it("rejects invalid workspace payloads at runtime", async () => {
    const server = await createTestServer();

    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        description: "Missing name",
      },
    });

    expect(createResponse.statusCode).toBe(400);

    const repoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/repos`,
      payload: {
        defaultBranch: "main",
      },
    });

    expect(repoResponse.statusCode).toBe(400);
  });

  it("rejects stale workspace selection ids", async () => {
    const server = await createTestServer();

    const missingSessionResponse = await server.inject({
      method: "PATCH",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
      payload: {
        preferences: {
          selectedSessionId: "ses-missing",
        },
      },
    });

    expect(missingSessionResponse.statusCode).toBe(400);
    expect(missingSessionResponse.json<{ error: string }>().error).toContain("selectedSessionId");

    const missingArtifactResponse = await server.inject({
      method: "PATCH",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
      payload: {
        preferences: {
          selectedArtifactId: "artifact-missing",
        },
      },
    });

    expect(missingArtifactResponse.statusCode).toBe(400);
    expect(missingArtifactResponse.json<{ error: string }>().error).toContain("selectedArtifactId");

    const detailResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
    });
    const detailBody = detailResponse.json<WorkspaceDetailDto>();

    expect(detailBody.workspace.preferences.selectedSessionId).toBeUndefined();
    expect(detailBody.workspace.preferences.selectedArtifactId).toBeUndefined();
  });

  it("updates a workspace and appends a repo root", async () => {
    const server = await createTestServer();

    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
      payload: {
        name: "Renamed demo workspace",
        description: "Updated by route test",
      },
    });

    expect(patchResponse.statusCode).toBe(200);

    const patchedWorkspace = patchResponse.json<WorkspaceDetailDto>();

    expect(patchedWorkspace.workspace.name).toBe("Renamed demo workspace");
    expect(patchedWorkspace.workspace.description).toBe("Updated by route test");
    expect(patchedWorkspace.recentAttention[0]?.title).toBe("Workspace updated");
    expect(patchedWorkspace.recentAttention[0]?.detail).toContain("Renamed demo workspace");

    const repoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/repos`,
      payload: {
        path: "/workspace/another-repo",
        name: "another-repo",
        defaultBranch: "main",
      },
    });

    expect(repoResponse.statusCode).toBe(200);

    const repoWorkspace = repoResponse.json<WorkspaceDetailDto>();

    expect(repoWorkspace.workspace.repoRoots.some((repoRoot) => repoRoot.path === "/workspace/another-repo")).toBe(true);
    expect(repoWorkspace.recentAttention[0]?.title).toBe("Workspace repo added");
    expect(repoWorkspace.recentAttention[0]?.detail).toContain("another-repo");
  });

  it("returns workspace detail and sessions for the seeded workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceDetailDto>();

    expect(body.workspace.id).toBe(TEST_WORKSPACE_ID);
    expect(body.sessions[0]?.status).toBe("awaiting-input");
  });

  it("returns 404 for an unknown workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/workspaces/ws-missing",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toBe("Workspace not found");
  });
});
