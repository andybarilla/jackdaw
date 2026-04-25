import type { WorkspaceArtifact } from "../domain/artifact.js";
import type {
  AttentionBand,
  AttentionEvent,
} from "../domain/attention.js";
import type {
  CommandResult,
  FollowUpSessionCommand,
  OpenPathCommand,
  PinSummaryCommand,
  ShellFallbackCommand,
  SpawnSessionCommand,
  SteerSessionCommand,
} from "../domain/commands.js";
import type { WorkspaceSession, WorkspaceSessionStatus } from "../domain/session.js";
import type { Workspace } from "../domain/workspace.js";

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  description?: string;
  repoRootCount: number;
  worktreeCount: number;
  sessionCount: number;
  attentionBand: AttentionBand;
  updatedAt: string;
}

export interface WorkspaceDetailDto {
  workspace: Workspace;
  sessions: WorkspaceSession[];
  artifacts: WorkspaceArtifact[];
  recentAttention: AttentionEvent[];
}

export interface SessionsListDto {
  workspaceId: string;
  sessions: WorkspaceSession[];
}

export interface ArtifactListDto {
  workspaceId: string;
  artifacts: WorkspaceArtifact[];
}

export interface ArtifactDetailDto {
  artifact: WorkspaceArtifact;
  content: string;
  readOnly: true;
}

export interface IntegrationSettingsDto {
  hq: {
    status: "not-configured" | "configured";
    linkedIds: {
      projectId?: string;
      workItemIds: string[];
      sessionIds: string[];
    };
  };
}

export interface CreateWorkspaceDto {
  name: string;
  description?: string;
  repoRoots?: string[];
}

export interface UpdateWorkspaceDto {
  name?: string;
  description?: string;
  preferences?: Workspace["preferences"];
}

export interface AddWorkspaceRepoDto {
  path: string;
  name?: string;
  defaultBranch?: string;
}

export type CreateSessionDto = SpawnSessionCommand;
export type SteerSessionDto = SteerSessionCommand;
export type FollowUpSessionDto = FollowUpSessionCommand;
export type PinSummaryDto = PinSummaryCommand;
export type OpenPathDto = OpenPathCommand;
export type ShellFallbackDto = ShellFallbackCommand;

export interface WorkspaceSnapshotEventDto {
  workspaceId: string;
  detail: WorkspaceDetailDto;
  emittedAt: string;
}

export interface WorkspaceUpdatedEventDto {
  workspaceId: string;
  updatedAt: string;
}

export interface SessionStatusChangedEventDto {
  workspaceId: string;
  sessionId: string;
  status: WorkspaceSessionStatus;
  changedAt: string;
}

export interface SessionSummaryUpdatedEventDto {
  workspaceId: string;
  sessionId: string;
  liveSummary: string;
  pinnedSummary?: string;
  updatedAt: string;
}

export interface SessionRecentFilesUpdatedEventDto {
  workspaceId: string;
  sessionId: string;
  files: WorkspaceSession["recentFiles"];
  updatedAt: string;
}

export interface InterventionChangedEventDto {
  workspaceId: string;
  sessionId: string;
  intervention: WorkspaceSession["lastIntervention"];
  updatedAt: string;
}

export interface ArtifactLinkedEventDto {
  workspaceId: string;
  artifactId: string;
  sessionId?: string;
  workItemId?: string;
  linkedAt: string;
}

export interface VersionedEventDto<TType extends string, TPayload> {
  version: 1;
  type: TType;
  payload: TPayload;
}

export type WorkspaceStreamEventDto =
  | VersionedEventDto<"workspace.snapshot", WorkspaceSnapshotEventDto>
  | VersionedEventDto<"workspace.updated", WorkspaceUpdatedEventDto>
  | VersionedEventDto<"session.status-changed", SessionStatusChangedEventDto>
  | VersionedEventDto<"session.summary-updated", SessionSummaryUpdatedEventDto>
  | VersionedEventDto<"session.recent-files-updated", SessionRecentFilesUpdatedEventDto>
  | VersionedEventDto<"session.intervention-changed", InterventionChangedEventDto>
  | VersionedEventDto<"artifact.linked", ArtifactLinkedEventDto>;

export interface MutationResponseDto {
  result: CommandResult;
}

export function summarizeWorkspace(workspace: Workspace, sessions: WorkspaceSession[]): WorkspaceSummaryDto {
  const attentionBand = sessions.some((session) => ["awaiting-input", "blocked", "failed"].includes(session.status))
    ? "needs-operator"
    : sessions.some((session) => session.status === "running")
      ? "active"
      : "quiet";

  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    repoRootCount: workspace.repoRoots.length,
    worktreeCount: workspace.worktrees.length,
    sessionCount: sessions.length,
    attentionBand,
    updatedAt: workspace.updatedAt,
  };
}
