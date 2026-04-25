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
    const accessControlAllowOrigin = reply.getHeader("Access-Control-Allow-Origin");
    const varyHeader = reply.getHeader("Vary");
    const accessControlAllowMethods = reply.getHeader("Access-Control-Allow-Methods");
    const accessControlAllowHeaders = reply.getHeader("Access-Control-Allow-Headers");

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...(typeof accessControlAllowOrigin === "string"
        ? { "access-control-allow-origin": accessControlAllowOrigin }
        : {}),
      ...(typeof varyHeader === "string" ? { vary: varyHeader } : {}),
      ...(typeof accessControlAllowMethods === "string"
        ? { "access-control-allow-methods": accessControlAllowMethods }
        : {}),
      ...(typeof accessControlAllowHeaders === "string"
        ? { "access-control-allow-headers": accessControlAllowHeaders }
        : {}),
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
        const payload = `id: ${envelope.id}\nevent: ${envelope.event.type}\ndata: ${JSON.stringify(envelope.event)}\n\n`;
        const acceptedByKernelBuffer = reply.raw.write(payload);
        if (!acceptedByKernelBuffer) {
          closeStream();
          throw new Error("SSE subscriber backpressure limit reached");
        }
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
      const replay = options.eventBus.replaySince(request.params.workspaceId, lastEventIdHeader);
      if (replay === undefined || !replay.canReplay) {
        const snapshotEnvelope = options.eventBus.createTransientEvent(request.params.workspaceId, createSnapshotEvent());
        if (!trySendEnvelope(snapshotEnvelope)) {
          return;
        }
      } else {
        for (const replayedEvent of replay.events) {
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
