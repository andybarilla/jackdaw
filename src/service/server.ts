import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerWorkspaceRoutes } from "./api/routes/workspaces.js";
import { registerSessionRoutes } from "./api/routes/sessions.js";
import { registerArtifactRoutes } from "./api/routes/artifacts.js";
import { registerSettingsRoutes } from "./api/routes/settings.js";
import { createWorkspaceEventBus } from "./api/sse/event-bus.js";
import { registerWorkspaceStreamRoutes } from "./api/sse/workspace-stream.js";
import { createDemoStateStore, type DemoStateStore } from "./demo-state.js";

export interface ServiceServerOptions {
  appDataDir: string;
  version?: string;
  store?: DemoStateStore;
}

export function createServer(options: ServiceServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });
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
