import { afterEach, describe, expect, it } from "vitest";
import http, { type IncomingMessage, type RequestOptions } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import { DEMO_WORKSPACE_ID } from "../../demo-state.js";
import type { WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

let app: FastifyInstance | undefined;

async function createListeningServer(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  app = createServer({ appDataDir: "/tmp/jackdaw-test" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function connectToWorkspaceEvents(baseUrl: string, workspaceId: string): Promise<{
  response: IncomingMessage;
  nextEvent: Promise<WorkspaceStreamEventDto>;
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
    },
  };

  return new Promise((resolve, reject) => {
    const request = http.request(requestOptions, (response) => {
      let buffered = "";
      const nextEvent = new Promise<WorkspaceStreamEventDto>((resolveEvent, rejectEvent) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffered += chunk;
          const markerIndex = buffered.indexOf("\n\n");
          if (markerIndex === -1) {
            return;
          }

          const sseMessage = buffered.slice(0, markerIndex);
          buffered = buffered.slice(markerIndex + 2);

          const dataLine = sseMessage
            .split("\n")
            .find((line) => line.startsWith("data: "));

          if (dataLine === undefined) {
            return;
          }

          resolveEvent(JSON.parse(dataLine.slice(6)) as WorkspaceStreamEventDto);
        });
        response.on("error", rejectEvent);
        response.on("close", () => rejectEvent(new Error("SSE stream closed before an event arrived")));
      });

      resolve({
        response,
        nextEvent,
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

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("workspace SSE stream", () => {
  it("keeps the stream open and emits versioned workspace events", async () => {
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(baseUrl, DEMO_WORKSPACE_ID);

    expect(streamConnection.response.statusCode).toBe(200);
    expect(streamConnection.response.headers["content-type"]).toContain("text/event-stream");

    const mutationResponse = await fetch(`${baseUrl}/workspaces/${DEMO_WORKSPACE_ID}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        description: "SSE updated description",
      }),
    });

    expect(mutationResponse.status).toBe(200);

    const nextEvent = await streamConnection.nextEvent;

    expect(nextEvent.version).toBe(1);
    expect(nextEvent.type).toBe("workspace.updated");
    expect(nextEvent.payload.workspaceId).toBe(DEMO_WORKSPACE_ID);

    streamConnection.close();
  });

  it("emits session events when a session changes", async () => {
    const { baseUrl } = await createListeningServer();
    const streamConnection = await connectToWorkspaceEvents(baseUrl, DEMO_WORKSPACE_ID);

    expect(streamConnection.response.statusCode).toBe(200);

    const mutationResponse = await fetch(`${baseUrl}/sessions/ses-awaiting-input/follow-up`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "ses-awaiting-input",
        text: "Emit an intervention update event.",
      }),
    });

    expect(mutationResponse.status).toBe(202);

    const nextEvent = await streamConnection.nextEvent;

    expect(nextEvent.version).toBe(1);
    expect(["session.intervention-changed", "session.summary-updated"]).toContain(nextEvent.type);
    expect(nextEvent.payload.workspaceId).toBe(DEMO_WORKSPACE_ID);

    streamConnection.close();
  });
});
