import React from "react";
import { compareAttentionCandidates, createAttentionCandidate } from "../../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { WorkspaceDetailDto, WorkspaceStreamEventDto } from "../../shared/transport/dto.js";
import type { ApiClient } from "../lib/api-client.js";
import { createBrowserEventSource, type BrowserEventSource, type EventSourceFactory } from "../lib/event-source.js";

export type Loadable<TData> =
  | { status: "loading" }
  | { status: "ready"; data: TData }
  | { status: "error"; message: string };

export interface WorkspaceStreamState {
  detail: Loadable<WorkspaceDetailDto>;
  connectionState: "connecting" | "live" | "disconnected";
}

export interface WorkspaceStreamOptions {
  eventSourceFactory?: EventSourceFactory;
}

function cloneArtifacts(artifacts: WorkspaceArtifact[]): WorkspaceArtifact[] {
  return artifacts.map((artifact) => ({ ...artifact }));
}

function cloneSessions(sessions: WorkspaceSession[]): WorkspaceSession[] {
  return sessions.map((session) => ({
    ...session,
    recentFiles: session.recentFiles.map((file) => ({ ...file })),
    runtime: { ...session.runtime },
    linkedResources: {
      ...session.linkedResources,
      artifactIds: [...session.linkedResources.artifactIds],
      workItemIds: [...session.linkedResources.workItemIds],
      reviewIds: [...session.linkedResources.reviewIds],
    },
    lastIntervention: session.lastIntervention === undefined ? undefined : { ...session.lastIntervention },
  }));
}

function sortSessionsForAttention(sessions: WorkspaceSession[], stableOrderBySessionId: Map<string, number>): WorkspaceSession[] {
  let nextInsertionOrder = stableOrderBySessionId.size;
  for (const session of sessions) {
    if (!stableOrderBySessionId.has(session.id)) {
      stableOrderBySessionId.set(session.id, nextInsertionOrder);
      nextInsertionOrder += 1;
    }
  }

  return cloneSessions(sessions)
    .map((session) => ({
      session,
      candidate: createAttentionCandidate(session, stableOrderBySessionId.get(session.id) ?? Number.MAX_SAFE_INTEGER),
    }))
    .sort((left, right) => compareAttentionCandidates(left.candidate, right.candidate))
    .map(({ session }) => session);
}

function withOrderedSessions(detail: WorkspaceDetailDto, stableOrderBySessionId: Map<string, number>): WorkspaceDetailDto {
  return {
    workspace: {
      ...detail.workspace,
      repoRoots: detail.workspace.repoRoots.map((repoRoot) => ({ ...repoRoot })),
      worktrees: detail.workspace.worktrees.map((worktree) => ({ ...worktree })),
      sessionIds: [...detail.workspace.sessionIds],
      artifactIds: [...detail.workspace.artifactIds],
      preferences: { ...detail.workspace.preferences },
      optionalIntegrations: detail.workspace.optionalIntegrations === undefined ? undefined : { ...detail.workspace.optionalIntegrations },
    },
    sessions: sortSessionsForAttention(detail.sessions, stableOrderBySessionId),
    artifacts: cloneArtifacts(detail.artifacts),
    recentAttention: detail.recentAttention.map((event) => ({ ...event })),
  };
}

function upsertSession(sessions: WorkspaceSession[], sessionId: string, update: (session: WorkspaceSession) => WorkspaceSession): WorkspaceSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    return update(session);
  });
}

export function applyWorkspaceStreamEvent(
  currentDetail: WorkspaceDetailDto,
  event: WorkspaceStreamEventDto,
  stableOrderBySessionId: Map<string, number>,
  apiClient?: ApiClient,
): WorkspaceDetailDto | Promise<WorkspaceDetailDto> {
  if (event.type === "workspace.snapshot") {
    return withOrderedSessions(event.payload.detail, stableOrderBySessionId);
  }

  if (event.type === "workspace.updated" || event.type === "artifact.linked") {
    if (apiClient === undefined) {
      return currentDetail;
    }

    return apiClient.getWorkspaceDetail(currentDetail.workspace.id).then((detail) => withOrderedSessions(detail, stableOrderBySessionId));
  }

  if (event.type === "session.status-changed") {
    return withOrderedSessions({
      ...currentDetail,
      sessions: upsertSession(currentDetail.sessions, event.payload.sessionId, (session) => ({
        ...session,
        status: event.payload.status,
        updatedAt: event.payload.changedAt,
      })),
    }, stableOrderBySessionId);
  }

  if (event.type === "session.summary-updated") {
    return withOrderedSessions({
      ...currentDetail,
      sessions: upsertSession(currentDetail.sessions, event.payload.sessionId, (session) => ({
        ...session,
        liveSummary: event.payload.liveSummary,
        pinnedSummary: event.payload.pinnedSummary ?? session.pinnedSummary,
        latestMeaningfulUpdate: event.payload.liveSummary,
        updatedAt: event.payload.updatedAt,
      })),
    }, stableOrderBySessionId);
  }

  if (event.type === "session.recent-files-updated") {
    return withOrderedSessions({
      ...currentDetail,
      sessions: upsertSession(currentDetail.sessions, event.payload.sessionId, (session) => ({
        ...session,
        recentFiles: event.payload.files.map((file) => ({ ...file })),
        updatedAt: event.payload.updatedAt,
      })),
    }, stableOrderBySessionId);
  }

  if (event.type === "session.intervention-changed") {
    return withOrderedSessions({
      ...currentDetail,
      sessions: upsertSession(currentDetail.sessions, event.payload.sessionId, (session) => ({
        ...session,
        lastIntervention: event.payload.intervention === undefined ? undefined : { ...event.payload.intervention },
        updatedAt: event.payload.updatedAt,
      })),
      recentAttention: currentDetail.recentAttention,
    }, stableOrderBySessionId);
  }

  return currentDetail;
}

export function useWorkspaceStream(
  workspaceId: string | undefined,
  apiClient: ApiClient,
  options: WorkspaceStreamOptions = {},
): WorkspaceStreamState {
  const eventSourceFactory = options.eventSourceFactory ?? createBrowserEventSource;
  const [detail, setDetail] = React.useState<Loadable<WorkspaceDetailDto>>({ status: "loading" });
  const [connectionState, setConnectionState] = React.useState<WorkspaceStreamState["connectionState"]>("connecting");
  const stableOrderBySessionIdRef = React.useRef<Map<string, number>>(new Map<string, number>());

  React.useEffect(() => {
    stableOrderBySessionIdRef.current = new Map<string, number>();
    if (workspaceId === undefined) {
      setDetail({ status: "loading" });
      setConnectionState("disconnected");
      return;
    }

    let cancelled = false;
    let eventSource: BrowserEventSource | undefined;
    setDetail({ status: "loading" });
    setConnectionState("connecting");

    void apiClient.getWorkspaceDetail(workspaceId)
      .then((nextDetail) => {
        if (cancelled) {
          return;
        }

        setDetail({ status: "ready", data: withOrderedSessions(nextDetail, stableOrderBySessionIdRef.current) });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setDetail({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        setConnectionState("disconnected");
      });

    eventSource = eventSourceFactory(`${apiClient.serviceBaseUrl}/workspaces/${workspaceId}/events`);

    const handleOpen = (): void => {
      if (!cancelled) {
        setConnectionState("live");
      }
    };

    const handleError = (): void => {
      if (!cancelled) {
        setConnectionState("disconnected");
      }
    };

    const handleStreamEvent = (messageEvent: Event): void => {
      if (!(messageEvent instanceof MessageEvent)) {
        return;
      }

      const parsedEvent = JSON.parse(messageEvent.data) as WorkspaceStreamEventDto;
      setDetail((currentDetail) => {
        if (currentDetail.status !== "ready") {
          return currentDetail;
        }

        const appliedUpdate = applyWorkspaceStreamEvent(currentDetail.data, parsedEvent, stableOrderBySessionIdRef.current, apiClient);
        if (appliedUpdate instanceof Promise) {
          void appliedUpdate.then((resolvedDetail) => {
            if (!cancelled) {
              setDetail({ status: "ready", data: resolvedDetail });
            }
          });
          return currentDetail;
        }

        return { status: "ready", data: appliedUpdate };
      });
    };

    eventSource.addEventListener("open", handleOpen);
    eventSource.addEventListener("error", handleError);
    eventSource.addEventListener("workspace.snapshot", handleStreamEvent);
    eventSource.addEventListener("workspace.updated", handleStreamEvent);
    eventSource.addEventListener("session.status-changed", handleStreamEvent);
    eventSource.addEventListener("session.summary-updated", handleStreamEvent);
    eventSource.addEventListener("session.recent-files-updated", handleStreamEvent);
    eventSource.addEventListener("session.intervention-changed", handleStreamEvent);
    eventSource.addEventListener("artifact.linked", handleStreamEvent);

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [apiClient, eventSourceFactory, workspaceId]);

  return {
    detail,
    connectionState,
  };
}
