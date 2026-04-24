import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { Workspace } from "../../shared/domain/workspace.js";

export function linkSessionToWorkspace(workspace: Workspace, sessionId: string): Workspace {
  if (workspace.sessionIds.includes(sessionId)) {
    return workspace;
  }

  return {
    ...workspace,
    sessionIds: [...workspace.sessionIds, sessionId],
  };
}

export function linkArtifactToWorkspace(workspace: Workspace, artifactId: string): Workspace {
  if (workspace.artifactIds.includes(artifactId)) {
    return workspace;
  }

  return {
    ...workspace,
    artifactIds: [...workspace.artifactIds, artifactId],
  };
}

export function sortSessionsByWorkspaceOrder(workspace: Workspace, sessions: readonly WorkspaceSession[]): WorkspaceSession[] {
  const sessionOrder = new Map<string, number>(workspace.sessionIds.map((sessionId, index) => [sessionId, index]));

  return [...sessions].sort((left, right) => {
    const leftOrder = sessionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = sessionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export function sortArtifactsByWorkspaceOrder(workspace: Workspace, artifacts: readonly WorkspaceArtifact[]): WorkspaceArtifact[] {
  const artifactOrder = new Map<string, number>(workspace.artifactIds.map((artifactId, index) => [artifactId, index]));

  return [...artifacts].sort((left, right) => {
    const leftOrder = artifactOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = artifactOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}
