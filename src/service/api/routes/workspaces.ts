import type { FastifyInstance } from "fastify";
import { WorkspaceMutationValidationError, type WorkspaceService } from "../../workspace/workspace-service.js";
import type { WorkspaceEventBus } from "../sse/event-bus.js";
import { mergeIndexedArtifacts } from "../../workspace/workspace-detail.js";
import type {
  AddWorkspaceRepoDto,
  AddWorkspaceWorktreeDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "../../../shared/transport/dto.js";

export interface WorkspaceRoutesOptions {
  workspaceService: Promise<WorkspaceService>;
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

const createWorkspaceBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    repoRoots: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    worktrees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["repoRootPath", "path"],
        properties: {
          repoRootPath: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          branch: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

const updateWorkspaceBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    preferences: {
      type: "object",
      additionalProperties: false,
      properties: {
        selectedSessionId: { type: "string", minLength: 1 },
        selectedArtifactId: { type: "string", minLength: 1 },
        attentionView: { type: "string", enum: ["all", "needs-operator", "active", "quiet"] },
        detailView: { type: "string", enum: ["summary", "events", "artifacts"] },
      },
    },
  },
} as const;

const addWorkspaceRepoBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    defaultBranch: { type: "string", minLength: 1 },
  },
} as const;

const addWorkspaceWorktreeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["repoRootId", "path"],
  properties: {
    repoRootId: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    branch: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
  },
} as const;

export async function registerWorkspaceRoutes(app: FastifyInstance, options: WorkspaceRoutesOptions): Promise<void> {
  app.get("/workspaces", async (): Promise<WorkspaceSummaryDto[]> => {
    const workspaceService = await options.workspaceService;
    return workspaceService.listWorkspaces();
  });

  app.post<{ Body: CreateWorkspaceDto }>(
    "/workspaces",
    {
      schema: {
        body: createWorkspaceBodySchema,
      },
    },
    async (request, reply): Promise<WorkspaceDetailDto | { error: string }> => {
      try {
        const workspaceService = await options.workspaceService;
        const createdWorkspace = await workspaceService.createWorkspace(request.body);
        for (const { workspaceId, event } of createdWorkspace.events) {
          options.eventBus.publish(workspaceId, event);
        }

        return reply.code(201).send(createdWorkspace.payload);
      } catch (error: unknown) {
        if (error instanceof WorkspaceMutationValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId",
    {
      schema: {
        params: workspaceIdParamsSchema,
      },
    },
    async (request, reply) => {
      const workspaceService = await options.workspaceService;
      const detail = await workspaceService.getWorkspaceDetail(request.params.workspaceId);
      if (detail === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      return mergeIndexedArtifacts(detail);
    },
  );

  app.patch<{ Params: { workspaceId: string }; Body: UpdateWorkspaceDto }>(
    "/workspaces/:workspaceId",
    {
      schema: {
        params: workspaceIdParamsSchema,
        body: updateWorkspaceBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const workspaceService = await options.workspaceService;
        const updatedWorkspace = await workspaceService.updateWorkspace(request.params.workspaceId, request.body);
        if (updatedWorkspace === undefined) {
          return reply.code(404).send({ error: "Workspace not found" });
        }

        for (const { workspaceId, event } of updatedWorkspace.events) {
          options.eventBus.publish(workspaceId, event);
        }

        return updatedWorkspace.payload;
      } catch (error: unknown) {
        if (error instanceof WorkspaceMutationValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: AddWorkspaceRepoDto }>(
    "/workspaces/:workspaceId/repos",
    {
      schema: {
        params: workspaceIdParamsSchema,
        body: addWorkspaceRepoBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const workspaceService = await options.workspaceService;
        const updatedWorkspace = await workspaceService.addWorkspaceRepo(request.params.workspaceId, request.body);
        if (updatedWorkspace === undefined) {
          return reply.code(404).send({ error: "Workspace not found" });
        }

        for (const { workspaceId, event } of updatedWorkspace.events) {
          options.eventBus.publish(workspaceId, event);
        }

        return updatedWorkspace.payload;
      } catch (error: unknown) {
        if (error instanceof WorkspaceMutationValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: AddWorkspaceWorktreeDto }>(
    "/workspaces/:workspaceId/worktrees",
    {
      schema: {
        params: workspaceIdParamsSchema,
        body: addWorkspaceWorktreeBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const workspaceService = await options.workspaceService;
        const updatedWorkspace = await workspaceService.addWorkspaceWorktree(request.params.workspaceId, request.body);
        if (updatedWorkspace === undefined) {
          return reply.code(404).send({ error: "Workspace not found" });
        }

        for (const { workspaceId, event } of updatedWorkspace.events) {
          options.eventBus.publish(workspaceId, event);
        }

        return updatedWorkspace.payload;
      } catch (error: unknown) {
        if (error instanceof WorkspaceMutationValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
