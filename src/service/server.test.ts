import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "./server.js";
import {
  createEmptyServiceState,
  createSeededServiceState,
  removeSeededServiceState,
  TEST_RUNNING_SESSION_ID,
  TEST_WORKSPACE_ID,
} from "./test-helpers.js";
import type { SessionsListDto, WorkspaceDetailDto, WorkspaceSummaryDto } from "../shared/transport/dto.js";
import type { ManagedPiSession, PiSessionAdapter, PiSessionEventListener, ReconnectPiSessionOptions, SpawnPiSessionOptions } from "./orchestration/session-adapter.js";
import { AppStore } from "./persistence/app-store.js";
import { WorkspaceStore } from "./persistence/workspace-store.js";
import { WorkspaceRegistry } from "./workspace/workspace-registry.js";

class ReconnectableFakePiSessionAdapter implements PiSessionAdapter {
  reconnectCount: number = 0;

  async spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    return new ReconnectableFakeManagedPiSession("pi-spawned", `${options.cwd}/.pi/session.json`, options.modelId);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    this.reconnectCount += 1;
    return new ReconnectableFakeManagedPiSession(options.sessionId, options.sessionFile, options.modelId);
  }
}

class ReconnectableFakeManagedPiSession implements ManagedPiSession {
  constructor(
    readonly sessionId: string,
    readonly sessionFile: string,
    readonly modelId: string | undefined,
  ) {}

  subscribe(_listener: PiSessionEventListener): () => void {
    return (): void => undefined;
  }

  async prompt(): Promise<void> {}
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
}

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
  vi.unstubAllEnvs();

  if (app) {
    await app.close();
    app = undefined;
  }

  if (appDataDir !== undefined) {
    await removeSeededServiceState(appDataDir);
    appDataDir = undefined;
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
    expect(body[0]?.id).toBe(TEST_WORKSPACE_ID);
  });

  it("returns workspace detail with attention-ordered sessions", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<WorkspaceDetailDto>();

    expect(body.workspace.id).toBe(TEST_WORKSPACE_ID);
    expect(body.sessions).toHaveLength(3);
    expect(body.sessions[0]?.status).toBe("awaiting-input");
    expect(body.sessions[1]?.status).toBe("running");
    expect(["idle", "done"]).toContain(body.sessions[2]?.status);
  });

  it("persists workspace mutations across server instances using the app-data directory", async () => {
    const server = await createTestServer(false);

    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Persisted workspace",
        description: "Stored under the resolved app-data directory.",
        repoRoots: ["/workspace/persisted"],
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const createdWorkspace = createResponse.json<WorkspaceDetailDto>();

    await server.close();
    app = undefined;

    app = createServer({ appDataDir: appDataDir as string });
    await app.ready();

    const reloadResponse = await app.inject({
      method: "GET",
      url: `/workspaces/${createdWorkspace.workspace.id}`,
    });

    expect(reloadResponse.statusCode).toBe(200);
    expect(reloadResponse.json<WorkspaceDetailDto>().workspace).toMatchObject({
      id: createdWorkspace.workspace.id,
      name: "Persisted workspace",
      description: "Stored under the resolved app-data directory.",
    });
  });

  it("reattaches persisted pi sessions during service startup", async () => {
    const serviceState = await createSeededServiceState();
    appDataDir = serviceState.appDataDir;
    const registry = await WorkspaceRegistry.load({
      appStore: new AppStore(path.join(appDataDir, "app-state.json")),
      workspaceStoreFactory: (workspaceId: string) => new WorkspaceStore(path.join(appDataDir as string, "workspaces", workspaceId, "workspace.json")),
      workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
    });
    await registry.updateSession(TEST_WORKSPACE_ID, TEST_RUNNING_SESSION_ID, (session) => ({
      ...session,
      connectionState: "historical",
      sessionFile: "/tmp/pi-session.json",
      reconnectNote: "restart pending",
    }));
    const adapter = new ReconnectableFakePiSessionAdapter();

    app = createServer({ appDataDir, piSessionAdapter: adapter });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
    });
    const session = response.json<SessionsListDto>().sessions.find((candidate) => candidate.id === TEST_RUNNING_SESSION_ID);

    expect(adapter.reconnectCount).toBe(1);
    expect(session?.connectionState).toBe("live");
    expect(session?.reconnectNote).toBeUndefined();
  });

  it("returns the same attention-ordered sessions from the sessions route", async () => {
    const server = await createTestServer();

    const detailResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
    });
    const sessionsResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
    });

    expect(sessionsResponse.statusCode).toBe(200);

    const detailBody = detailResponse.json<WorkspaceDetailDto>();
    const sessionsBody = sessionsResponse.json<SessionsListDto>();

    expect(sessionsBody.workspaceId).toBe(TEST_WORKSPACE_ID);
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

  it("allows the packaged file renderer null origin outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "null",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("null");
    expect(response.headers.vary).toContain("Origin");
  });

  it("handles preflight for the packaged file renderer null origin outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await createTestServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/workspaces",
      headers: {
        origin: "null",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("null");
    expect(response.headers["access-control-allow-headers"]).toContain("Last-Event-ID");
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
