import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";

export interface SessionRowProps {
  session: WorkspaceSession;
  artifacts: WorkspaceArtifact[];
  selected: boolean;
  onSelectSession: (sessionId: string) => void;
}

function statusLabel(session: WorkspaceSession): string {
  if (session.status === "awaiting-input") {
    return "Needs operator · Awaiting input";
  }
  if (session.status === "blocked") {
    return "Needs operator · Blocked";
  }
  if (session.status === "failed") {
    return "Needs operator · Failed";
  }
  if (session.status === "running") {
    return "Active · Running";
  }

  return "Quiet · Stable";
}

function attentionReason(session: WorkspaceSession): string {
  if (session.lastIntervention?.text !== undefined && session.lastIntervention.text.length > 0) {
    return session.lastIntervention.text;
  }

  if (session.latestMeaningfulUpdate !== undefined && session.latestMeaningfulUpdate.length > 0) {
    return session.latestMeaningfulUpdate;
  }

  if (session.currentActivity !== undefined && session.currentActivity.length > 0) {
    return session.currentActivity;
  }

  return "No explicit attention note yet.";
}

function repoContext(session: WorkspaceSession): string {
  const contextParts: string[] = [session.repoRoot];
  if (session.worktree !== undefined) {
    contextParts.push(session.worktree);
  }
  if (session.branch !== undefined) {
    contextParts.push(session.branch);
  }

  return contextParts.join(" · ");
}

function recentFilesContext(session: WorkspaceSession): string {
  if (session.recentFiles.length === 0) {
    return "No recent files recorded.";
  }

  return session.recentFiles
    .slice(0, 2)
    .map((file) => `${file.path}${file.operation === undefined ? "" : ` · ${file.operation}`}`)
    .join(" • ");
}

function linkedItemLabel(session: WorkspaceSession, artifacts: WorkspaceArtifact[]): string {
  const linkedPlanOrSpec = artifacts.find((artifact) => {
    return session.linkedResources.artifactIds.includes(artifact.id) && (artifact.kind === "plan" || artifact.kind === "spec");
  });

  if (linkedPlanOrSpec !== undefined) {
    return `${linkedPlanOrSpec.kind} · ${linkedPlanOrSpec.title}`;
  }

  const workItemId = session.linkedResources.workItemIds[0] ?? session.linkedResources.hqWorkItemId;
  if (workItemId !== undefined) {
    return `work item · ${workItemId}`;
  }

  return "No linked plan, spec, or work item.";
}

export function SessionRow({ session, artifacts, selected, onSelectSession }: SessionRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`session-row${selected ? " selected" : ""}`}
      onClick={() => {
        onSelectSession(session.id);
      }}
    >
      <span className="session-row-status">{statusLabel(session)}</span>
      <strong className="session-row-title">{session.name}</strong>
      <span className="session-row-line"><span className="session-row-label">Why it needs attention</span>{attentionReason(session)}</span>
      <span className="session-row-line"><span className="session-row-label">Current activity</span>{session.currentActivity ?? "No current activity reported."}</span>
      <span className="session-row-line"><span className="session-row-label">Latest update</span>{session.latestMeaningfulUpdate ?? session.liveSummary}</span>
      <span className="session-row-line"><span className="session-row-label">Repo context</span>{repoContext(session)}</span>
      <span className="session-row-line"><span className="session-row-label">Recent files</span>{recentFilesContext(session)}</span>
      <span className="session-row-line"><span className="session-row-label">Linked work</span>{linkedItemLabel(session, artifacts)}</span>
    </button>
  );
}
