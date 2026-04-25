import type { DemoMutationEvent, DemoStateStore } from "../demo-state.js";
import type { WorkspaceEventBus } from "../api/sse/event-bus.js";
import type {
  CreateSessionDto,
  FollowUpSessionDto,
  MutationResponseDto,
  OpenPathDto,
  PinSummaryDto,
  SteerSessionDto,
} from "../../shared/transport/dto.js";
import type { CommandResult } from "../../shared/domain/commands.js";

export type RuntimeMutationErrorCode =
  | "session_not_found"
  | "workspace_not_found"
  | "invalid_state"
  | "controller_disposed"
  | "adapter_write_failed"
  | "persistence_failed"
  | "event_publish_failed";

export interface RuntimeMutationFailure {
  ok: false;
  code: RuntimeMutationErrorCode;
  reason: string;
  message: string;
  retryable: boolean;
  sessionState?: "degraded";
}

export type RuntimeMutationResult = MutationResponseDto | { result: RuntimeMutationFailure };

export interface SessionRuntimeManager {
  createWorkspaceSession(workspaceId: string, input: CreateSessionDto): Promise<RuntimeMutationResult | undefined>;
  steerSession(sessionId: string, input: SteerSessionDto): Promise<RuntimeMutationResult | undefined>;
  followUpSession(sessionId: string, input: FollowUpSessionDto): Promise<RuntimeMutationResult | undefined>;
  abortSession(sessionId: string): Promise<RuntimeMutationResult | undefined>;
  pinSessionSummary(sessionId: string, input: PinSummaryDto): Promise<RuntimeMutationResult | undefined>;
  openSessionPath(sessionId: string, input: OpenPathDto): Promise<RuntimeMutationResult | undefined>;
  runSessionShell(sessionId: string, command: string): Promise<RuntimeMutationResult | undefined>;
  disposeSession(sessionId: string): void;
}

interface RuntimeManagerOptions {
  store: DemoStateStore;
  eventBus: WorkspaceEventBus;
}

interface MutationCommit {
  response: MutationResponseDto;
  events: DemoMutationEvent[];
}

type MutationWork = () => MutationCommit | undefined | Promise<MutationCommit | undefined>;

function makeFailure(
  code: RuntimeMutationErrorCode,
  message: string,
  retryable: boolean,
  sessionState?: "degraded",
): RuntimeMutationResult {
  return {
    result: {
      ok: false,
      code,
      reason: message,
      message,
      retryable,
      sessionState,
    },
  };
}

function normalizeFailure(error: unknown): RuntimeMutationResult {
  const message = error instanceof Error ? error.message : "Session mutation failed.";
  return makeFailure("persistence_failed", message, true, "degraded");
}

function publishCommittedEvents(eventBus: WorkspaceEventBus, events: DemoMutationEvent[]): void {
  for (const { workspaceId, event } of events) {
    eventBus.publish(workspaceId, event);
  }
}

export function createSessionRuntimeManager(options: RuntimeManagerOptions): SessionRuntimeManager {
  const queues: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  const disposedSessions: Set<string> = new Set<string>();

  const enqueue = async (queueKey: string, sessionId: string | undefined, work: MutationWork): Promise<RuntimeMutationResult | undefined> => {
    if (sessionId !== undefined && disposedSessions.has(sessionId)) {
      return makeFailure("controller_disposed", "Session controller is no longer accepting commands.", false);
    }

    const previousQueue = queues.get(queueKey) ?? Promise.resolve();
    let releaseCurrent: () => void = () => undefined;
    const currentQueue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    queues.set(queueKey, previousQueue.then(() => currentQueue, () => currentQueue));

    await previousQueue.catch(() => undefined);

    try {
      if (sessionId !== undefined && disposedSessions.has(sessionId)) {
        return makeFailure("controller_disposed", "Session controller is no longer accepting commands.", false);
      }

      const mutation = await work();
      if (mutation === undefined) {
        return undefined;
      }

      publishCommittedEvents(options.eventBus, mutation.events);
      return mutation.response;
    } catch (error) {
      return normalizeFailure(error);
    } finally {
      releaseCurrent();
      if (queues.get(queueKey) === currentQueue) {
        queues.delete(queueKey);
      }
    }
  };

  return {
    createWorkspaceSession(workspaceId: string, input: CreateSessionDto): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`workspace:${workspaceId}`, undefined, () => options.store.createWorkspaceSession(workspaceId, input));
    },

    steerSession(sessionId: string, input: SteerSessionDto): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.steerSession(sessionId, input));
    },

    followUpSession(sessionId: string, input: FollowUpSessionDto): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.followUpSession(sessionId, input));
    },

    abortSession(sessionId: string): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.abortSession(sessionId));
    },

    pinSessionSummary(sessionId: string, input: PinSummaryDto): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.pinSessionSummary(sessionId, input));
    },

    openSessionPath(sessionId: string, input: OpenPathDto): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.openSessionPath(sessionId, input));
    },

    runSessionShell(sessionId: string, command: string): Promise<RuntimeMutationResult | undefined> {
      return enqueue(`session:${sessionId}`, sessionId, () => options.store.runSessionShell(sessionId, command));
    },

    disposeSession(sessionId: string): void {
      disposedSessions.add(sessionId);
    },
  };
}

export function isRuntimeMutationFailure(result: CommandResult): result is RuntimeMutationFailure {
  return !result.ok && "code" in result;
}
