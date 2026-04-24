import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceEventBus, WorkspaceEventEnvelope } from "./event-bus.js";
import type { WorkspaceSnapshotEventDto, WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

export interface WorkspaceStreamRoutesOptions {
  store: DemoStateStore;
  eventBus: WorkspaceEventBus;
}

export async function registerWorkspaceStreamRoutes(
  app: FastifyInstance,
  options: WorkspaceStreamRoutesOptions,
): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/events", async (request, reply) => {
    const detail = options.store.getWorkspaceDetail(request.params.workspaceId);
    if (detail === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    reply.raw.flushHeaders();
    reply.raw.write(": connected\n\n");

    let isClosed: boolean = false;
    let unsubscribe: () => void = () => undefined;

    const closeStream = (): void => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      unsubscribe();
      reply.raw.destroy();
    };

    const sendEnvelope = (envelope: WorkspaceEventEnvelope): void => {
      try {
        reply.raw.write(`id: ${envelope.id}\n`);
        reply.raw.write(`event: ${envelope.event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(envelope.event)}\n\n`);
      } catch (error) {
        closeStream();
        throw error;
      }
    };

    const trySendEnvelope = (envelope: WorkspaceEventEnvelope): boolean => {
      try {
        sendEnvelope(envelope);
        return true;
      } catch {
        return false;
      }
    };

    const createSnapshotEvent = (): WorkspaceStreamEventDto => ({
      version: 1,
      type: "workspace.snapshot",
      payload: {
        workspaceId: request.params.workspaceId,
        detail: options.store.getWorkspaceDetail(request.params.workspaceId) ?? detail,
        emittedAt: new Date().toISOString(),
      } satisfies WorkspaceSnapshotEventDto,
    });

    const lastEventIdHeader = Array.isArray(request.headers["last-event-id"])
      ? request.headers["last-event-id"][0]
      : request.headers["last-event-id"];

    if (typeof lastEventIdHeader === "string" && lastEventIdHeader.length > 0) {
      const replayedEvents = options.eventBus.replaySince(request.params.workspaceId, lastEventIdHeader);
      if (replayedEvents === undefined) {
        const snapshotEnvelope = options.eventBus.createTransientEvent(request.params.workspaceId, createSnapshotEvent());
        if (!trySendEnvelope(snapshotEnvelope)) {
          return;
        }
      } else {
        for (const replayedEvent of replayedEvents) {
          if (!trySendEnvelope(replayedEvent)) {
            return;
          }
        }
      }
    } else {
      const snapshotEnvelope = options.eventBus.createTransientEvent(request.params.workspaceId, createSnapshotEvent());
      if (!trySendEnvelope(snapshotEnvelope)) {
        return;
      }
    }

    unsubscribe = options.eventBus.subscribe(request.params.workspaceId, (envelope) => {
      sendEnvelope(envelope);
    });

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(": keep-alive\n\n");
      } catch {
        closeStream();
      }
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    reply.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
