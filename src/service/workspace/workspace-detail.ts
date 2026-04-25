import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceDetailDto } from "../../shared/transport/dto.js";
import { indexWorkspaceArtifacts, type IndexedWorkspaceArtifact } from "./artifact-index.js";

function withoutLocalArtifactFields(artifact: IndexedWorkspaceArtifact): WorkspaceArtifact {
  const { absolutePath: _absolutePath, ...workspaceArtifact } = artifact;
  return workspaceArtifact;
}

export async function mergeIndexedArtifacts(detail: WorkspaceDetailDto): Promise<WorkspaceDetailDto> {
  const indexedArtifacts = await indexWorkspaceArtifacts({ workspace: detail.workspace, sessions: detail.sessions, existingArtifacts: detail.artifacts });
  const indexedArtifactIds = new Set(indexedArtifacts.map((artifact) => artifact.id));

  return {
    ...detail,
    artifacts: [
      ...detail.artifacts.filter((artifact) => artifact.filePath === undefined && !indexedArtifactIds.has(artifact.id)),
      ...indexedArtifacts.map(withoutLocalArtifactFields),
    ],
  };
}
