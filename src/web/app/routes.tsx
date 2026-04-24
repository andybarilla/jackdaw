import React from "react";
import type { HealthResponse } from "../../shared/transport/api.js";
import type { WorkspaceDetailDto, WorkspaceSummaryDto } from "../../shared/transport/dto.js";
import { useWorkspaceActions } from "../hooks/useWorkspaceActions.js";
import { useWorkspaceSelection } from "../hooks/useWorkspaceSelection.js";
import { useWorkspaceStream, type Loadable } from "../hooks/useWorkspaceStream.js";
import { WorkspaceHomeScreen } from "../screens/home/workspace-home-screen.js";
import { useAppServices } from "./providers.js";

export function AppRoutes(): React.JSX.Element {
  const { apiClient, bootstrap } = useAppServices();
  const [health, setHealth] = React.useState<Loadable<HealthResponse>>({ status: "loading" });
  const [workspaceSummaries, setWorkspaceSummaries] = React.useState<Loadable<WorkspaceSummaryDto[]>>({ status: "loading" });
  const { selectedWorkspaceId, selectWorkspace } = useWorkspaceSelection(
    workspaceSummaries.status === "ready" ? workspaceSummaries.data : undefined,
  );
  const workspaceStream = useWorkspaceStream(selectedWorkspaceId, apiClient);
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | undefined>(undefined);
  const actions = useWorkspaceActions(bootstrap.serviceBaseUrl);

  React.useEffect(() => {
    let cancelled = false;

    void apiClient.getHealth()
      .then((nextHealth) => {
        if (!cancelled) {
          setHealth({ status: "ready", data: nextHealth });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealth({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });

    void apiClient.listWorkspaces()
      .then((nextWorkspaces) => {
        if (!cancelled) {
          setWorkspaceSummaries({ status: "ready", data: nextWorkspaces });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorkspaceSummaries({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  React.useEffect(() => {
    const currentDetail = workspaceStream.detail;
    if (currentDetail.status !== "ready") {
      return;
    }

    setSelectedSessionId((currentSelectedSessionId: string | undefined) => {
      const matchingSession = currentDetail.data.sessions.find((session) => session.id === currentSelectedSessionId);
      if (matchingSession !== undefined) {
        return matchingSession.id;
      }

      return currentDetail.data.workspace.preferences.selectedSessionId
        ?? currentDetail.data.sessions[0]?.id;
    });
  }, [workspaceStream.detail]);

  return (
    <WorkspaceHomeScreen
      platform={bootstrap.platform}
      health={health.status === "ready" ? health.data : undefined}
      workspaceSummaries={workspaceSummaries}
      workspaceDetail={workspaceStream.detail}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedSessionId={selectedSessionId}
      connectionState={workspaceStream.connectionState}
      onSelectWorkspace={selectWorkspace}
      onSelectSession={setSelectedSessionId}
      actions={actions}
    />
  );
}
