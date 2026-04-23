import React from "react";
import type { AttentionEvent } from "../../../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";

export interface RecentEventsPanelProps {
  session: WorkspaceSession;
  recentAttention: AttentionEvent[];
  linkedArtifacts: WorkspaceArtifact[];
}

function formatArtifactLabel(artifact: WorkspaceArtifact): string {
  if (artifact.filePath === undefined) {
    return `${artifact.kind} · ${artifact.title}`;
  }

  return `${artifact.kind} · ${artifact.title} · ${artifact.filePath}`;
}

export function RecentEventsPanel({ session, recentAttention, linkedArtifacts }: RecentEventsPanelProps): React.JSX.Element {
  return (
    <section className="panel command-panel recent-events-panel">
      <div className="panel-header">
        <p className="eyebrow">Context and events</p>
      </div>

      <div className="detail-section first-detail-section">
        <h3>Recent attention events</h3>
        {recentAttention.length > 0 ? (
          <ul className="detail-list">
            {recentAttention.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                {event.detail ? ` — ${event.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent attention events for this session.</p>
        )}
      </div>

      <div className="detail-section">
        <h3>Linked state</h3>
        <dl className="session-facts compact linked-state-list">
          <div>
            <dt>Artifacts</dt>
            <dd>
              {linkedArtifacts.length > 0 ? (
                <ul className="detail-list nested-detail-list">
                  {linkedArtifacts.map((artifact) => (
                    <li key={artifact.id}>{formatArtifactLabel(artifact)}</li>
                  ))}
                </ul>
              ) : "No linked artifacts"}
            </dd>
          </div>
          <div>
            <dt>Work items</dt>
            <dd>{session.linkedResources.workItemIds.length > 0 ? session.linkedResources.workItemIds.join(", ") : "No linked work items"}</dd>
          </div>
          <div>
            <dt>Reviews</dt>
            <dd>{session.linkedResources.reviewIds.length > 0 ? session.linkedResources.reviewIds.join(", ") : "No linked reviews"}</dd>
          </div>
          <div>
            <dt>HQ work item</dt>
            <dd>{session.linkedResources.hqWorkItemId ?? "No HQ work item linked"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
