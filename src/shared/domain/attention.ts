import {
  compareSessionStatusPriority,
  type SessionConnectionState,
  type WorkspaceSession,
  type WorkspaceSessionStatus,
} from "./session.js";

export const ATTENTION_BANDS = ["needs-operator", "active", "quiet"] as const;
export type AttentionBand = (typeof ATTENTION_BANDS)[number];

export interface AttentionEvent {
  id: string;
  sessionId: string;
  workspaceId: string;
  band: AttentionBand;
  title: string;
  detail?: string;
  occurredAt: string;
  source: "runtime" | "operator" | "system";
  meaningful?: boolean;
}

export interface AttentionCandidate {
  sessionId: string;
  status: WorkspaceSessionStatus;
  connectionState: SessionConnectionState;
  insertionOrder: number;
  updatedAt: string;
}

export function attentionBandForStatus(status: WorkspaceSessionStatus): AttentionBand {
  if (status === "awaiting-input" || status === "blocked" || status === "failed") {
    return "needs-operator";
  }
  if (status === "running") {
    return "active";
  }
  return "quiet";
}

export function attentionBandForSession(session: WorkspaceSession): AttentionBand {
  if (session.connectionState === "historical") {
    return "quiet";
  }

  return attentionBandForStatus(session.status);
}

export function compareAttentionCandidates(a: AttentionCandidate, b: AttentionCandidate): number {
  const statusPriority = compareSessionStatusPriority(effectiveStatusForAttention(a), effectiveStatusForAttention(b));
  if (statusPriority !== 0) {
    return statusPriority;
  }

  return a.insertionOrder - b.insertionOrder;
}

export function createAttentionCandidate(session: WorkspaceSession, insertionOrder: number): AttentionCandidate {
  return {
    sessionId: session.id,
    status: session.status,
    connectionState: session.connectionState,
    insertionOrder,
    updatedAt: session.updatedAt,
  };
}

function effectiveStatusForAttention(candidate: AttentionCandidate): WorkspaceSessionStatus {
  if (candidate.connectionState === "historical") {
    return "done";
  }

  return candidate.status;
}
