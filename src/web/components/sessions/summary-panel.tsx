import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";

export interface SummaryPanelProps {
  session: WorkspaceSession;
  pinnedSummary?: string;
  linkedArtifacts: WorkspaceArtifact[];
  onPinSummary: () => void;
  onRefreshSummary: () => void;
}

function formatFileContext(filePath: string, operation?: string): string {
  if (operation === undefined) {
    return filePath;
  }

  return `${filePath} · ${operation}`;
}

export function SummaryPanel({
  session,
  pinnedSummary,
  linkedArtifacts,
  onPinSummary,
  onRefreshSummary,
}: SummaryPanelProps): React.JSX.Element {
  const changedFilesSnapshot = linkedArtifacts.find((artifact) => artifact.kind === "changed-files-snapshot");

  return (
    <section className="panel command-panel summary-panel">
      <div className="panel-header">
        <p className="eyebrow">Understanding</p>
        <div className="command-row compact-row">
          <button className="ghost-button" type="button" onClick={onPinSummary}>Pin summary</button>
          <button className="ghost-button" type="button" onClick={onRefreshSummary}>Refresh summary</button>
        </div>
      </div>

      <div className="summary-grid">
        <article className="summary-card" aria-label="Live summary panel">
          <p className="eyebrow">Live summary</p>
          <p>{session.liveSummary}</p>
        </article>
        <article className="summary-card" aria-label="Pinned summary panel">
          <p className="eyebrow">Pinned summary</p>
          <p>{pinnedSummary ?? "No pinned summary yet."}</p>
        </article>
      </div>

      {session.connectionState === "historical" && (
        <article className="summary-card" aria-label="Historical-only reconnect state">
          <p className="eyebrow">Historical-only</p>
          <p>{session.reconnectNote ?? "This session is visible as history, but no live controller is attached."}</p>
        </article>
      )}

      <dl className="session-facts compact">
        <div>
          <dt>Current activity</dt>
          <dd>{session.currentActivity ?? "No current activity reported."}</dd>
        </div>
        <div>
          <dt>Latest meaningful update</dt>
          <dd>{session.latestMeaningfulUpdate ?? "No meaningful update reported yet."}</dd>
        </div>
      </dl>

      <div className="detail-section">
        <h3>Recent context</h3>
        {session.recentFiles.length > 0 ? (
          <ul className="detail-list">
            {session.recentFiles.map((file) => (
              <li key={`${file.path}-${file.timestamp ?? ""}`}>{formatFileContext(file.path, file.operation)}</li>
            ))}
          </ul>
        ) : changedFilesSnapshot !== undefined ? (
          <p>{changedFilesSnapshot.title}</p>
        ) : (
          <p>No recent files or changed-files snapshot context available.</p>
        )}
      </div>
    </section>
  );
}
