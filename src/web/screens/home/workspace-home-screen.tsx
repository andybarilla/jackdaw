import React from "react";
import type { HealthResponse } from "../../../shared/transport/api.js";
import type { WorkspaceDetailDto, WorkspaceSummaryDto } from "../../../shared/transport/dto.js";
import { Shell } from "../../components/layout/shell.js";
import { AttentionRail } from "../../components/sessions/attention-rail.js";
import { SessionCommandCenter } from "../../components/sessions/session-command-center.js";
import { ContextPanel } from "../../components/workspace/context-panel.js";
import type { Loadable } from "../../hooks/useWorkspaceStream.js";
import type { WorkspaceActionHandlers } from "../../hooks/useWorkspaceActions.js";

export interface WorkspaceHomeScreenProps {
  platform: string;
  health?: HealthResponse;
  workspaceSummaries: Loadable<WorkspaceSummaryDto[]>;
  workspaceDetail: Loadable<WorkspaceDetailDto>;
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  connectionState: "connecting" | "live" | "disconnected";
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: string) => void;
  actions: WorkspaceActionHandlers;
}

function loadingPanel(message: string): React.JSX.Element {
  return <section className="panel panel-empty"><p>{message}</p></section>;
}

export function WorkspaceHomeScreen(props: WorkspaceHomeScreenProps): React.JSX.Element {
  const summaries = props.workspaceSummaries.status === "ready" ? props.workspaceSummaries.data : [];
  const detail = props.workspaceDetail.status === "ready" ? props.workspaceDetail.data : undefined;
  const selectedSession = detail?.sessions.find((session) => session.id === props.selectedSessionId) ?? detail?.sessions[0];

  const rail = props.workspaceDetail.status === "ready"
    ? (
        <AttentionRail
          sessions={props.workspaceDetail.data.sessions}
          artifacts={props.workspaceDetail.data.artifacts}
          selectedSessionId={selectedSession?.id}
          onSelectSession={props.onSelectSession}
        />
      )
    : props.workspaceDetail.status === "error"
      ? <section className="panel panel-empty" role="alert"><p>{props.workspaceDetail.message}</p></section>
      : loadingPanel("Loading workspace sessions…");

  const main = detail !== undefined && selectedSession !== undefined
    ? (
        <SessionCommandCenter
          workspace={detail.workspace}
          session={selectedSession}
          artifacts={detail.artifacts}
          recentAttention={detail.recentAttention}
          actions={props.actions}
        />
      )
    : loadingPanel("Select a workspace session to see the command center preview.");

  const aside = detail !== undefined
    ? <ContextPanel workspace={detail.workspace} artifacts={detail.artifacts} />
    : loadingPanel("Workspace context will appear here.");

  return (
    <div data-route="workspace-home-screen">
      <Shell
        health={props.health}
        platform={props.platform}
        connectionState={props.connectionState}
        workspaces={summaries}
        selectedWorkspaceId={props.selectedWorkspaceId}
        onSelectWorkspace={props.onSelectWorkspace}
        rail={rail}
        main={main}
        aside={aside}
      />
    </div>
  );
}
