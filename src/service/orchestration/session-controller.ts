import type {
  CommandResult,
} from "../../shared/domain/commands.js";
import type {
  SessionIntervention,
  SessionInterventionKind,
  SessionRecentFile,
  WorkspaceSession,
} from "../../shared/domain/session.js";
import {
  extractRecentFilesFromHistory,
  findObservedHistoryTimestamp,
  isMeaningfulObservedActivity,
  normalizeAgentSessionEvent,
  type NormalizedSessionActivity,
  type NormalizedSessionPatch,
} from "./event-normalizer.js";
import type { ManagedPiSession } from "./session-adapter.js";

export interface SessionControllerRepository {
  getWorkspaceSession(workspaceId: string, sessionId: string): Promise<WorkspaceSession | undefined>;
  upsertSession(session: WorkspaceSession): Promise<void>;
}

export interface SessionControllerOptions {
  session: WorkspaceSession;
  managedSession: ManagedPiSession;
  repository: SessionControllerRepository;
  now?: () => Date;
  recentFileLimit?: number;
  onRuntimeActivity?: (session: WorkspaceSession, activity: NormalizedSessionActivity) => void;
}

export class SessionController {
  private session: WorkspaceSession;
  private managedSession: ManagedPiSession;
  private unsubscribe: (() => void) | undefined;
  private readonly repository: SessionControllerRepository;
  private readonly now: () => Date;
  private readonly recentFileLimit: number;
  private readonly onRuntimeActivity: ((session: WorkspaceSession, activity: NormalizedSessionActivity) => void) | undefined;
  private readonly activities: NormalizedSessionActivity[] = [];
  private promptPromise: Promise<void> | undefined;

  constructor(options: SessionControllerOptions) {
    this.session = structuredClone(options.session);
    this.managedSession = options.managedSession;
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.recentFileLimit = options.recentFileLimit ?? 10;
    this.onRuntimeActivity = options.onRuntimeActivity;
    this.attachManagedSession(options.managedSession);
  }

  get workspaceId(): string {
    return this.session.workspaceId;
  }

  get sessionId(): string {
    return this.session.id;
  }

  get currentSession(): WorkspaceSession {
    return structuredClone(this.session);
  }

  get isLive(): boolean {
    return this.session.connectionState === "live";
  }

  beginInitialPrompt(task: string): void {
    this.promptPromise = this.managedSession.prompt(task).catch(async (error: unknown): Promise<void> => {
      const message = errorMessage(error);
      const occurredAt = this.nowIso();
      const summary = isAbortLikeError(message) ? "Prompt aborted" : `Prompt failed: ${message}`;
      await this.updateSession({
        status: isAbortLikeError(message) ? "idle" : "failed",
        liveSummary: summary,
        latestMeaningfulUpdate: summary,
        currentActivity: summary,
        currentTool: undefined,
        updatedAt: occurredAt,
      });
    });
  }

  async waitForInitialPrompt(): Promise<void> {
    await this.promptPromise;
  }

  async handleSessionEvent(event: unknown): Promise<void> {
    const occurredAt = this.nowIso();
    const normalized = normalizeAgentSessionEvent({
      workspaceId: this.session.workspaceId,
      sessionId: this.session.id,
      occurredAt,
    }, event);

    if (normalized.activity !== undefined) {
      this.activities.push(normalized.activity);
      this.activities.splice(0, Math.max(0, this.activities.length - 50));
    }

    if (normalized.patch === undefined && normalized.recentFiles === undefined && normalized.activity === undefined) {
      return;
    }

    const patch = preserveStableStatus(normalized.patch ?? {}, this.session.status);
    const recentFiles = normalized.recentFiles === undefined
      ? this.session.recentFiles
      : mergeRecentFiles(this.session.recentFiles, normalized.recentFiles, this.recentFileLimit);
    const observedIntervention = normalized.activity === undefined
      ? this.session.lastIntervention
      : this.observePendingIntervention(this.session.lastIntervention, normalized.activity);

    await this.applyPatch({
      ...patch,
      lastIntervention: observedIntervention,
      recentFiles,
      updatedAt: occurredAt,
    });

    if (normalized.activity !== undefined) {
      this.onRuntimeActivity?.(this.currentSession, normalized.activity);
    }
  }

  async steer(text: string): Promise<CommandResult> {
    return await this.submitIntervention("steer", text, async (): Promise<void> => {
      await this.managedSession.steer(text);
    });
  }

  async followUp(text: string): Promise<CommandResult> {
    return await this.submitIntervention("follow-up", text, async (): Promise<void> => {
      await this.managedSession.followUp(text);
    });
  }

  async abort(): Promise<CommandResult> {
    return await this.submitIntervention("abort", "Abort requested by operator.", async (): Promise<void> => {
      await this.managedSession.abort();
    });
  }

  async pinSummary(summary: string | undefined): Promise<CommandResult> {
    const acceptedAt = this.nowIso();
    await this.updateSession({
      pinnedSummary: summary,
      updatedAt: acceptedAt,
    });

    return {
      ok: true,
      acceptedAt,
    };
  }

  async reconcilePendingInterventionFromHistory(): Promise<void> {
    const historyEntries = this.managedSession.getHistoryEntries?.() ?? [];
    const session = await this.refreshSession();
    const lastIntervention = session.lastIntervention;
    const historyRecentFiles = extractRecentFilesFromHistory(historyEntries, this.recentFileLimit);
    const recentFiles = historyRecentFiles.length === 0
      ? session.recentFiles
      : mergeRecentFiles(session.recentFiles, historyRecentFiles, this.recentFileLimit);

    if (lastIntervention?.status !== "pending-observation") {
      if (historyRecentFiles.length > 0) {
        await this.applyPatch({
          recentFiles,
          updatedAt: this.nowIso(),
        });
      }
      return;
    }

    const observedAt = findObservedHistoryTimestamp(lastIntervention.requestedAt, historyEntries);
    if (observedAt === undefined) {
      if (historyRecentFiles.length > 0) {
        await this.applyPatch({
          recentFiles,
          updatedAt: this.nowIso(),
        });
      }
      return;
    }

    await this.applyPatch({
      lastIntervention: markInterventionObserved(lastIntervention, observedAt),
      recentFiles,
      updatedAt: observedAt,
    });
  }

  async markHistorical(reconnectNote: string): Promise<void> {
    await this.updateSession({
      connectionState: "historical",
      reconnectNote,
      updatedAt: this.nowIso(),
    });
  }

  async markLive(managedSession: ManagedPiSession): Promise<void> {
    this.attachManagedSession(managedSession);
    await this.updateSession({
      connectionState: "live",
      reconnectNote: undefined,
      sessionFile: managedSession.sessionFile ?? this.session.sessionFile,
      runtime: {
        ...this.session.runtime,
        model: managedSession.modelId ?? this.session.runtime.model,
        runtime: "pi",
      },
      updatedAt: this.nowIso(),
    });
    await this.reconcilePendingInterventionFromHistory();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    void this.managedSession.dispose?.();
  }

  private attachManagedSession(managedSession: ManagedPiSession): void {
    this.unsubscribe?.();
    this.managedSession = managedSession;
    this.unsubscribe = managedSession.subscribe(async (event: unknown): Promise<void> => {
      await this.handleSessionEvent(event);
    });
  }

  private async submitIntervention(
    kind: SessionInterventionKind,
    text: string,
    submit: () => Promise<void>,
  ): Promise<CommandResult> {
    if (this.session.connectionState !== "live") {
      const requestedAt = this.nowIso();
      await this.updateSession({
        lastIntervention: createIntervention(kind, text, "failed-locally", requestedAt, "Session is historical and cannot be controlled."),
        updatedAt: requestedAt,
      });
      return {
        ok: false,
        reason: "Session is historical and cannot be controlled.",
      };
    }

    const requestedAt = this.nowIso();
    await this.updateSession({
      lastIntervention: createIntervention(kind, text, "accepted-locally", requestedAt),
      currentActivity: interventionAcceptedSummary(kind),
      updatedAt: requestedAt,
    });

    try {
      await submit();
      const pendingIntervention = createIntervention(kind, text, "pending-observation", requestedAt);
      const observedAt = this.findObservedActivityTimestamp(requestedAt);
      await this.updateSession({
        lastIntervention: observedAt === undefined
          ? pendingIntervention
          : markInterventionObserved(pendingIntervention, observedAt),
        status: kind === "abort" ? "idle" : "running",
        currentActivity: interventionPendingSummary(kind),
        updatedAt: observedAt ?? requestedAt,
      });

      return {
        ok: true,
        acceptedAt: requestedAt,
      };
    } catch (error: unknown) {
      const message = errorMessage(error);
      await this.updateSession({
        lastIntervention: createIntervention(kind, text, "failed-locally", requestedAt, message),
        status: "failed",
        liveSummary: `${interventionLabel(kind)} failed locally: ${message}`,
        latestMeaningfulUpdate: `${interventionLabel(kind)} failed locally: ${message}`,
        currentActivity: `${interventionLabel(kind)} failed locally: ${message}`,
        updatedAt: requestedAt,
      });

      return {
        ok: false,
        reason: message,
      };
    }
  }

  private observePendingIntervention(
    intervention: SessionIntervention | undefined,
    activity: NormalizedSessionActivity,
  ): SessionIntervention | undefined {
    if (intervention?.status !== "pending-observation") {
      return intervention;
    }
    if (!isMeaningfulObservedActivity(activity)) {
      return intervention;
    }
    if (Date.parse(activity.occurredAt) <= Date.parse(intervention.requestedAt)) {
      return intervention;
    }

    return markInterventionObserved(intervention, activity.occurredAt);
  }

  private findObservedActivityTimestamp(requestedAt: string): string | undefined {
    const requestedAtMs = Date.parse(requestedAt);
    if (Number.isNaN(requestedAtMs)) {
      return undefined;
    }

    const observedActivity = this.activities.find((activity) => {
      const occurredAtMs = Date.parse(activity.occurredAt);
      return isMeaningfulObservedActivity(activity)
        && !Number.isNaN(occurredAtMs)
        && occurredAtMs > requestedAtMs;
    });

    return observedActivity?.occurredAt;
  }

  private async refreshSession(): Promise<WorkspaceSession> {
    const persistedSession = await this.repository.getWorkspaceSession(this.session.workspaceId, this.session.id);
    if (persistedSession !== undefined) {
      this.session = structuredClone(persistedSession);
    }

    return this.currentSession;
  }

  private async applyPatch(
    patch: NormalizedSessionPatch & Partial<WorkspaceSession>,
  ): Promise<void> {
    const nextSession: WorkspaceSession = {
      ...this.session,
      ...patch,
    };
    this.session = structuredClone(nextSession);
    await this.repository.upsertSession(nextSession);
  }

  private async updateSession(patch: Partial<WorkspaceSession>): Promise<void> {
    await this.applyPatch(patch);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

function createIntervention(
  kind: SessionInterventionKind,
  text: string,
  status: SessionIntervention["status"],
  requestedAt: string,
  errorMessage?: string,
): SessionIntervention {
  return {
    kind,
    status,
    text,
    requestedAt,
    errorMessage,
  };
}

function markInterventionObserved(intervention: SessionIntervention, observedAt: string): SessionIntervention {
  return {
    ...intervention,
    status: "observed",
    observedAt,
    errorMessage: undefined,
  };
}

function preserveStableStatus(
  patch: NormalizedSessionPatch,
  currentStatus: WorkspaceSession["status"],
): NormalizedSessionPatch {
  if (patch.status !== "idle") {
    return patch;
  }
  if (currentStatus === "awaiting-input" || currentStatus === "blocked" || currentStatus === "failed" || currentStatus === "done") {
    return {
      ...patch,
      status: currentStatus,
    };
  }

  return patch;
}

function mergeRecentFiles(
  existingFiles: readonly SessionRecentFile[],
  incomingFiles: readonly SessionRecentFile[],
  limit: number,
): SessionRecentFile[] {
  const mergedFiles = [...incomingFiles, ...existingFiles].filter((file) => file.path.trim().length > 0);
  const seenPaths = new Set<string>();
  const dedupedFiles: SessionRecentFile[] = [];

  for (const file of mergedFiles) {
    if (seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    dedupedFiles.push({ ...file });
  }

  return dedupedFiles.slice(0, limit);
}

function interventionAcceptedSummary(kind: SessionInterventionKind): string {
  return `${interventionLabel(kind)} accepted locally`;
}

function interventionPendingSummary(kind: SessionInterventionKind): string {
  return `${interventionLabel(kind)} pending runtime observation`;
}

function interventionLabel(kind: SessionInterventionKind): string {
  switch (kind) {
    case "steer":
      return "Steer";
    case "follow-up":
      return "Follow-up";
    case "abort":
      return "Abort";
  }
}

function isAbortLikeError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("abort") || lower.includes("cancel");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
