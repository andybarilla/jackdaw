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
  timestamps?: string[];
} = {}): { controller: SessionController; repository: MemorySessionRepository; managedSession: FakeManagedSession } {
  const session = options.session ?? createSession();
  const repository = new MemorySessionRepository(session);
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

describe("SessionController", () => {
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
