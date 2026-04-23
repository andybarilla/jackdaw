import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import type { Workspace } from "../../../shared/domain/workspace.js";
import type { WorkspaceActionHandlers } from "../../hooks/useWorkspaceActions.js";

export interface SessionHeaderProps {
  workspace: Workspace;
  session: WorkspaceSession;
  linkedArtifact?: WorkspaceArtifact;
  actions: WorkspaceActionHandlers;
  onMessage: (message: string) => void;
  beginCommandMutation: (sessionId: string) => number;
  isLatestCommandMutation: (sessionId: string, requestId: number) => boolean;
}

export function SessionHeader({
  workspace,
  session,
  linkedArtifact,
  actions,
  onMessage,
  beginCommandMutation,
  isLatestCommandMutation,
}: SessionHeaderProps): React.JSX.Element {

  const handleOpenRepo = React.useCallback(async (): Promise<void> => {
    const requestSessionId = session.id;
    const requestId = beginCommandMutation(requestSessionId);
    const result = await actions.openPath({ workspaceId: workspace.id, path: session.repoRoot }, session.id);
    if (!isLatestCommandMutation(requestSessionId, requestId)) {
      return;
    }

    onMessage(result.message);
  }, [actions, beginCommandMutation, isLatestCommandMutation, onMessage, session.id, session.repoRoot, workspace.id]);

  const handleOpenWorktree = React.useCallback(async (): Promise<void> => {
    const path = session.worktree ?? session.cwd;
    const requestSessionId = session.id;
    const requestId = beginCommandMutation(requestSessionId);
    const result = await actions.openPath({ workspaceId: workspace.id, path }, session.id);
    if (!isLatestCommandMutation(requestSessionId, requestId)) {
      return;
    }

    onMessage(result.message);
  }, [actions, beginCommandMutation, isLatestCommandMutation, onMessage, session.cwd, session.id, session.worktree, workspace.id]);

  const handleOpenArtifact = React.useCallback(async (): Promise<void> => {
    if (linkedArtifact?.filePath === undefined) {
      return;
    }

    const requestSessionId = session.id;
    const requestId = beginCommandMutation(requestSessionId);
    const result = await actions.openPath({ workspaceId: workspace.id, path: linkedArtifact.filePath }, session.id);
    if (!isLatestCommandMutation(requestSessionId, requestId)) {
      return;
    }

    onMessage(result.message);
  }, [actions, beginCommandMutation, isLatestCommandMutation, linkedArtifact?.filePath, onMessage, session.id, workspace.id]);

  return (
    <section className="panel session-command-header">
      <div className="session-command-heading-row">
        <div>
          <p className="eyebrow">Selected session</p>
          <h2>{session.name}</h2>
          <p className="workspace-title">{session.repoRoot}{session.branch ? ` · ${session.branch}` : ""}</p>
        </div>
        <div className="session-command-badges">
          <span className={`status-pill status-${session.status}`}>{session.status}</span>
          <span className="status-pill">{session.connectionState}</span>
        </div>
      </div>

      <dl className="session-facts compact command-header-facts">
        <div>
          <dt>Workspace</dt>
          <dd>{workspace.name}</dd>
        </div>
        <div>
          <dt>Worktree</dt>
          <dd>{session.worktree ?? "Not linked"}</dd>
        </div>
        <div>
          <dt>Current tool</dt>
          <dd>{session.currentTool ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Session file</dt>
          <dd>{session.sessionFile ?? "Not recorded"}</dd>
        </div>
      </dl>

      <div className="command-row">
        <button className="ghost-button" type="button" onClick={handleOpenRepo}>Open repo</button>
        <button className="ghost-button" type="button" onClick={handleOpenWorktree}>Open worktree</button>
        <button
          className="ghost-button"
          type="button"
          onClick={handleOpenArtifact}
          disabled={linkedArtifact?.filePath === undefined}
        >
          Open linked artifact
        </button>
      </div>
    </section>
  );
}
