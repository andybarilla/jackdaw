import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceEventBus } from "../sse/event-bus.js";
import type {
  CreateSessionDto,
  FollowUpSessionDto,
  MutationResponseDto,
  OpenPathDto,
  PinSummaryDto,
  SessionsListDto,
  ShellFallbackDto,
  SteerSessionDto,
} from "../../../shared/transport/dto.js";

export interface SessionRoutesOptions {
  store: DemoStateStore;
  eventBus: WorkspaceEventBus;
}

const workspaceIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
  },
} as const;

const sessionIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
  },
} as const;

const createSessionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceId", "cwd", "task"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    cwd: { type: "string", minLength: 1 },
    task: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    repoRoot: { type: "string", minLength: 1 },
    worktree: { type: "string", minLength: 1 },
    branch: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    linkedArtifactIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    linkedWorkItemIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
} as const;

const steerSessionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId", "text"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    text: { type: "string", minLength: 1 },
  },
} as const;

const followUpSessionBodySchema = steerSessionBodySchema;

const pinSummaryBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    summary: { type: "string" },
  },
} as const;

const openPathBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceId", "path"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    revealInFileManager: { type: "boolean" },
    openInTerminal: { type: "boolean" },
  },
} as const;

const shellFallbackBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId", "command"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    command: { type: "string", minLength: 1 },
  },
} as const;

function idsMatch(actualId: string, expectedId: string): boolean {
  return actualId === expectedId;
}

export async function registerSessionRoutes(app: FastifyInstance, options: SessionRoutesOptions): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/sessions",
    {
      schema: {
        params: workspaceIdParamsSchema,
      },
    },
    async (request, reply) => {
      const sessions = options.store.getWorkspaceSessions(request.params.workspaceId);
      if (sessions === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      return sessions;
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: CreateSessionDto }>(
    "/workspaces/:workspaceId/sessions",
    {
      schema: {
        params: workspaceIdParamsSchema,
        body: createSessionBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      if (!idsMatch(request.body.workspaceId, request.params.workspaceId)) {
        return reply.code(400).send({ error: "workspaceId must match the route parameter" });
      }

      const createdSession = options.store.createWorkspaceSession(request.params.workspaceId, request.body);
      if (createdSession === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      for (const { workspaceId, event } of createdSession.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(createdSession.response);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: SteerSessionDto }>(
    "/sessions/:sessionId/steer",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: steerSessionBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      if (!idsMatch(request.body.sessionId, request.params.sessionId)) {
        return reply.code(400).send({ error: "sessionId must match the route parameter" });
      }

      const mutation = options.store.steerSession(request.params.sessionId, request.body);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: FollowUpSessionDto }>(
    "/sessions/:sessionId/follow-up",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: followUpSessionBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      if (!idsMatch(request.body.sessionId, request.params.sessionId)) {
        return reply.code(400).send({ error: "sessionId must match the route parameter" });
      }

      const mutation = options.store.followUpSession(request.params.sessionId, request.body);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/abort",
    {
      schema: {
        params: sessionIdParamsSchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      const mutation = options.store.abortSession(request.params.sessionId);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: PinSummaryDto }>(
    "/sessions/:sessionId/pin-summary",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: pinSummaryBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      if (!idsMatch(request.body.sessionId, request.params.sessionId)) {
        return reply.code(400).send({ error: "sessionId must match the route parameter" });
      }

      const mutation = options.store.pinSessionSummary(request.params.sessionId, request.body);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: OpenPathDto }>(
    "/sessions/:sessionId/open-path",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: openPathBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      const sessionWorkspaceId = options.store.getSessionWorkspaceId(request.params.sessionId);
      if (sessionWorkspaceId === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (!idsMatch(request.body.workspaceId, sessionWorkspaceId)) {
        return reply.code(400).send({ error: "workspaceId must match the session workspace" });
      }

      const mutation = options.store.openSessionPath(request.params.sessionId, request.body);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: ShellFallbackDto }>(
    "/sessions/:sessionId/shell",
    {
      schema: {
        params: sessionIdParamsSchema,
        body: shellFallbackBodySchema,
      },
    },
    async (request, reply): Promise<MutationResponseDto> => {
      if (!idsMatch(request.body.sessionId, request.params.sessionId)) {
        return reply.code(400).send({ error: "sessionId must match the route parameter" });
      }

      const mutation = options.store.runSessionShell(request.params.sessionId, request.body.command);
      if (mutation === undefined) {
        return reply.code(404).send({ error: "Session not found" });
      }

      for (const { workspaceId, event } of mutation.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(202).send(mutation.response);
    },
  );
}
