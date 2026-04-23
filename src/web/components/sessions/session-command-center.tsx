import React from "react";
import type { AttentionEvent } from "../../../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import type { Workspace } from "../../../shared/domain/workspace.js";
import type { WorkspaceActionHandlers } from "../../hooks/useWorkspaceActions.js";
import { InterventionPanel } from "./intervention-panel.js";
import { RecentEventsPanel } from "./recent-events-panel.js";
import { SessionHeader } from "./session-header.js";
import { ShellFallbackDialog } from "./shell-fallback-dialog.js";
import { SummaryPanel } from "./summary-panel.js";

function getPinnedSummaryActionMessage(action: "pin" | "refresh", liveSummary: string): string {
  return action === "refresh"
    ? `Pinned summary replaced: ${liveSummary}`
    : `Pinned summary frozen: ${liveSummary}`;
}

export interface SessionCommandCenterProps {
  workspace: Workspace;
  session: WorkspaceSession;
  artifacts: WorkspaceArtifact[];
  recentAttention: AttentionEvent[];
  actions: WorkspaceActionHandlers;
}

function linkedArtifactsForSession(session: WorkspaceSession, artifacts: WorkspaceArtifact[]): WorkspaceArtifact[] {
  const artifactsById = new Map<string, WorkspaceArtifact>(artifacts.map((artifact) => [artifact.id, artifact]));
  return session.linkedResources.artifactIds.flatMap((artifactId) => {
    const artifact = artifactsById.get(artifactId);
    return artifact === undefined ? [] : [artifact];
  });
}

function firstFileBackedArtifact(linkedArtifacts: WorkspaceArtifact[]): WorkspaceArtifact | undefined {
  return linkedArtifacts.find((artifact) => artifact.filePath !== undefined);
}

export function SessionCommandCenter({
  workspace,
  session,
  artifacts,
  recentAttention,
  actions,
}: SessionCommandCenterProps): React.JSX.Element {
  const [message, setMessage] = React.useState<string | undefined>(undefined);
  const [pinnedSummary, setPinnedSummary] = React.useState<string | undefined>(session.pinnedSummary);
  const [shellDialogOpen, setShellDialogOpen] = React.useState<boolean>(false);
  const [shellCommand, setShellCommand] = React.useState<string>("");
  const [shellErrorMessage, setShellErrorMessage] = React.useState<string | undefined>(undefined);
  const activeSessionIdRef = React.useRef<string>(session.id);
  activeSessionIdRef.current = session.id;

  React.useEffect(() => {
    setMessage(undefined);
    setPinnedSummary(session.pinnedSummary);
    setShellDialogOpen(false);
    setShellCommand("");
    setShellErrorMessage(undefined);
  }, [session.id, session.pinnedSummary]);

  React.useEffect(() => {
    setPinnedSummary((currentPinnedSummary) => currentPinnedSummary ?? session.pinnedSummary);
  }, [session.pinnedSummary]);

  const linkedArtifacts = React.useMemo<WorkspaceArtifact[]>(() => linkedArtifactsForSession(session, artifacts), [artifacts, session]);
  const openableLinkedArtifact = React.useMemo<WorkspaceArtifact | undefined>(() => {
    return firstFileBackedArtifact(linkedArtifacts);
  }, [linkedArtifacts]);
  const sessionAttention = React.useMemo<AttentionEvent[]>(() => {
    return recentAttention.filter((event) => event.sessionId === session.id).slice(0, 5);
  }, [recentAttention, session.id]);

  const handlePinSummary = React.useCallback(async (): Promise<void> => {
    const frozenSummary = session.liveSummary.trim();
    if (!frozenSummary) {
      setMessage("No live summary available to pin.");
      return;
    }

    const requestSessionId = session.id;
    const result = await actions.pinSummary({ sessionId: session.id, summary: frozenSummary });
    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setPinnedSummary(frozenSummary);
    setMessage(getPinnedSummaryActionMessage("pin", frozenSummary));
  }, [actions, session.id, session.liveSummary]);

  const handleRefreshSummary = React.useCallback(async (): Promise<void> => {
    const refreshedSummary = session.liveSummary.trim();
    if (!refreshedSummary) {
      setMessage("No live summary available to pin.");
      return;
    }

    const requestSessionId = session.id;
    const result = await actions.pinSummary({ sessionId: session.id, summary: refreshedSummary });
    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setPinnedSummary(refreshedSummary);
    setMessage(getPinnedSummaryActionMessage("refresh", refreshedSummary));
  }, [actions, session.id, session.liveSummary]);

  const handleShellSubmit = React.useCallback(async (): Promise<void> => {
    const trimmedCommand = shellCommand.trim();
    if (!trimmedCommand) {
      setShellErrorMessage("Enter a shell command before running the fallback.");
      return;
    }

    const requestSessionId = session.id;
    const result = await actions.shellFallback({ sessionId: session.id, command: trimmedCommand });
    if (activeSessionIdRef.current !== requestSessionId) {
      return;
    }

    setMessage(result.message);
    setShellErrorMessage(undefined);
    setShellDialogOpen(false);
    setShellCommand("");
  }, [actions, session.id, shellCommand]);

  return (
    <section className="session-command-center" aria-label="Session command center">
      <SessionHeader
        workspace={workspace}
        session={session}
        linkedArtifact={openableLinkedArtifact}
        actions={actions}
        onMessage={setMessage}
      />

      <div className="command-center-grid">
        <SummaryPanel
          session={session}
          pinnedSummary={pinnedSummary}
          linkedArtifacts={linkedArtifacts}
          onPinSummary={() => {
            void handlePinSummary();
          }}
          onRefreshSummary={() => {
            void handleRefreshSummary();
          }}
        />
        <InterventionPanel
          session={session}
          recentAttention={sessionAttention}
          actions={actions}
          onMessage={setMessage}
          onOpenShellFallback={() => {
            setShellDialogOpen(true);
          }}
        />
        <RecentEventsPanel session={session} recentAttention={sessionAttention} linkedArtifacts={linkedArtifacts} />
      </div>

      {message !== undefined && <p className="muted command-feedback">{message}</p>}

      <ShellFallbackDialog
        open={shellDialogOpen}
        command={shellCommand}
        onCommandChange={setShellCommand}
        onCancel={() => {
          setShellDialogOpen(false);
          setShellErrorMessage(undefined);
        }}
        onSubmit={() => {
          void handleShellSubmit();
        }}
        errorMessage={shellErrorMessage}
      />
    </section>
  );
}
