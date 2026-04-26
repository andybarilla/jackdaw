import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerWorkspaceRoutes } from "./api/routes/workspaces.js";
import { registerSessionRoutes } from "./api/routes/sessions.js";
import { registerArtifactRoutes } from "./api/routes/artifacts.js";
import { registerSettingsRoutes } from "./api/routes/settings.js";
import { createWorkspaceEventBus } from "./api/sse/event-bus.js";
import { registerWorkspaceStreamRoutes } from "./api/sse/workspace-stream.js";
import { ReconnectManager } from "./orchestration/reconnect-manager.js";
import { RuntimeManager, type RuntimeSessionMutationListener, type ShellExecutor, type WorkspacePathOpener } from "./orchestration/runtime-manager.js";
import { DefaultPiSessionAdapter, type PiSessionAdapter } from "./orchestration/session-adapter.js";
import { createSessionMutationEvents, WorkspaceService } from "./workspace/workspace-service.js";

const DEV_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
const PACKAGED_RENDERER_ORIGIN = "null";

function getAllowedCorsOrigin(origin: string | undefined): string | undefined {
  if (origin === undefined) {
    return undefined;
  }

  if (process.env.NODE_ENV === "development") {
    return DEV_ALLOWED_ORIGINS.has(origin) ? origin : undefined;
  }

  return origin === PACKAGED_RENDERER_ORIGIN ? PACKAGED_RENDERER_ORIGIN : undefined;
}

function resolveServiceToken(optionToken: string | undefined): string | undefined {
  const serviceToken = optionToken ?? process.env.JACKDAW_SERVICE_TOKEN;
  if (serviceToken !== undefined && serviceToken.trim().length >= 32) {
    return serviceToken;
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return undefined;
  }

  throw new Error("JACKDAW_SERVICE_TOKEN must be set to a per-service secret of at least 32 characters.");
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorizationHeader);
  return match?.[1];
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedRequest(
  authorizationHeader: string | string[] | undefined,
  tokenHeader: string | string[] | undefined,
  serviceToken: string | undefined,
): boolean {
  if (serviceToken === undefined) {
    return true;
  }

  const presentedToken = extractBearerToken(getHeaderValue(authorizationHeader)) ?? getHeaderValue(tokenHeader);
  return presentedToken !== undefined && constantTimeEquals(presentedToken, serviceToken);
}

export interface ServiceServerOptions {
  appDataDir: string;
  version?: string;
  serviceToken?: string;
  workspaceService?: WorkspaceService;
  piSessionAdapter?: PiSessionAdapter;
  runtimeManager?: RuntimeManager;
  shellExecutor?: ShellExecutor;
  pathOpener?: WorkspacePathOpener;
  skipReconnect?: boolean;
}

async function createWorkspaceServicePromise(
  options: ServiceServerOptions,
  onSessionMutation: RuntimeSessionMutationListener,
): Promise<WorkspaceService> {
  const workspaceService = options.workspaceService ?? await WorkspaceService.load({ appDataDir: options.appDataDir });
  const runtimeManager = options.runtimeManager ?? new RuntimeManager({
    registry: workspaceService.getRuntimeRegistry(),
    adapter: options.piSessionAdapter ?? new DefaultPiSessionAdapter({
      sessionDirectory: `${options.appDataDir}/pi-sessions`,
      agentDir: process.env.PI_AGENT_DIR,
    }),
    shellExecutor: options.shellExecutor,
    pathOpener: options.pathOpener,
    onSessionMutation,
  });
  workspaceService.setRuntimeManager(runtimeManager);
  return workspaceService;
}

export function createServer(options: ServiceServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  const serviceToken = resolveServiceToken(options.serviceToken);

  app.addHook("onRequest", async (request, reply) => {
    const requestOrigin = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    const allowedOrigin = getAllowedCorsOrigin(requestOrigin);

    if (allowedOrigin !== undefined) {
      reply.header("Access-Control-Allow-Origin", allowedOrigin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID, Authorization, X-Jackdaw-Service-Token");
    }

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
      return;
    }

    if (!isAuthorizedRequest(request.headers.authorization, request.headers["x-jackdaw-service-token"], serviceToken)) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

  const eventBus = createWorkspaceEventBus();
  const publishRuntimeSessionMutation: RuntimeSessionMutationListener = ({ session, occurredAt }) => {
    for (const { workspaceId, event } of createSessionMutationEvents(session, occurredAt)) {
      eventBus.publish(workspaceId, event);
    }
  };
  const workspaceServicePromise = createWorkspaceServicePromise(options, publishRuntimeSessionMutation);
  const version = options.version ?? "0.1.0";

  app.addHook("onReady", async () => {
    const workspaceService = await workspaceServicePromise;
    if (options.skipReconnect === true) {
      return;
    }

    await new ReconnectManager(workspaceService.requireRuntimeManager()).reconnectAll();
  });

  void app.register(registerHealthRoutes, {
    appDataDir: options.appDataDir,
    version,
  });
  void app.register(registerWorkspaceRoutes, {
    workspaceService: workspaceServicePromise,
    eventBus,
  });
  void app.register(registerSessionRoutes, {
    workspaceService: workspaceServicePromise,
    eventBus,
  });
  void app.register(registerArtifactRoutes, {
    workspaceService: workspaceServicePromise,
  });
  void app.register(registerSettingsRoutes, {
    workspaceService: workspaceServicePromise,
  });
  void app.register(registerWorkspaceStreamRoutes, {
    workspaceService: workspaceServicePromise,
    eventBus,
  });

  return app;
}
