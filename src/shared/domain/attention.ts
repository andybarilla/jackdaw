import {
  compareSessionStatusPriority,
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

export function compareAttentionCandidates(a: AttentionCandidate, b: AttentionCandidate): number {
  const statusPriority = compareSessionStatusPriority(a.status, b.status);
  if (statusPriority !== 0) {
    return statusPriority;
  }

  return a.insertionOrder - b.insertionOrder;
}

export function createAttentionCandidate(session: WorkspaceSession, insertionOrder: number): AttentionCandidate {
  return {
    sessionId: session.id,
    status: session.status,
    insertionOrder,
    updatedAt: session.updatedAt,
  };
}
