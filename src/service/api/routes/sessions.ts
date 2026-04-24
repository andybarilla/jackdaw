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

export async function registerSessionRoutes(app: FastifyInstance, options: SessionRoutesOptions): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/sessions", async (request, reply) => {
    const sessions = options.store.getWorkspaceSessions(request.params.workspaceId);
    if (sessions === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    return sessions;
  });

  app.post<{ Params: { workspaceId: string }; Body: CreateSessionDto }>("/workspaces/:workspaceId/sessions", async (request, reply): Promise<MutationResponseDto> => {
    const createdSession = options.store.createWorkspaceSession(request.params.workspaceId, request.body);
    if (createdSession === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    for (const { workspaceId, event } of createdSession.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(createdSession.response);
  });

  app.post<{ Params: { sessionId: string }; Body: SteerSessionDto }>("/sessions/:sessionId/steer", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.steerSession(request.params.sessionId, request.body);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });

  app.post<{ Params: { sessionId: string }; Body: FollowUpSessionDto }>("/sessions/:sessionId/follow-up", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.followUpSession(request.params.sessionId, request.body);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });

  app.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/abort", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.abortSession(request.params.sessionId);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });

  app.post<{ Params: { sessionId: string }; Body: PinSummaryDto }>("/sessions/:sessionId/pin-summary", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.pinSessionSummary(request.params.sessionId, request.body);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });

  app.post<{ Params: { sessionId: string }; Body: OpenPathDto }>("/sessions/:sessionId/open-path", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.openSessionPath(request.params.sessionId, request.body);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });

  app.post<{ Params: { sessionId: string }; Body: ShellFallbackDto }>("/sessions/:sessionId/shell", async (request, reply): Promise<MutationResponseDto> => {
    const mutation = options.store.runSessionShell(request.params.sessionId, request.body.command);
    if (mutation === undefined) {
      return reply.code(404).send({ error: "Session not found" });
    }

    for (const { workspaceId, event } of mutation.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(202).send(mutation.response);
  });
}
