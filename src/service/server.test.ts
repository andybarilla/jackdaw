import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "./server.js";
import { DEMO_WORKSPACE_ID } from "./demo-state.js";
import type { SessionsListDto, WorkspaceDetailDto, WorkspaceSummaryDto } from "../shared/transport/dto.js";

let app: FastifyInstance | undefined;

async function createTestServer(): Promise<FastifyInstance> {
  app = createServer({ appDataDir: "/tmp/jackdaw-test" });
  await app.ready();
  return app;
}

afterEach(async () => {
  vi.unstubAllEnvs();

  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("service server", () => {
  it("returns workspace summaries", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/workspaces",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceSummaryDto[]>();

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]?.id).toBe(DEMO_WORKSPACE_ID);
  });

  it("returns workspace detail with attention-ordered sessions", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: `/workspaces/${DEMO_WORKSPACE_ID}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceDetailDto>();

    expect(body.workspace.id).toBe(DEMO_WORKSPACE_ID);
    expect(body.sessions).toHaveLength(3);
    expect(body.sessions[0]?.status).toBe("awaiting-input");
    expect(body.sessions[1]?.status).toBe("running");
    expect(["idle", "done"]).toContain(body.sessions[2]?.status);
  });

  it("returns the same attention-ordered sessions from the sessions route", async () => {
    const server = await createTestServer();

    const detailResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${DEMO_WORKSPACE_ID}`,
    });
    const sessionsResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${DEMO_WORKSPACE_ID}/sessions`,
    });

    expect(sessionsResponse.statusCode).toBe(200);

    const detailBody = detailResponse.json<WorkspaceDetailDto>();
    const sessionsBody = sessionsResponse.json<SessionsListDto>();

    expect(sessionsBody.workspaceId).toBe(DEMO_WORKSPACE_ID);
    expect(sessionsBody.sessions).toEqual(detailBody.sessions);
    expect(sessionsBody.sessions[0]?.status).toBe("awaiting-input");
    expect(sessionsBody.sessions[1]?.status).toBe("running");
    expect(["idle", "done"]).toContain(sessionsBody.sessions[2]?.status);
  });

  it("returns 404 with a json error body for an unknown workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/workspaces/ws-missing",
    });

    expect(response.statusCode).toBe(404);

    const body = response.json<{ error: string }>();

    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("allows the 127.0.0.1 vite origin in development for health", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://127.0.0.1:5173",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers.vary).toContain("Origin");
  });

  it("allows the localhost vite origin in development for workspaces", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/workspaces",
      headers: {
        origin: "http://localhost:5173",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("does not allow non-allowlisted origins in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://evil.example:5173",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not enable dev cors outside development", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://127.0.0.1:5173",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("handles preflight for an allowed dev origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = await createTestServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/workspaces",
      headers: {
        origin: "http://127.0.0.1:5173",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });
});
