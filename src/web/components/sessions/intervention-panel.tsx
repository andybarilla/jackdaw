import React from "react";
import type { AttentionEvent } from "../../../shared/domain/attention.js";
import type {
  SessionIntervention,
  SessionInterventionKind,
  WorkspaceSession,
} from "../../../shared/domain/session.js";
import type { WorkspaceActionHandlers, WorkspaceActionResult } from "../../hooks/useWorkspaceActions.js";

export interface InterventionPanelProps {
  session: WorkspaceSession;
  recentAttention?: AttentionEvent[];
  actions: WorkspaceActionHandlers;
  onMessage?: (message: string) => void;
  onOpenShellFallback?: () => void;
  onOpenSpawnSession?: () => void;
}

function parseTimestamp(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function findObservedAttentionEvent(
  recentAttention: AttentionEvent[],
  intervention: SessionIntervention,
): AttentionEvent | undefined {
  const requestedAt = parseTimestamp(intervention.requestedAt);
  return recentAttention.find((event) => {
    return event.meaningful !== false && event.source !== "operator" && parseTimestamp(event.occurredAt) > requestedAt;
  });
}

export function InterventionPanel({
  session,
  recentAttention = [],
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
  const activeSessionIdRef = React.useRef<string>(session.id);

  React.useEffect(() => {
    activeSessionIdRef.current = session.id;
    setInterventionText("");
    setDisplayedIntervention(session.lastIntervention);
    setHasLocalInterventionOverride(false);
    setSpawnTask("");
    setActionFeedback(undefined);
  }, [session.id]);

  React.useEffect(() => {
    if (hasLocalInterventionOverride) {
      return;
    }

    setDisplayedIntervention(session.lastIntervention);
  }, [hasLocalInterventionOverride, session.lastIntervention]);

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

    const observedAttentionEvent = findObservedAttentionEvent(recentAttention, displayedIntervention);
    if (observedAttentionEvent === undefined) {
      return;
    }

    setDisplayedIntervention({
      ...displayedIntervention,
      status: "observed",
      observedAt: observedAttentionEvent.occurredAt,
    });
  }, [displayedIntervention, hasLocalInterventionOverride, recentAttention]);

  const handleIntervention = React.useCallback(async (
    kind: SessionInterventionKind,
    resultPromise: Promise<WorkspaceActionResult>,
  ): Promise<void> => {
    const trimmedText = interventionText.trim();
    const requestSessionId = session.id;
    const result = await resultPromise;

    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

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
  }, [interventionText, onMessage, session.id]);

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
    const requestSessionId = session.id;
    const result = await actions.abortSession({ sessionId: session.id });
    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

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
    const requestSessionId = session.id;
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
    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

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
