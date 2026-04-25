import React from "react";
import { SplitPane } from "./split-pane.js";
import { TopBar } from "./top-bar.js";
import type { HealthResponse } from "../../../shared/transport/api.js";
import type { WorkspaceSummaryDto } from "../../../shared/transport/dto.js";

export interface ShellProps {
  health: HealthResponse | undefined;
  platform: string;
  connectionState: "connecting" | "live" | "disconnected";
  workspaces: WorkspaceSummaryDto[];
  selectedWorkspaceId?: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceExplorer?: () => void;
  onOpenSettings?: () => void;
  rail: React.ReactNode;
  main: React.ReactNode;
  aside: React.ReactNode;
}

export function Shell(props: ShellProps): React.JSX.Element {
  return (
    <div className="app-shell">
      <TopBar
        health={props.health}
        platform={props.platform}
        connectionState={props.connectionState}
        workspaces={props.workspaces}
        selectedWorkspaceId={props.selectedWorkspaceId}
        onSelectWorkspace={props.onSelectWorkspace}
        onOpenWorkspaceExplorer={props.onOpenWorkspaceExplorer}
        onOpenSettings={props.onOpenSettings}
      />
      <main>
        <SplitPane rail={props.rail} main={props.main} aside={props.aside} />
      </main>
    </div>
  );
}
