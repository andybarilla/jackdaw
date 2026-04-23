import Fastify, { type FastifyInstance } from "fastify";
import type { HealthResponse } from "../shared/transport/api.js";
import {
  getDemoWorkspaceDetail,
  getDemoWorkspaceSessions,
  listDemoWorkspaceSummaries,
} from "./demo-state.js";

export interface ServiceServerOptions {
  appDataDir: string;
}

export function createServer(options: ServiceServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      ok: true,
      service: "jackdaw-service",
      appDataDir: options.appDataDir,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/workspaces", async () => {
    return listDemoWorkspaceSummaries();
  });

  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId", async (request, reply) => {
    const detail = getDemoWorkspaceDetail(request.params.workspaceId);
    if (!detail) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    return detail;
  });

  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/sessions", async (request, reply) => {
    const sessions = getDemoWorkspaceSessions(request.params.workspaceId);
    if (!sessions) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    return sessions;
  });

  return app;
}
