export interface WorkspaceRepoRoot {
  id: string;
  path: string;
  name: string;
  defaultBranch?: string;
}

export interface WorkspaceWorktree {
  id: string;
  repoRootId: string;
  path: string;
  branch?: string;
  label?: string;
}

export interface WorkspacePreferences {
  selectedSessionId?: string;
  selectedArtifactId?: string;
  attentionView?: "all" | "needs-operator" | "active" | "quiet";
  detailView?: "summary" | "events" | "artifacts";
}

export interface WorkspaceOptionalIntegrations {
  hqProjectId?: string;
  figmaFileKey?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  repoRoots: WorkspaceRepoRoot[];
  worktrees: WorkspaceWorktree[];
  sessionIds: string[];
  artifactIds: string[];
  preferences: WorkspacePreferences;
  optionalIntegrations?: WorkspaceOptionalIntegrations;
  createdAt: string;
  updatedAt: string;
}

export function createWorkspace(input: Omit<Workspace, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Workspace {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}
