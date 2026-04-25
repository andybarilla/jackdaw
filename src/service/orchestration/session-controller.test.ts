import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { ManagedPiSession, PiSessionEventListener } from "./session-adapter.js";
import { SessionController, type SessionControllerRepository } from "./session-controller.js";

class MemorySessionRepository implements SessionControllerRepository {
  session: WorkspaceSession;

  constructor(session: WorkspaceSession) {
    this.session = structuredClone(session);
  }

  async getWorkspaceSession(workspaceId: string, sessionId: string): Promise<WorkspaceSession | undefined> {
    if (this.session.workspaceId !== workspaceId || this.session.id !== sessionId) {
      return undefined;
    }

    return structuredClone(this.session);
  }

  async upsertSession(session: WorkspaceSession): Promise<void> {
    this.session = structuredClone(session);
  }
}

class DeferredFirstUpsertRepository extends MemorySessionRepository {
  upsertCount = 0;
  private readonly firstUpsertStartedPromise: Promise<void>;
  private readonly firstUpsertReleasePromise: Promise<void>;
  private firstUpsertStartedResolve: (() => void) | undefined;
  private firstUpsertReleaseResolve: (() => void) | undefined;

  constructor(session: WorkspaceSession) {
    super(session);
    this.firstUpsertStartedPromise = new Promise<void>((resolve) => {
      this.firstUpsertStartedResolve = resolve;
    });
    this.firstUpsertReleasePromise = new Promise<void>((resolve) => {
      this.firstUpsertReleaseResolve = resolve;
    });
  }

  override async upsertSession(session: WorkspaceSession): Promise<void> {
    this.upsertCount += 1;
    if (this.upsertCount === 1) {
      this.firstUpsertStartedResolve?.();
      await this.firstUpsertReleasePromise;
    }

    await super.upsertSession(session);
  }

  async waitForFirstUpsertStarted(): Promise<void> {
    await this.firstUpsertStartedPromise;
  }

  releaseFirstUpsert(): void {
    this.firstUpsertReleaseResolve?.();
  }
}

class RejectingSessionRepository extends MemorySessionRepository {
  override async upsertSession(_session: WorkspaceSession): Promise<void> {
    throw new Error("persistence unavailable");
  }
}

class FakeManagedSession implements ManagedPiSession {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly modelId: string | undefined;
  readonly prompt = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly steer = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly followUp = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly abort = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  readonly dispose = vi.fn<() => void>();
  private listener: PiSessionEventListener | undefined;

  constructor(sessionId: string = "ses-1", sessionFile: string | undefined = "ses-1.json", modelId: string | undefined = "sonnet") {
    this.sessionId = sessionId;
    this.sessionFile = sessionFile;
    this.modelId = modelId;
  }

  subscribe(listener: PiSessionEventListener): () => void {
    this.listener = listener;
    return (): void => {
      if (this.listener === listener) {
        this.listener = undefined;
      }
    };
  }

  emit(event: unknown): void {
    this.listener?.(event);
  }

  async emitAndWait(event: unknown): Promise<void> {
    await this.listener?.(event);
  }
}

function createSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: overrides.id ?? "ses-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    name: overrides.name ?? "Task session",
    repoRoot: overrides.repoRoot ?? "/workspace/repo",
    worktree: overrides.worktree,
    cwd: overrides.cwd ?? "/workspace/repo",
    branch: overrides.branch,
    runtime: overrides.runtime ?? { agent: "implementer", model: "sonnet", runtime: "pi" },
    status: overrides.status ?? "running",
    liveSummary: overrides.liveSummary ?? "Running task",
    pinnedSummary: overrides.pinnedSummary,
    latestMeaningfulUpdate: overrides.latestMeaningfulUpdate,
    currentActivity: overrides.currentActivity,
    currentTool: overrides.currentTool,
    lastIntervention: overrides.lastIntervention,
    recentFiles: overrides.recentFiles ?? [],
    linkedResources: overrides.linkedResources ?? {
      artifactIds: [],
      workItemIds: [],
      reviewIds: [],
    },
    connectionState: overrides.connectionState ?? "live",
    sessionFile: overrides.sessionFile,
    reconnectNote: overrides.reconnectNote,
    startedAt: overrides.startedAt,
    updatedAt: overrides.updatedAt ?? "2026-04-25T09:59:00.000Z",
    completedAt: overrides.completedAt,
    hqSessionId: overrides.hqSessionId,
  };
}

function createController(options: {
  session?: WorkspaceSession;
  managedSession?: FakeManagedSession;
  repository?: MemorySessionRepository;
  timestamps?: string[];
} = {}): { controller: SessionController; repository: MemorySessionRepository; managedSession: FakeManagedSession } {
  const session = options.session ?? createSession();
  const repository = options.repository ?? new MemorySessionRepository(session);
  const managedSession = options.managedSession ?? new FakeManagedSession(session.id, session.sessionFile);
  const timestamps = options.timestamps ?? [
    "2026-04-25T10:00:00.000Z",
    "2026-04-25T10:00:00.001Z",
    "2026-04-25T10:00:00.002Z",
    "2026-04-25T10:00:00.003Z",
  ];
  let timestampIndex = 0;
  const now = (): Date => new Date(timestamps[Math.min(timestampIndex++, timestamps.length - 1)]!);

  return {
    controller: new SessionController({
      session,
      managedSession,
      repository,
      now,
    }),
    repository,
    managedSession,
  };
}

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  let rejectDeferred: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return {
    promise,
    resolve(value: T): void {
      resolveDeferred?.(value);
    },
    reject(reason: unknown): void {
      rejectDeferred?.(reason);
    },
  };
}

async function waitForCondition(condition: () => boolean, failureMessage: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(failureMessage);
}

describe("SessionController", () => {
  it("serializes subscription event mutations before persisting newer session state", async () => {
    const session = createSession();
    const repository = new DeferredFirstUpsertRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    const { controller } = createController({
      session,
      managedSession,
      repository,
      timestamps: [
        "2026-04-25T10:00:00.000Z",
        "2026-04-25T10:00:00.001Z",
      ],
    });

    managedSession.emit({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "src/index.ts" },
    });
    await repository.waitForFirstUpsertStarted();

    managedSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Please confirm which migration path to use?" }],
      },
    });
    await Promise.resolve();

    repository.releaseFirstUpsert();
    await waitForCondition(() => repository.upsertCount >= 2, "queued session event was not persisted");

    expect(repository.session.status).toBe("awaiting-input");
    expect(repository.session.currentActivity).toBe("Awaiting input: Please confirm which migration path to use?");
    expect(controller.currentSession.status).toBe("awaiting-input");
  });

  it("ignores initial prompt failures after disposal", async () => {
    const managedSession = new FakeManagedSession();
    const prompt = createDeferredPromise<void>();
    managedSession.prompt.mockImplementation(async (): Promise<void> => {
      await prompt.promise;
    });
    const { controller, repository } = createController({ managedSession });

    controller.beginInitialPrompt("Run the task.");
    await controller.dispose();
    prompt.reject(new Error("provider disconnected"));
    await controller.waitForInitialPrompt();

    expect(repository.session.status).toBe("running");
    expect(repository.session.liveSummary).toBe("Running task");
    expect(managedSession.dispose).toHaveBeenCalledOnce();
  });

  it("propagates initial prompt failure persistence errors", async () => {
    const session = createSession();
    const repository = new RejectingSessionRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    managedSession.prompt.mockRejectedValue(new Error("provider disconnected"));
    const { controller } = createController({ session, managedSession, repository });

    controller.beginInitialPrompt("Run the task.");

    await expect(controller.waitForInitialPrompt()).rejects.toThrow("persistence unavailable");
    expect(controller.currentSession.status).toBe("running");
  });

  it("waits for in-flight mutations before disposal completes", async () => {
    const session = createSession();
    const repository = new DeferredFirstUpsertRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    const { controller } = createController({ session, managedSession, repository });

    const eventPromise = controller.handleSessionEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "src/index.ts" },
    });
    await repository.waitForFirstUpsertStarted();

    let disposeCompleted = false;
    const disposePromise = controller.dispose().then((): void => {
      disposeCompleted = true;
    });
    await Promise.resolve();

    expect(disposeCompleted).toBe(false);

    repository.releaseFirstUpsert();
    await Promise.all([eventPromise, disposePromise]);

    expect(disposeCompleted).toBe(true);
    expect(managedSession.dispose).toHaveBeenCalledOnce();
  });

  it("returns rejected command results when pin summary persistence fails", async () => {
    const session = createSession();
    const repository = new RejectingSessionRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    const { controller } = createController({ session, managedSession, repository });

    const result = await controller.pinSummary("Keep this visible.");

    expect(result).toEqual({
      ok: false,
      reason: "Failed to persist session state: persistence unavailable",
    });
  });

  it("does not submit interventions when the local accepted state cannot be persisted", async () => {
    const session = createSession();
    const repository = new RejectingSessionRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    const { controller } = createController({ session, managedSession, repository });

    const result = await controller.steer("Focus on the failing orchestration test.");

    expect(result).toEqual({
      ok: false,
      reason: "Failed to persist session state: persistence unavailable",
    });
    expect(managedSession.steer).not.toHaveBeenCalled();
  });

  it("propagates subscription listener persistence failures without advancing in-memory session state", async () => {
    const session = createSession();
    const repository = new RejectingSessionRepository(session);
    const managedSession = new FakeManagedSession(session.id, session.sessionFile);
    const { controller } = createController({ session, managedSession, repository });

    await expect(managedSession.emitAndWait({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "streaming" },
    })).rejects.toThrow("persistence unavailable");

    expect(controller.currentSession.liveSummary).toBe("Running task");
    expect(controller.currentSession.currentActivity).toBeUndefined();
  });

  it("keeps pending interventions pending until later meaningful non-local activity", async () => {
    const { controller, repository } = createController();

    await controller.followUp("Please confirm the migration path.");

    expect(repository.session.lastIntervention).toMatchObject({
      kind: "follow-up",
      status: "pending-observation",
      text: "Please confirm the migration path.",
    });

    await controller.handleSessionEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "streaming" },
    });

    expect(repository.session.lastIntervention?.status).toBe("pending-observation");

    await controller.handleSessionEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "src/index.ts" },
    });

    expect(repository.session.lastIntervention).toMatchObject({
      kind: "follow-up",
      status: "observed",
      observedAt: "2026-04-25T10:00:00.002Z",
    });
  });

  it("reconciles meaningful activity emitted during local intervention submission", async () => {
    const managedSession = new FakeManagedSession();
    const { controller, repository } = createController({ managedSession });

    managedSession.steer.mockImplementation(async (): Promise<void> => {
      await controller.handleSessionEvent({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "src/service/server.ts" },
      });
    });

    const result = await controller.steer("Focus on the failing orchestration test.");

    expect(result.ok).toBe(true);
    expect(repository.session.lastIntervention).toMatchObject({
      kind: "steer",
      status: "observed",
      text: "Focus on the failing orchestration test.",
      observedAt: "2026-04-25T10:00:00.001Z",
    });
  });

  it("does not downgrade stable attention statuses on later idle churn", async () => {
    const { controller, repository } = createController();

    await controller.handleSessionEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Please confirm which migration path to use?" }],
      },
    });
    await controller.handleSessionEvent({ type: "agent_end", messages: [] });

    expect(repository.session.status).toBe("awaiting-input");
    expect(repository.session.currentActivity).toBe("Agent turn completed");
  });

  it("attaches changed-file snapshots to session metadata", async () => {
    const { controller, repository } = createController();

    await controller.handleSessionEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "edit",
      args: { path: "src/service/orchestration/session-controller.ts" },
    });
    await controller.handleSessionEvent({
      type: "tool_execution_start",
      toolCallId: "call-2",
      toolName: "write",
      args: { path: "src/service/orchestration/runtime-manager.ts" },
    });
    await controller.handleSessionEvent({
      type: "tool_execution_end",
      toolCallId: "call-3",
      toolName: "edit",
      result: { path: "src/service/orchestration/session-controller.ts" },
      isError: false,
    });

    expect(repository.session.recentFiles).toEqual([
      {
        path: "src/service/orchestration/session-controller.ts",
        operation: "edited",
        timestamp: "2026-04-25T10:00:00.002Z",
      },
      {
        path: "src/service/orchestration/runtime-manager.ts",
        operation: "created",
        timestamp: "2026-04-25T10:00:00.001Z",
      },
    ]);
  });

  it("marks successful abort interventions observed immediately", async () => {
    const { controller, repository } = createController();

    const result = await controller.abort();

    expect(result.ok).toBe(true);
    expect(repository.session.status).toBe("idle");
    expect(repository.session.currentActivity).toBe("Abort observed locally");
    expect(repository.session.lastIntervention).toMatchObject({
      kind: "abort",
      status: "observed",
      text: "Abort requested by operator.",
      observedAt: "2026-04-25T10:00:00.000Z",
    });
  });

  it("records local submission failures without pretending they were observed", async () => {
    const managedSession = new FakeManagedSession();
    managedSession.abort.mockRejectedValue(new Error("abort transport disconnected"));
    const { controller, repository } = createController({ managedSession });

    const result = await controller.abort();

    expect(result).toEqual({
      ok: false,
      reason: "abort transport disconnected",
    });
    expect(repository.session.lastIntervention).toMatchObject({
      kind: "abort",
      status: "failed-locally",
      text: "Abort requested by operator.",
      errorMessage: "abort transport disconnected",
    });
  });
});
