import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import { DEMO_WORKSPACE_ID } from "../../demo-state.js";
import type {
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "../../../shared/transport/dto.js";
import type { HealthResponse } from "../../../shared/transport/api.js";

let app: FastifyInstance | undefined;

async function createTestServer(): Promise<FastifyInstance> {
  app = createServer({ appDataDir: "/tmp/jackdaw-test" });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
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

    expect(body[0]?.id).toBe(DEMO_WORKSPACE_ID);
  });

  it("creates a workspace and returns its detail", async () => {
    const server = await createTestServer();

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

    const listResponse = await server.inject({
      method: "GET",
      url: "/workspaces",
    });

    const summaries = listResponse.json<WorkspaceSummaryDto[]>();

    expect(summaries.some((summary) => summary.id === createdWorkspace.workspace.id)).toBe(true);
  });

  it("updates a workspace and appends a repo root", async () => {
    const server = await createTestServer();

    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/workspaces/${DEMO_WORKSPACE_ID}`,
      payload: {
        name: "Renamed demo workspace",
        description: "Updated by route test",
      },
    });

    expect(patchResponse.statusCode).toBe(200);

    const patchedWorkspace = patchResponse.json<WorkspaceDetailDto>();

    expect(patchedWorkspace.workspace.name).toBe("Renamed demo workspace");
    expect(patchedWorkspace.workspace.description).toBe("Updated by route test");

    const repoResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${DEMO_WORKSPACE_ID}/repos`,
      payload: {
        path: "/workspace/another-repo",
        name: "another-repo",
        defaultBranch: "main",
      },
    });

    expect(repoResponse.statusCode).toBe(200);

    const repoWorkspace = repoResponse.json<WorkspaceDetailDto>();

    expect(repoWorkspace.workspace.repoRoots.some((repoRoot) => repoRoot.path === "/workspace/another-repo")).toBe(true);
  });

  it("returns workspace detail and sessions for the seeded workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: `/workspaces/${DEMO_WORKSPACE_ID}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceDetailDto>();

    expect(body.workspace.id).toBe(DEMO_WORKSPACE_ID);
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
