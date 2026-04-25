import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import type { Workspace } from "../../../shared/domain/workspace.js";
import { LinkedItemsPanel } from "./linked-items-panel.js";
import { RepoList } from "./repo-list.js";
import { WorktreeList } from "./worktree-list.js";

export interface ContextPanelProps {
  workspace: Workspace;
  artifacts: WorkspaceArtifact[];
  selectedSession?: WorkspaceSession;
  onOpenArtifact?: (artifactId: string) => void;
}

export function ContextPanel({ workspace, artifacts, selectedSession, onOpenArtifact }: ContextPanelProps): React.JSX.Element {
  return (
    <aside className="panel workspace-context-panel" aria-label="Workspace context panel">
      <div className="panel-header">
        <p className="eyebrow">Workspace context</p>
      </div>

      <div className="context-section">
        <h3>{workspace.name}</h3>
        {workspace.description !== undefined && <p>{workspace.description}</p>}
      </div>

      <div className="context-section">
        <h4>Repo roots</h4>
        <RepoList repos={workspace.repoRoots} />
      </div>

      <div className="context-section">
        <h4>Worktrees</h4>
        <WorktreeList worktrees={workspace.worktrees} />
      </div>

      <LinkedItemsPanel session={selectedSession} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
    </aside>
  );
}
