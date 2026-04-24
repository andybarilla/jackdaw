import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import {
  createSeededServiceState,
  removeSeededServiceState,
  TEST_AWAITING_INPUT_SESSION_ID,
  TEST_WORKSPACE_ID,
} from "../../test-helpers.js";
import type {
  MutationResponseDto,
  SessionsListDto,
  WorkspaceDetailDto,
} from "../../../shared/transport/dto.js";

let app: FastifyInstance | undefined;
let appDataDir: string | undefined;

async function createTestServer(): Promise<FastifyInstance> {
  const seededState = await createSeededServiceState();
  appDataDir = seededState.appDataDir;
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

describe("session routes", () => {
  it("creates a session for a workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cwd: "/workspace/jackdaw",
        task: "Implement the API route surface",
        name: "API route build",
        repoRoot: "/workspace/jackdaw",
        branch: "feat-loopback-api-event-stream",
      },
    });

    expect(response.statusCode).toBe(202);

    const body = response.json<MutationResponseDto>();

    expect(body.result.ok).toBe(true);

    const sessionsResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
    });

    const sessionsBody = sessionsResponse.json<SessionsListDto>();
    const createdSession = sessionsBody.sessions.find((session) => session.name === "API route build");

    expect(createdSession).toBeDefined();
    expect(createdSession?.status).toBe("running");
  });

  it("rejects invalid session command payloads at runtime", async () => {
    const server = await createTestServer();

    const createResponse = await server.inject({
      method: "POST",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cwd: "/workspace/jackdaw",
      },
    });

    expect(createResponse.statusCode).toBe(400);

    const shellResponse = await server.inject({
      method: "POST",
      url: `/sessions/${TEST_AWAITING_INPUT_SESSION_ID}/shell`,
      payload: {
        sessionId: TEST_AWAITING_INPUT_SESSION_ID,
        extra: true,
      },
    });

    expect(shellResponse.statusCode).toBe(400);
  });

  it("records steer, follow-up, abort, pin-summary, open-path, and shell actions and appends attention history", async () => {
    const server = await createTestServer();
    const sessionId = TEST_AWAITING_INPUT_SESSION_ID;

    const steerResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/steer`,
      payload: {
        sessionId,
        text: "Proceed with the loopback route plugin structure.",
      },
    });
    expect(steerResponse.statusCode).toBe(202);
    expect(steerResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const followUpResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/follow-up`,
      payload: {
        sessionId,
        text: "Also include event payload versioning.",
      },
    });
    expect(followUpResponse.statusCode).toBe(202);
    expect(followUpResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const pinSummaryResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pin-summary`,
      payload: {
        sessionId,
        summary: "Pinned operator summary from the route test.",
      },
    });
    expect(pinSummaryResponse.statusCode).toBe(202);
    expect(pinSummaryResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const openPathResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/open-path`,
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        path: "src/service/server.ts",
        revealInFileManager: true,
      },
    });
    expect(openPathResponse.statusCode).toBe(202);
    expect(openPathResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const shellResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/shell`,
      payload: {
        sessionId,
        command: "npm test -- src/service/api/routes/workspaces.test.ts",
      },
    });
    expect(shellResponse.statusCode).toBe(202);
    expect(shellResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const abortResponse = await server.inject({
      method: "POST",
      url: `/sessions/${sessionId}/abort`,
    });
    expect(abortResponse.statusCode).toBe(202);
    expect(abortResponse.json<MutationResponseDto>().result.ok).toBe(true);

    const sessionsResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}/sessions`,
    });

    const sessionsBody = sessionsResponse.json<SessionsListDto>();
    const updatedSession = sessionsBody.sessions.find((session) => session.id === sessionId);

    expect(updatedSession?.status).toBe("failed");
    expect(updatedSession?.pinnedSummary).toBe("Pinned operator summary from the route test.");
    expect(updatedSession?.lastIntervention?.kind).toBe("abort");
    expect(updatedSession?.recentFiles.some((file) => file.path === "src/service/server.ts")).toBe(true);

    const workspaceResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${TEST_WORKSPACE_ID}`,
    });
    const workspaceBody = workspaceResponse.json<WorkspaceDetailDto>();

    expect(workspaceBody.recentAttention[0]?.sessionId).toBe(sessionId);
    expect(workspaceBody.recentAttention[0]?.title).toContain("Abort");
  });

  it("rejects open-path when workspaceId does not match the session workspace", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "POST",
      url: `/sessions/${TEST_AWAITING_INPUT_SESSION_ID}/open-path`,
      payload: {
        workspaceId: "ws-other",
        path: "src/service/server.ts",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("workspaceId must match the session workspace");
  });

  it("returns 404 for session actions against an unknown session", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/sessions/ses-missing/steer",
      payload: {
        sessionId: "ses-missing",
        text: "Missing session",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toBe("Session not found");
  });
});
