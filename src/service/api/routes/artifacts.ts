import type { FastifyInstance } from "fastify";
import { indexWorkspaceArtifacts, readIndexedArtifact, type IndexedWorkspaceArtifact } from "../../workspace/artifact-index.js";
import type { WorkspaceService } from "../../workspace/workspace-service.js";
import type { ArtifactDetailDto, ArtifactListDto } from "../../../shared/transport/dto.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";

export interface ArtifactRoutesOptions {
  workspaceService: Promise<WorkspaceService>;
}

function withoutLocalFields(artifact: IndexedWorkspaceArtifact): WorkspaceArtifact {
  const { absolutePath: _absolutePath, ...workspaceArtifact } = artifact;
  return workspaceArtifact;
}

function isReadableArtifactError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

async function getIndexedArtifacts(workspaceService: WorkspaceService, workspaceId: string): Promise<IndexedWorkspaceArtifact[] | undefined> {
  const detail = await workspaceService.getWorkspaceDetail(workspaceId);
  if (detail === undefined) {
    return undefined;
  }

  return indexWorkspaceArtifacts({ workspace: detail.workspace, sessions: detail.sessions, existingArtifacts: detail.artifacts });
}

export async function registerArtifactRoutes(app: FastifyInstance, options: ArtifactRoutesOptions): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/artifacts", async (request, reply): Promise<ArtifactListDto | void> => {
    const workspaceService = await options.workspaceService;
    const artifacts = await getIndexedArtifacts(workspaceService, request.params.workspaceId);
    if (artifacts === undefined) {
      await reply.code(404).send({ error: "Workspace not found" });
      return;
    }

    return {
      workspaceId: request.params.workspaceId,
      artifacts: artifacts.map(withoutLocalFields),
    };
  });

  app.get<{ Params: { workspaceId: string; artifactId: string } }>("/workspaces/:workspaceId/artifacts/:artifactId", async (request, reply): Promise<ArtifactDetailDto | void> => {
    const workspaceService = await options.workspaceService;
    const artifacts = await getIndexedArtifacts(workspaceService, request.params.workspaceId);
    if (artifacts === undefined) {
      await reply.code(404).send({ error: "Workspace not found" });
      return;
    }

    const artifact = artifacts.find((candidate) => candidate.id === request.params.artifactId);
    if (artifact === undefined) {
      await reply.code(404).send({ error: "Artifact not found" });
      return;
    }

    try {
      const detail = await readIndexedArtifact(artifact);
      return {
        artifact: withoutLocalFields(detail.artifact),
        content: detail.content,
        readOnly: true,
      };
    } catch (error: unknown) {
      if (isReadableArtifactError(error)) {
        await reply.code(404).send({ error: "Artifact file not found" });
        return;
      }

      throw error;
    }
  });
}
