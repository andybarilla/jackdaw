import { randomUUID } from "node:crypto";
import {
  attentionBandForSession,
  compareAttentionCandidates,
  createAttentionCandidate,
  type AttentionEvent,
} from "../../shared/domain/attention.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { Workspace } from "../../shared/domain/workspace.js";
import type { NormalizedSessionActivity } from "./event-normalizer.js";

export interface AttentionEngineOptions {
  idFactory?: () => string;
}

export class AttentionEngine {
  private readonly insertionOrderBySessionKey = new Map<string, number>();
  private nextInsertionOrder = 0;
  private readonly idFactory: () => string;

  constructor(options: AttentionEngineOptions = {}) {
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  rankWorkspaceSessions(workspace: Workspace | undefined, sessions: readonly WorkspaceSession[]): WorkspaceSession[] {
    this.hydrateWorkspaceOrder(workspace, sessions);

    return [...sessions]
      .map((session) => ({
        session,
        candidate: createAttentionCandidate(session, this.getInsertionOrder(session.workspaceId, session.id)),
      }))
      .sort((left, right) => compareAttentionCandidates(left.candidate, right.candidate))
      .map(({ session }) => structuredClone(session));
  }

  recordSession(session: WorkspaceSession): void {
    this.getInsertionOrder(session.workspaceId, session.id);
  }

  createSessionAttentionEvent(
    session: WorkspaceSession,
    title: string,
    detail: string | undefined,
    occurredAt: string,
    source: AttentionEvent["source"],
    meaningful: boolean = true,
  ): AttentionEvent {
    return {
      id: this.idFactory(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      band: attentionBandForSession(session),
      title,
      detail,
      occurredAt,
      source,
      meaningful,
    };
  }

  createRuntimeAttentionEvent(session: WorkspaceSession, activity: NormalizedSessionActivity): AttentionEvent {
    return {
      id: this.idFactory(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      band: attentionBandForSession(session),
      title: attentionTitleForActivity(activity),
      detail: activity.summary,
      occurredAt: activity.occurredAt,
      source: activity.source,
      meaningful: activity.meaningful,
    };
  }

  private hydrateWorkspaceOrder(workspace: Workspace | undefined, sessions: readonly WorkspaceSession[]): void {
    if (workspace !== undefined) {
      for (const sessionId of workspace.sessionIds) {
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (session !== undefined) {
          this.getInsertionOrder(session.workspaceId, session.id);
        }
      }
    }

    for (const session of sessions) {
      this.getInsertionOrder(session.workspaceId, session.id);
    }
  }

  private getInsertionOrder(workspaceId: string, sessionId: string): number {
    const key = createSessionKey(workspaceId, sessionId);
    const existingOrder = this.insertionOrderBySessionKey.get(key);
    if (existingOrder !== undefined) {
      return existingOrder;
    }

    const insertionOrder = this.nextInsertionOrder;
    this.nextInsertionOrder += 1;
    this.insertionOrderBySessionKey.set(key, insertionOrder);
    return insertionOrder;
  }
}

export function createSessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}::${sessionId}`;
}

function attentionTitleForActivity(activity: NormalizedSessionActivity): string {
  switch (activity.type) {
    case "awaiting-input":
      return "Awaiting operator input";
    case "blocked":
      return "Session blocked";
    case "failed":
      return "Session failed";
    case "completed":
      return "Session completed";
    case "tool-running":
      return "Tool running";
    case "tool-finished":
      return "Tool finished";
    case "message-streaming":
      return "Assistant streaming";
    case "assistant-update":
      return "Assistant update";
    case "agent-started":
      return "Agent started";
    case "idle":
      return "Agent idle";
    case "compaction":
      return "Session compaction";
    case "retrying":
      return "Retrying";
  }
}
