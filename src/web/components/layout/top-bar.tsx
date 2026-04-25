import React from "react";
import type { HealthResponse } from "../../../shared/transport/api.js";
import type { WorkspaceSummaryDto } from "../../../shared/transport/dto.js";

export interface TopBarProps {
  health: HealthResponse | undefined;
  platform: string;
  connectionState: "connecting" | "live" | "disconnected";
  workspaces: WorkspaceSummaryDto[];
  selectedWorkspaceId?: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceExplorer?: () => void;
  onOpenSettings?: () => void;
}

export function TopBar({
  health,
  platform,
  connectionState,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onOpenWorkspaceExplorer,
  onOpenSettings,
}: TopBarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 36 28" width="20" height="16" fill="none">
            <path d="M4 14 L18 4 L32 14" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" />
            <path d="M4 24 L18 14 L32 24" stroke="var(--fg-0)" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" opacity="0.55" />
          </svg>
        </div>
        <div>
          <div className="brand-row">
            <p className="eyebrow">Jackdaw</p>
            <span className="topbar-version">{health?.version ?? "local"}</span>
          </div>
          <h1>Workspace home</h1>
          <p className="workspace-title">Live operations dashboard for active workspaces.</p>
        </div>
      </div>

      <div className="topbar-controls">
        <label className="workspace-selector-label" htmlFor="workspace-selector">Workspace</label>
        <select
          id="workspace-selector"
          aria-label="Workspace selector"
          className="workspace-selector"
          value={selectedWorkspaceId ?? ""}
          onChange={(event) => {
            onSelectWorkspace(event.target.value);
          }}
          disabled={workspaces.length === 0}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
        <div className="topbar-nav" aria-label="Workspace navigation">
          {onOpenWorkspaceExplorer !== undefined && <button type="button" onClick={onOpenWorkspaceExplorer}>Explorer</button>}
          {onOpenSettings !== undefined && <button type="button" onClick={onOpenSettings}>Settings</button>}
        </div>
        <div className="topbar-meta" aria-label="Service metadata">
          <span>{platform}</span>
          <span>stream {connectionState}</span>
          <span>{health?.service ?? "service"}</span>
        </div>
      </div>
    </header>
  );
}
