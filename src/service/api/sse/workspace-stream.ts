import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceEventBus } from "./event-bus.js";
import type { WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

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

    const sendEvent = (event: WorkspaceStreamEventDto): void => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = options.eventBus.subscribe(request.params.workspaceId, sendEvent);
    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
