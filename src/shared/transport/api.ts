import type {
  CreateSessionDto,
  AddWorkspaceRepoDto,
  AddWorkspaceWorktreeDto,
  ArtifactDetailDto,
  ArtifactListDto,
  CreateWorkspaceDto,
  FollowUpSessionDto,
  IntegrationSettingsDto,
  MutationResponseDto,
  OpenPathDto,
  PinSummaryDto,
  SessionsListDto,
  UpdateWorkspaceDto,
  WorkspaceStreamEventDto,
  ShellFallbackDto,
  SteerSessionDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "./dto.js";

export interface HealthResponse {
  ok: boolean;
  service: "jackdaw-service";
  version: string;
  appDataDir: string;
  timestamp: string;
}

export interface RendererBootstrap {
  serviceBaseUrl: string;
  serviceToken: string;
  appDataDir: string;
  platform: NodeJS.Platform;
}

export interface ApiContract {
  "GET /health": {
    response: HealthResponse;
  };
  "GET /workspaces": {
    response: WorkspaceSummaryDto[];
  };
  "POST /workspaces": {
    body: CreateWorkspaceDto;
    response: WorkspaceDetailDto;
  };
  "GET /workspaces/:workspaceId": {
    response: WorkspaceDetailDto;
  };
  "PATCH /workspaces/:workspaceId": {
    body: UpdateWorkspaceDto;
    response: WorkspaceDetailDto;
  };
  "POST /workspaces/:workspaceId/repos": {
    body: AddWorkspaceRepoDto;
    response: WorkspaceDetailDto;
  };
  "POST /workspaces/:workspaceId/worktrees": {
    body: AddWorkspaceWorktreeDto;
    response: WorkspaceDetailDto;
  };
  "GET /workspaces/:workspaceId/sessions": {
    response: SessionsListDto;
  };
  "GET /workspaces/:workspaceId/artifacts": {
    response: ArtifactListDto;
  };
  "GET /workspaces/:workspaceId/artifacts/:artifactId": {
    response: ArtifactDetailDto;
  };
  "GET /settings/integrations": {
    response: IntegrationSettingsDto;
  };
  "POST /workspaces/:workspaceId/sessions": {
    body: CreateSessionDto;
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/steer": {
    body: SteerSessionDto;
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/follow-up": {
    body: FollowUpSessionDto;
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/abort": {
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/pin-summary": {
    body: PinSummaryDto;
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/open-path": {
    body: OpenPathDto;
    response: MutationResponseDto;
  };
  "POST /sessions/:sessionId/shell": {
    body: ShellFallbackDto;
    response: MutationResponseDto;
  };
  "GET /workspaces/:workspaceId/events": {
    response: WorkspaceStreamEventDto;
  };
}
