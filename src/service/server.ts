import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerWorkspaceRoutes } from "./api/routes/workspaces.js";
import { registerSessionRoutes } from "./api/routes/sessions.js";
import { registerArtifactRoutes } from "./api/routes/artifacts.js";
import { registerSettingsRoutes } from "./api/routes/settings.js";
import { createWorkspaceEventBus } from "./api/sse/event-bus.js";
import { registerWorkspaceStreamRoutes } from "./api/sse/workspace-stream.js";
import { createDemoStateStore, type DemoStateStore } from "./demo-state.js";

const DEV_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function getAllowedDevelopmentOrigin(origin: string | undefined): string | undefined {
  if (process.env.NODE_ENV !== "development") {
    return undefined;
  }

  if (origin === undefined) {
    return undefined;
  }

  return DEV_ALLOWED_ORIGINS.has(origin) ? origin : undefined;
}

export interface ServiceServerOptions {
  appDataDir: string;
  version?: string;
  store?: DemoStateStore;
}

export function createServer(options: ServiceServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const requestOrigin = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    const allowedOrigin = getAllowedDevelopmentOrigin(requestOrigin);

    if (allowedOrigin === undefined) {
      return;
    }

    reply.header("Access-Control-Allow-Origin", allowedOrigin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });

  const store = options.store ?? createDemoStateStore();
  const eventBus = createWorkspaceEventBus();
  const version = options.version ?? "0.1.0";

  void app.register(registerHealthRoutes, {
    appDataDir: options.appDataDir,
    version,
  });
  void app.register(registerWorkspaceRoutes, {
    store,
    eventBus,
  });
  void app.register(registerSessionRoutes, {
    store,
    eventBus,
  });
  void app.register(registerArtifactRoutes);
  void app.register(registerSettingsRoutes);
  void app.register(registerWorkspaceStreamRoutes, {
    store,
    eventBus,
  });

  return app;
}
