import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { WorkspaceEventBus } from "../sse/event-bus.js";
import { indexWorkspaceArtifacts, type IndexedWorkspaceArtifact } from "../../workspace/artifact-index.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
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

function withoutLocalArtifactFields(artifact: IndexedWorkspaceArtifact): WorkspaceArtifact {
  const { absolutePath: _absolutePath, repoRootId: _repoRootId, ...workspaceArtifact } = artifact;
  return workspaceArtifact;
}

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

export async function registerWorkspaceRoutes(app: FastifyInstance, options: WorkspaceRoutesOptions): Promise<void> {
  app.get("/workspaces", async (): Promise<WorkspaceSummaryDto[]> => {
    return options.store.listWorkspaces();
  });

  app.post<{ Body: CreateWorkspaceDto }>(
    "/workspaces",
    {
      schema: {
        body: createWorkspaceBodySchema,
      },
    },
    async (request, reply): Promise<WorkspaceDetailDto> => {
      const createdWorkspace = options.store.createWorkspace(request.body);
      for (const { workspaceId, event } of createdWorkspace.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return reply.code(201).send(createdWorkspace.detail);
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
      const detail = options.store.getWorkspaceDetail(request.params.workspaceId);
      if (detail === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      const indexedArtifacts = await indexWorkspaceArtifacts({ workspace: detail.workspace, sessions: detail.sessions });
      const indexedArtifactIds = new Set(indexedArtifacts.map((artifact) => artifact.id));
      return {
        ...detail,
        artifacts: [
          ...detail.artifacts.filter((artifact) => !indexedArtifactIds.has(artifact.id)),
          ...indexedArtifacts.map(withoutLocalArtifactFields),
        ],
      };
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
      const updatedWorkspace = options.store.updateWorkspace(request.params.workspaceId, request.body);
      if (updatedWorkspace === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      for (const { workspaceId, event } of updatedWorkspace.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return updatedWorkspace.detail;
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
      const updatedWorkspace = options.store.addWorkspaceRepo(request.params.workspaceId, request.body);
      if (updatedWorkspace === undefined) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      for (const { workspaceId, event } of updatedWorkspace.events) {
        options.eventBus.publish(workspaceId, event);
      }

      return updatedWorkspace.detail;
    },
  );
}
