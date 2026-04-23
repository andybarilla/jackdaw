import Fastify, { type FastifyInstance } from "fastify";
import type { HealthResponse } from "../shared/transport/api.js";

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

  return app;
}
