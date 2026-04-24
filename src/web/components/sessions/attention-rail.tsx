import React from "react";
import { attentionBandForStatus, ATTENTION_BANDS } from "../../../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import { SessionRow } from "./session-row.js";

export interface AttentionRailProps {
  sessions: WorkspaceSession[];
  artifacts: WorkspaceArtifact[];
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
}

function bandHeading(band: (typeof ATTENTION_BANDS)[number]): string {
  if (band === "needs-operator") {
    return "Needs operator";
  }
  if (band === "active") {
    return "Active";
  }

  return "Quiet";
}

export function AttentionRail({ sessions, artifacts, selectedSessionId, onSelectSession }: AttentionRailProps): React.JSX.Element {
  return (
    <section className="attention-rail-shell" aria-label="Session attention rail">
      <div className="attention-rail-header">
        <p className="eyebrow">Attention rail</p>
        <h2>What needs me right now?</h2>
        <p className="attention-count">Sessions stay ordered by attention band, then keep a stable order inside each band.</p>
      </div>

      <div className="attention-rail-groups">
        {ATTENTION_BANDS.map((band) => {
          const bandSessions = sessions.filter((session) => attentionBandForStatus(session.status) === band);
          if (bandSessions.length === 0) {
            return null;
          }

          return (
            <section key={band} className="attention-group" aria-label={`${bandHeading(band)} sessions`}>
              <div className="attention-group-header">
                <span>{bandHeading(band)}</span>
                <span>{bandSessions.length} session{bandSessions.length === 1 ? "" : "s"}</span>
              </div>
              <div className="attention-group-list">
                {bandSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    artifacts={artifacts}
                    selected={session.id === selectedSessionId}
                    onSelectSession={onSelectSession}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {sessions.length === 0 && <p className="attention-empty">No sessions are available for this workspace.</p>}
      </div>
    </section>
  );
}
