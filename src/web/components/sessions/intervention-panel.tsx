import React from "react";
import type {
  SessionIntervention,
  SessionInterventionKind,
  WorkspaceSession,
} from "../../../shared/domain/session.js";
import type { WorkspaceActionHandlers, WorkspaceActionResult } from "../../hooks/useWorkspaceActions.js";

export interface InterventionPanelProps {
  session: WorkspaceSession;
  actions: WorkspaceActionHandlers;
  onMessage?: (message: string) => void;
  onOpenShellFallback?: () => void;
  onOpenSpawnSession?: () => void;
}

function hasObservedMeaningfulUpdate(session: WorkspaceSession, intervention: SessionIntervention): boolean {
  if (session.latestMeaningfulUpdate === undefined) {
    return false;
  }

  return session.updatedAt > intervention.requestedAt && session.latestMeaningfulUpdate !== intervention.text;
}

export function InterventionPanel({
  session,
  actions,
  onMessage,
  onOpenShellFallback,
  onOpenSpawnSession,
}: InterventionPanelProps): React.JSX.Element {
  const [interventionText, setInterventionText] = React.useState<string>("");
  const [displayedIntervention, setDisplayedIntervention] = React.useState<SessionIntervention | undefined>(session.lastIntervention);
  const [hasLocalInterventionOverride, setHasLocalInterventionOverride] = React.useState<boolean>(false);
  const [spawnTask, setSpawnTask] = React.useState<string>("");
  const [actionFeedback, setActionFeedback] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (session.lastIntervention !== undefined) {
      setDisplayedIntervention(session.lastIntervention);
      setHasLocalInterventionOverride(false);
      return;
    }

    setDisplayedIntervention((current) => {
      if (current === undefined) {
        return current;
      }

      if (hasLocalInterventionOverride && current.status === "pending-observation" && hasObservedMeaningfulUpdate(session, current)) {
        return {
          ...current,
          status: "observed",
          observedAt: session.updatedAt,
        };
      }

      return current;
    });
  }, [hasLocalInterventionOverride, session]);

  React.useEffect(() => {
    if (!hasLocalInterventionOverride || displayedIntervention?.status !== "accepted-locally") {
      return undefined;
    }

    const timeoutHandle = window.setTimeout(() => {
      setDisplayedIntervention((current) => {
        if (current?.status !== "accepted-locally") {
          return current;
        }

        return {
          ...current,
          status: "pending-observation",
        };
      });
    }, 1200);

    return () => {
      window.clearTimeout(timeoutHandle);
    };
  }, [displayedIntervention, hasLocalInterventionOverride]);

  React.useEffect(() => {
    if (!hasLocalInterventionOverride || displayedIntervention?.status !== "pending-observation") {
      return;
    }

    if (!hasObservedMeaningfulUpdate(session, displayedIntervention)) {
      return;
    }

    setDisplayedIntervention({
      ...displayedIntervention,
      status: "observed",
      observedAt: session.updatedAt,
    });
  }, [displayedIntervention, hasLocalInterventionOverride, session]);

  const handleIntervention = React.useCallback(async (
    kind: SessionInterventionKind,
    resultPromise: Promise<WorkspaceActionResult>,
  ): Promise<void> => {
    const trimmedText = interventionText.trim();
    const result = await resultPromise;

    setActionFeedback(result.message);
    onMessage?.(result.message);

    if (!result.ok) {
      setHasLocalInterventionOverride(true);
      setDisplayedIntervention({
        kind,
        status: "failed-locally",
        text: trimmedText,
        requestedAt: result.acceptedAt,
        errorMessage: result.message,
      });
      return;
    }

    setHasLocalInterventionOverride(true);
    setDisplayedIntervention({
      kind,
      status: "accepted-locally",
      text: trimmedText,
      requestedAt: result.acceptedAt,
    });
    setInterventionText("");
  }, [interventionText, onMessage]);

  const handleSteer = React.useCallback(async (): Promise<void> => {
    const trimmedText = interventionText.trim();
    if (!trimmedText) {
      return;
    }

    await handleIntervention("steer", actions.steerSession({ sessionId: session.id, text: trimmedText }));
  }, [actions, handleIntervention, interventionText, session.id]);

  const handleFollowUp = React.useCallback(async (): Promise<void> => {
    const trimmedText = interventionText.trim();
    if (!trimmedText) {
      return;
    }

    await handleIntervention("follow-up", actions.followUpSession({ sessionId: session.id, text: trimmedText }));
  }, [actions, handleIntervention, interventionText, session.id]);

  const handleAbort = React.useCallback(async (): Promise<void> => {
    const result = await actions.abortSession({ sessionId: session.id });
    setActionFeedback(result.message);
    onMessage?.(result.message);
    setHasLocalInterventionOverride(true);
    setDisplayedIntervention({
      kind: "abort",
      status: result.ok ? "accepted-locally" : "failed-locally",
      text: "Abort requested",
      requestedAt: result.acceptedAt,
      errorMessage: result.ok ? undefined : result.message,
    });
  }, [actions, onMessage, session.id]);

  const handleSpawnSession = React.useCallback(async (): Promise<void> => {
    const task = spawnTask.trim() || `Follow ${session.name}`;
    const result = await actions.spawnSession({
      workspaceId: session.workspaceId,
      cwd: session.cwd,
      repoRoot: session.repoRoot,
      worktree: session.worktree,
      branch: session.branch,
      task,
      name: `${session.name} follow-on`,
      linkedArtifactIds: session.linkedResources.artifactIds,
      linkedWorkItemIds: session.linkedResources.workItemIds,
    });
    setActionFeedback(result.message);
    onMessage?.(result.message);
    onOpenSpawnSession?.();
  }, [actions, onMessage, onOpenSpawnSession, session, spawnTask]);

  return (
    <section className="panel command-panel intervention-panel">
      <div className="panel-header">
        <p className="eyebrow">Intervention</p>
        <div className="command-row compact-row">
          <button className="ghost-button" type="button" onClick={handleSpawnSession}>Spawn session</button>
          <button className="ghost-button" type="button" onClick={onOpenShellFallback}>Shell fallback</button>
        </div>
      </div>

      <div className="detail-section first-detail-section">
        <h3>Latest intervention</h3>
        {displayedIntervention !== undefined ? (
          <div className="intervention-status-card">
            <div className="session-command-badges">
              <span className="status-pill">{displayedIntervention.kind}</span>
              <span className={`status-pill status-${displayedIntervention.status}`}>{displayedIntervention.status}</span>
            </div>
            <p>{displayedIntervention.text}</p>
            {displayedIntervention.errorMessage !== undefined && <p className="muted">{displayedIntervention.errorMessage}</p>}
          </div>
        ) : (
          <p>No intervention recorded yet.</p>
        )}
      </div>

      <div className="detail-section">
        <h3>Primary actions</h3>
        <label className="field-label" htmlFor={`intervention-text-${session.id}`}>Intervention text</label>
        <textarea
          id={`intervention-text-${session.id}`}
          className="command-textarea"
          rows={4}
          value={interventionText}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setInterventionText(event.target.value);
          }}
        />
        <div className="command-row">
          <button className="ghost-button" type="button" onClick={handleSteer}>Steer</button>
          <button className="ghost-button" type="button" onClick={handleFollowUp}>Follow-up</button>
          <button className="ghost-button danger-button" type="button" onClick={handleAbort}>Abort</button>
        </div>
      </div>

      <div className="detail-section">
        <h3>Spawn follow-on session</h3>
        <label className="field-label" htmlFor={`spawn-task-${session.id}`}>Spawn task</label>
        <input
          id={`spawn-task-${session.id}`}
          className="command-input"
          type="text"
          value={spawnTask}
          placeholder="Optional task for a new session"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setSpawnTask(event.target.value);
          }}
        />
      </div>

      {actionFeedback !== undefined && <p className="muted">{actionFeedback}</p>}
    </section>
  );
}
