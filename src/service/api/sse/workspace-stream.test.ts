import { afterEach, describe, expect, it, vi } from "vitest";
import http, { type IncomingMessage, type RequestOptions } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import {
  createSeededServiceState,
  removeSeededServiceState,
  TEST_AWAITING_INPUT_SESSION_ID,
  TEST_WORKSPACE_ID,
} from "../../test-helpers.js";
import type { WorkspaceDetailDto, WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";
import type {
  ManagedPiSession,
  PiSessionAdapter,
  PiSessionEventListener,
  ReconnectPiSessionOptions,
  SpawnPiSessionOptions,
} from "../../orchestration/session-adapter.js";

interface SseEventMessage {
  id?: string;
  event?: string;
  data?: WorkspaceStreamEventDto;
}

let app: FastifyInstance | undefined;
let appDataDir: string | undefined;

class PromptFailingPiSessionAdapter implements PiSessionAdapter {
  async spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    return new PromptFailingManagedPiSession("ses-background-prompt-fail", `${options.cwd}/.pi/session.json`, options.modelId);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    return new PromptFailingManagedPiSession(options.sessionId, options.sessionFile, options.modelId);
  }
}

class PromptFailingManagedPiSession implements ManagedPiSession {
  constructor(
    readonly sessionId: string,
    readonly sessionFile: string,
    readonly modelId: string | undefined,
  ) {}

  subscribe(_listener: PiSessionEventListener): () => void {
    return (): void => undefined;
  }

  async prompt(_text: string): Promise<void> {
    throw new Error("provider disconnected");
  }

  async steer(_text: string): Promise<void> {}
  async followUp(_text: string): Promise<void> {}
  async abort(): Promise<void> {}
}

async function createListeningServer(piSessionAdapter?: PiSessionAdapter): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const seededState = await createSeededServiceState();
  appDataDir = seededState.appDataDir;
  app = createServer({ appDataDir, piSessionAdapter });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function connectToWorkspaceEvents(
  baseUrl: string,
  workspaceId: string,
  lastEventId?: string,
  origin?: string,
): Promise<{
  response: IncomingMessage;
  nextEvent: () => Promise<SseEventMessage>;
  close: () => void;
}> {
  const url = new URL(`/workspaces/${workspaceId}/events`, baseUrl);
  const requestOptions: RequestOptions = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
      ...(origin === undefined ? {} : { Origin: origin }),
    },
  };

  return new Promise((resolve, reject) => {
    const request = http.request(requestOptions, (response) => {
      let buffered = "";
      const pendingResolvers: Array<(message: SseEventMessage) => void> = [];
      const queuedMessages: SseEventMessage[] = [];

      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        buffered += chunk;

        while (true) {
          const markerIndex = buffered.indexOf("\n\n");
          if (markerIndex === -1) {
            return;
          }

          const sseMessage = buffered.slice(0, markerIndex);
          buffered = buffered.slice(markerIndex + 2);

          if (sseMessage.startsWith(":")) {
            continue;
          }

          const parsedMessage = parseSseMessage(sseMessage);
          const nextResolver = pendingResolvers.shift();
          if (nextResolver !== undefined) {
            nextResolver(parsedMessage);
            continue;
          }

          queuedMessages.push(parsedMessage);
        }
      });
      response.on("error", reject);

      resolve({
        response,
        nextEvent: () => new Promise<SseEventMessage>((resolveEvent) => {
          const queuedMessage = queuedMessages.shift();
          if (queuedMessage !== undefined) {
            resolveEvent(queuedMessage);
            return;
          }

          pendingResolvers.push(resolveEvent);
        }),
        close: () => {
          request.destroy();
          response.destroy();
        },
      });
    });

    request.on("error", reject);
    request.end();
  });
}

function isFailedStatusChangedEvent(message: SseEventMessage): boolean {
  return message.data?.type === "session.status-changed" && message.data.payload.status === "failed";
}

function parseSseMessage(sseMessage: string): SseEventMessage {
  const message: SseEventMessage = {};

  for (const line of sseMessage.split("\n")) {
    if (line.startsWith("id: ")) {
      message.id = line.slice(4);
      continue;
    }

    if (line.startsWith("event: ")) {
      message.event = line.slice(7);
      continue;
    }

    if (line.startsWith("data: ")) {
      message.data = JSON.parse(line.slice(6)) as WorkspaceStreamEventDto;
    }
  }

  return message;
}

afterEach(async () => {
  vi.unstubAllEnvs();

  if (app !== undefined) {
    await app.close();
    app = undefined;
  }

  if (appDataDir !== undefined) {
    await removeSeededServiceState(appDataDir);
    appDataDir = undefined;
  }
});

describe("workspace SSE stream", () => {
  it("emits a snapshot with an event id when the stream connects", async () => {
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID);

    expect(streamConnection.response.statusCode).toBe(200);
    expect(streamConnection.response.headers["content-type"]).toContain("text/event-stream");

    const snapshotEvent = await streamConnection.nextEvent();

    expect(snapshotEvent.id).toBeDefined();
    expect(snapshotEvent.event).toBe("workspace.snapshot");
    expect(snapshotEvent.data?.version).toBe(1);
    expect(snapshotEvent.data?.payload.workspaceId).toBe(TEST_WORKSPACE_ID);

    streamConnection.close();
  });

  it("includes indexed file-backed artifacts in the initial snapshot", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jackdaw-sse-artifacts-"));
    await fs.mkdir(path.join(repoRoot, "docs", "superpowers", "specs"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "docs", "superpowers", "specs", "2026-04-25-stream-context.md"),
      "# Stream Context Spec\n\nIndexed from a local file-backed workspace.",
      "utf8",
    );

    const { baseUrl } = await createListeningServer();
    const createResponse = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "SSE artifact workspace",
        repoRoots: [repoRoot],
      }),
    });
    const createdWorkspace = await createResponse.json() as WorkspaceDetailDto;
    const streamConnection = await connectToWorkspaceEvents(baseUrl, createdWorkspace.workspace.id);

    try {
      const snapshotEvent = await streamConnection.nextEvent();

      expect(snapshotEvent.event).toBe("workspace.snapshot");
      expect(snapshotEvent.data?.type).toBe("workspace.snapshot");
      if (snapshotEvent.data?.type !== "workspace.snapshot") {
        throw new Error("Expected workspace snapshot event data");
      }
      expect(snapshotEvent.data.payload.detail.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "spec",
          title: "Stream Context Spec",
          filePath: "docs/superpowers/specs/2026-04-25-stream-context.md",
        }),
      ]));
    } finally {
      streamConnection.close();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("replays missed events after the last seen event id", async () => {
    const { baseUrl } = await createListeningServer();
    const firstConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID);
    const snapshotEvent = await firstConnection.nextEvent();

    const mutationResponse = await fetch(`${baseUrl}/workspaces/${TEST_WORKSPACE_ID}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        description: "SSE updated description",
      }),
    });

    expect(mutationResponse.status).toBe(200);

    const publishedEvent = await firstConnection.nextEvent();

    expect(publishedEvent.event).toBe("workspace.updated");
    expect(Number(publishedEvent.id)).toBeGreaterThan(Number(snapshotEvent.id));

    firstConnection.close();

    const replayConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID, snapshotEvent.id);
    const replayedEvent = await replayConnection.nextEvent();

    expect(replayedEvent.id).toBe(publishedEvent.id);
    expect(replayedEvent.event).toBe("workspace.updated");
    expect(replayedEvent.data?.payload.workspaceId).toBe(TEST_WORKSPACE_ID);

    replayConnection.close();
  });

  it("falls back to a snapshot when reconnect replay history is unavailable", async () => {
    const { baseUrl } = await createListeningServer();
    const replayConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID, "7");

    const snapshotEvent = await replayConnection.nextEvent();

    expect(snapshotEvent.event).toBe("workspace.snapshot");
    expect(snapshotEvent.data?.payload.workspaceId).toBe(TEST_WORKSPACE_ID);

    replayConnection.close();
  });

  it("includes dev cors headers for an allowed origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(
      baseUrl,
      TEST_WORKSPACE_ID,
      undefined,
      "http://127.0.0.1:5173",
    );

    try {
      expect(streamConnection.response.statusCode).toBe(200);
      expect(streamConnection.response.headers["content-type"]).toContain("text/event-stream");
      expect(streamConnection.response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
      expect(String(streamConnection.response.headers.vary)).toContain("Origin");

      const snapshotEvent = await streamConnection.nextEvent();

      expect(snapshotEvent.event).toBe("workspace.snapshot");
    } finally {
      streamConnection.close();
    }
  });

  it("does not include dev cors headers for a non-allowlisted origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(
      baseUrl,
      TEST_WORKSPACE_ID,
      undefined,
      "http://evil.example:5173",
    );

    try {
      expect(streamConnection.response.statusCode).toBe(200);
      expect(streamConnection.response.headers["access-control-allow-origin"]).toBeUndefined();

      const snapshotEvent = await streamConnection.nextEvent();

      expect(snapshotEvent.event).toBe("workspace.snapshot");
    } finally {
      streamConnection.close();
    }
  });

  it("includes packaged file renderer cors headers for the null origin outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(
      baseUrl,
      TEST_WORKSPACE_ID,
      undefined,
      "null",
    );

    try {
      expect(streamConnection.response.statusCode).toBe(200);
      expect(streamConnection.response.headers["content-type"]).toContain("text/event-stream");
      expect(streamConnection.response.headers["access-control-allow-origin"]).toBe("null");
      expect(String(streamConnection.response.headers.vary)).toContain("Origin");
      expect(String(streamConnection.response.headers["access-control-allow-headers"])).toContain("Last-Event-ID");

      const snapshotEvent = await streamConnection.nextEvent();

      expect(snapshotEvent.event).toBe("workspace.snapshot");
    } finally {
      streamConnection.close();
    }
  });

  it("emits background session failure events from runtime-managed prompt rejection", async () => {
    const { baseUrl } = await createListeningServer(new PromptFailingPiSessionAdapter());
    const streamConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID);
    await streamConnection.nextEvent();

    try {
      const mutationResponse = await fetch(`${baseUrl}/workspaces/${TEST_WORKSPACE_ID}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: TEST_WORKSPACE_ID,
          cwd: "/workspace/jackdaw/.worktrees/task-3",
          repoRoot: "/workspace/jackdaw",
          worktree: "/workspace/jackdaw/.worktrees/task-3",
          task: "Fail visibly in the background.",
        }),
      });

      expect(mutationResponse.status).toBe(202);

      const observedEvents: SseEventMessage[] = [];
      for (let index = 0; index < 8; index += 1) {
        const event = await streamConnection.nextEvent();
        observedEvents.push(event);
        if (isFailedStatusChangedEvent(event)) {
          break;
        }
      }

      const failureEvent = observedEvents.find(isFailedStatusChangedEvent);
      expect(failureEvent?.data?.payload).toMatchObject({
        workspaceId: TEST_WORKSPACE_ID,
        status: "failed",
      });
    } finally {
      streamConnection.close();
    }
  });

  it("emits session events when a session changes", async () => {
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(baseUrl, TEST_WORKSPACE_ID);
    await streamConnection.nextEvent();

    expect(streamConnection.response.statusCode).toBe(200);

    const mutationResponse = await fetch(`${baseUrl}/sessions/${TEST_AWAITING_INPUT_SESSION_ID}/follow-up`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: TEST_AWAITING_INPUT_SESSION_ID,
        text: "Emit an intervention update event.",
      }),
    });

    expect(mutationResponse.status).toBe(202);

    const nextEvent = await streamConnection.nextEvent();

    expect(nextEvent.id).toBeDefined();
    expect(nextEvent.data?.version).toBe(1);
    expect(["workspace.updated", "session.intervention-changed", "session.summary-updated"]).toContain(nextEvent.event);
    expect(nextEvent.data?.payload.workspaceId).toBe(TEST_WORKSPACE_ID);

    streamConnection.close();
  });
});
