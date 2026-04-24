import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceEventBus } from "../sse/event-bus.js";
import type {
  AddWorkspaceRepoDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "../../../shared/transport/dto.js";

export interface WorkspaceRoutesOptions {
  store: DemoStateStore;
  eventBus: WorkspaceEventBus;
}

export async function registerWorkspaceRoutes(app: FastifyInstance, options: WorkspaceRoutesOptions): Promise<void> {
  app.get("/workspaces", async (): Promise<WorkspaceSummaryDto[]> => {
    return options.store.listWorkspaces();
  });

  app.post<{ Body: CreateWorkspaceDto }>("/workspaces", async (request, reply): Promise<WorkspaceDetailDto> => {
    const createdWorkspace = options.store.createWorkspace(request.body);
    for (const { workspaceId, event } of createdWorkspace.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return reply.code(201).send(createdWorkspace.detail);
  });

  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId", async (request, reply) => {
    const detail = options.store.getWorkspaceDetail(request.params.workspaceId);
    if (detail === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    return detail;
  });

  app.patch<{ Params: { workspaceId: string }; Body: UpdateWorkspaceDto }>("/workspaces/:workspaceId", async (request, reply) => {
    const updatedWorkspace = options.store.updateWorkspace(request.params.workspaceId, request.body);
    if (updatedWorkspace === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    for (const { workspaceId, event } of updatedWorkspace.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return updatedWorkspace.detail;
  });

  app.post<{ Params: { workspaceId: string }; Body: AddWorkspaceRepoDto }>("/workspaces/:workspaceId/repos", async (request, reply) => {
    const updatedWorkspace = options.store.addWorkspaceRepo(request.params.workspaceId, request.body);
    if (updatedWorkspace === undefined) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    for (const { workspaceId, event } of updatedWorkspace.events) {
      options.eventBus.publish(workspaceId, event);
    }

    return updatedWorkspace.detail;
  });
}
