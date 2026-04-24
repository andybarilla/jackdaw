import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "../../../shared/transport/api.js";

export interface HealthRoutesOptions {
  appDataDir: string;
  version: string;
}

export async function registerHealthRoutes(app: FastifyInstance, options: HealthRoutesOptions): Promise<void> {
  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      ok: true,
      service: "jackdaw-service",
      version: options.version,
      appDataDir: options.appDataDir,
      timestamp: new Date().toISOString(),
    };
  });
}
