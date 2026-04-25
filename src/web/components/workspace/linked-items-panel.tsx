import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";

export interface LinkedItemsPanelProps {
  session?: WorkspaceSession;
  artifacts: WorkspaceArtifact[];
  onOpenArtifact?: (artifactId: string) => void;
}

function formatRecentFile(file: WorkspaceSession["recentFiles"][number]): string {
  const operation = file.operation === undefined || file.operation === "unknown" ? "changed" : file.operation;
  return `${operation} · ${file.path}`;
}

export function LinkedItemsPanel({ session, artifacts, onOpenArtifact }: LinkedItemsPanelProps): React.JSX.Element {
  const linkedArtifacts = session === undefined
    ? artifacts.slice(0, 4)
    : artifacts.filter((artifact) => session.linkedResources.artifactIds.includes(artifact.id) || artifact.linkedSessionIds.includes(session.id));

  return (
    <section className="context-section linked-items-panel" aria-label="Linked session context">
      <h4>Selected session context</h4>
      {session === undefined
        ? <p className="muted">Select a session to inspect linked context.</p>
        : (
            <>
              <div>
                <h5>Linked artifacts</h5>
                <ul>
                  {linkedArtifacts.map((artifact) => (
                    <li key={artifact.id}>
                      <button type="button" className="link-button" onClick={() => onOpenArtifact?.(artifact.id)}>
                        {artifact.kind} · {artifact.title}
                      </button>
                    </li>
                  ))}
                  {linkedArtifacts.length === 0 && <li>No linked artifacts.</li>}
                </ul>
              </div>
              <div>
                <h5>Recent / changed files</h5>
                <ul>
                  {session.recentFiles.map((file) => (
                    <li key={`${file.path}-${file.timestamp ?? "unknown"}`}>
                      {formatRecentFile(file)}{file.timestamp !== undefined && <span> · {file.timestamp}</span>}
                    </li>
                  ))}
                  {session.recentFiles.length === 0 && <li>No recent file snapshot available.</li>}
                </ul>
              </div>
              <div>
                <h5>Work items</h5>
                <ul>
                  {session.linkedResources.workItemIds.map((workItemId) => <li key={workItemId}>{workItemId}</li>)}
                  {session.linkedResources.workItemIds.length === 0 && <li>No lightweight work item links.</li>}
                </ul>
              </div>
            </>
          )}
    </section>
  );
}
