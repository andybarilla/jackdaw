import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { Workspace } from "../../../shared/domain/workspace.js";

export interface ContextPanelProps {
  workspace: Workspace;
  artifacts: WorkspaceArtifact[];
}

export function ContextPanel({ workspace, artifacts }: ContextPanelProps): React.JSX.Element {
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
        <ul>
          {workspace.repoRoots.map((repoRoot) => (
            <li key={repoRoot.id}>{repoRoot.name} · {repoRoot.path}</li>
          ))}
        </ul>
      </div>

      <div className="context-section">
        <h4>Worktrees</h4>
        <ul>
          {workspace.worktrees.map((worktree) => (
            <li key={worktree.id}>{worktree.label ?? worktree.branch ?? worktree.path} · {worktree.path}</li>
          ))}
          {workspace.worktrees.length === 0 && <li>No worktrees tracked yet.</li>}
        </ul>
      </div>

      <div className="context-section">
        <h4>Linked artifacts</h4>
        <ul>
          {artifacts.slice(0, 4).map((artifact) => (
            <li key={artifact.id}>{artifact.kind} · {artifact.title}</li>
          ))}
          {artifacts.length === 0 && <li>No linked artifacts yet.</li>}
        </ul>
      </div>
    </aside>
  );
}
