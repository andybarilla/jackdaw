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
