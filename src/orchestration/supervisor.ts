import path from "node:path";
import {
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  SessionManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import { createEmptyPersistedState } from "../persistence/schema.js";
import { WorkbenchStore } from "../persistence/store.js";
import type { WorkbenchDetailViewMode, WorkbenchSession } from "../types/workbench.js";
import { normalizeAgentSessionEvent, createActivity } from "./activity.js";
import { WorkbenchRegistry } from "./registry.js";

interface ManagedSession {
  session: AgentSession;
  unsubscribe: () => void;
  promptPromise?: Promise<void>;
}

export interface SpawnWorkbenchSessionOptions {
  task: string;
  cwd: string;
  name?: string;
  tags?: string[];
  model?: CreateAgentSessionOptions["model"];
}

export class WorkbenchSupervisor {
  readonly registry = new WorkbenchRegistry();
  readonly store: WorkbenchStore;
  private initialized = false;
  private managedSessions = new Map<string, ManagedSession>();
  private listeners = new Set<() => void>();
  private readonly sessionDir: string;

  constructor(private readonly projectRoot: string) {
    this.store = WorkbenchStore.default(projectRoot);
    this.sessionDir = path.join(projectRoot, ".jackdaw-workbench", "pi-sessions");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const persisted = await this.store.load();
    this.registry.hydrate({
      ...createEmptyPersistedState(),
      ...persisted,
      preferences: {
        ...createEmptyPersistedState().preferences,
        ...persisted.preferences,
      },
      sessions: sanitizePersistedSessions((persisted.sessions ?? []).map((session) => ({ ...session }))),
    });
    await this.restoreManagedSessions();
    this.initialized = true;
    this.emitChange();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async openWorkbench(): Promise<void> {
    this.registry.touchOpenedAt();
    await this.persist();
  }

  async spawnSession(options: SpawnWorkbenchSessionOptions): Promise<WorkbenchSession> {
    await this.initialize();

    const { session } = await createAgentSession({
      cwd: options.cwd,
      model: options.model,
      sessionManager: SessionManager.create(options.cwd, this.sessionDir),
    });

    const workbenchSession: WorkbenchSession = {
      id: session.sessionId,
      name: options.name?.trim() || `Session ${this.registry.listSessions().length + 1}`,
      cwd: options.cwd,
      model: options.model?.id ?? session.model?.id ?? "default",
      taskLabel: options.task,
      status: "running",
      tags: options.tags ?? [],
      lastUpdateAt: Date.now(),
      summary: "Queued initial prompt",
      pinnedSummary: undefined,
      currentTool: undefined,
      sessionFile: session.sessionFile,
      latestText: undefined,
      lastError: undefined,
      recentFiles: [],
      connectionState: "live",
      reconnectNote: undefined,
    };

    this.registry.upsertSession(workbenchSession);
    this.registry.selectSession(workbenchSession.id);

    this.attachManagedSession(workbenchSession.id, session);
    await this.persist();
    this.emitChange();

    const promptPromise = session
      .prompt(options.task)
      .catch(async (error: unknown) => {
        const message = errorMessage(error);
        if (isAbortLikeError(message)) {
          this.registry.addActivity(createActivity(workbenchSession.id, "session_idle", "Prompt aborted"));
          this.registry.patchSession(workbenchSession.id, {
            currentTool: undefined,
            summary: "Prompt aborted",
          });
        } else {
          this.registry.addActivity(createActivity(workbenchSession.id, "session_failed", `Prompt failed: ${message}`));
          this.registry.patchSession(workbenchSession.id, {
            currentTool: undefined,
            lastError: message,
            summary: `Prompt failed: ${message}`,
          });
        }
        await this.persist();
        this.emitChange();
      });

    this.managedSessions.get(workbenchSession.id)!.promptPromise = promptPromise;
    return workbenchSession;
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const managed = this.managedSessions.get(sessionId);
    if (!managed) return false;
    await managed.session.abort();
    this.registry.patchSession(sessionId, {
      currentTool: undefined,
      summary: "Abort requested",
    });
    this.registry.addActivity(createActivity(sessionId, "session_idle", "Abort requested"));
    await this.persist();
    this.emitChange();
    return true;
  }

  async steerSession(sessionId: string, text: string): Promise<boolean> {
    const managed = this.managedSessions.get(sessionId);
    if (!managed) return false;
    await managed.session.steer(text);
    this.registry.addActivity(createActivity(sessionId, "message_streaming", `Steering queued: ${text}`));
    await this.persist();
    this.emitChange();
    return true;
  }

  async followUpSession(sessionId: string, text: string): Promise<boolean> {
    const managed = this.managedSessions.get(sessionId);
    if (!managed) return false;
    await managed.session.followUp(text);
    this.registry.addActivity(createActivity(sessionId, "message_streaming", `Follow-up queued: ${text}`));
    await this.persist();
    this.emitChange();
    return true;
  }

  async updateSessionMetadata(
    sessionId: string,
    patch: Pick<Partial<WorkbenchSession>, "name" | "tags" | "pinnedSummary">,
  ): Promise<boolean> {
    const existing = this.registry.listSessions().find((session) => session.id === sessionId);
    if (!existing) return false;

    this.registry.patchSession(sessionId, patch);
    await this.persist();
    this.emitChange();
    return true;
  }

  async updatePreferences(patch: { detailViewMode?: WorkbenchDetailViewMode }): Promise<void> {
    this.registry.updatePreferences(patch);
    await this.persist();
    this.emitChange();
  }

  async selectSession(sessionId: string): Promise<boolean> {
    const session = this.registry.listSessions().find((item) => item.id === sessionId);
    if (!session) return false;
    this.registry.selectSession(sessionId);
    await this.persist();
    this.emitChange();
    return true;
  }

  async selectNextSession(direction: 1 | -1): Promise<void> {
    this.registry.selectNextSession(direction);
    await this.persist();
    this.emitChange();
  }

  getProjectName(): string {
    return path.basename(this.projectRoot);
  }

  getTranscriptLines(sessionId: string): string[] {
    return this.getSessionLines(sessionId, "transcript");
  }

  getTranscriptPreview(sessionId: string, limit = 6): string[] {
    return this.getTranscriptLines(sessionId).slice(-limit);
  }

  getLogLines(sessionId: string): string[] {
    return this.getSessionLines(sessionId, "log");
  }

  private getSessionLines(sessionId: string, mode: "transcript" | "log"): string[] {
    const session = this.registry.listSessions().find((item) => item.id === sessionId);
    if (!session?.sessionFile) return [];

    try {
      const manager = SessionManager.open(session.sessionFile, this.sessionDir, session.cwd);
      const branch = manager.getBranch();
      return branch
        .filter((entry) => entry.type === "message")
        .flatMap((entry) => formatSessionLines((entry as { message?: unknown }).message, mode))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  isManaged(sessionId: string): boolean {
    return this.managedSessions.has(sessionId);
  }

  private async restoreManagedSessions(): Promise<void> {
    const sessions = this.registry.listSessions().filter((session) => !!session.sessionFile);

    for (const session of sessions) {
      if (this.managedSessions.has(session.id) || !session.sessionFile) continue;

      try {
        const { session: restored } = await createAgentSession({
          cwd: session.cwd,
          sessionManager: SessionManager.open(session.sessionFile, this.sessionDir, session.cwd),
        });

        this.registry.patchSession(session.id, {
          sessionFile: restored.sessionFile ?? session.sessionFile,
          model: restored.model?.id ?? session.model,
          connectionState: "live",
          reconnectNote: undefined,
        });
        this.attachManagedSession(session.id, restored);
      } catch {
        this.registry.patchSession(session.id, {
          connectionState: "historical",
          reconnectNote: createReconnectNote(),
        });
      }
    }

    await this.persist();
  }

  private attachManagedSession(sessionId: string, session: AgentSession): void {
    const existing = this.managedSessions.get(sessionId);
    existing?.unsubscribe();

    const unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(sessionId, event);
    });

    this.managedSessions.set(sessionId, { session, unsubscribe, promptPromise: existing?.promptPromise });
  }

  private handleSessionEvent(sessionId: string, event: AgentSessionEvent): void {
    const normalized = normalizeAgentSessionEvent(sessionId, event);
    if (normalized.patch || normalized.changedFiles) {
      const existing = this.registry.listSessions().find((session) => session.id === sessionId);
      const recentFiles = normalized.changedFiles
        ? mergeRecentFiles(existing?.recentFiles ?? [], normalized.changedFiles)
        : existing?.recentFiles;
      this.registry.patchSession(sessionId, {
        ...normalized.patch,
        ...(recentFiles ? { recentFiles } : {}),
      });
    }
    if (normalized.activity) {
      this.registry.addActivity(normalized.activity);
    }
    void this.persist();
    this.emitChange();
  }

  private async persist(): Promise<void> {
    await this.store.save({
      ...createEmptyPersistedState(),
      ...this.registry.getState(),
    });
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}

function mergeRecentFiles(existing: string[], incoming: string[]): string[] {
  const merged = [...incoming, ...existing].filter(Boolean);
  return [...new Set(merged)].slice(0, 8);
}

function sanitizePersistedSessions(sessions: WorkbenchSession[]): WorkbenchSession[] {
  return sessions.map((session) => {
    const sanitized =
      session.status === "blocked" || session.status === "failed" ? session : { ...session, lastError: undefined };
    return {
      ...sanitized,
      connectionState: sanitized.connectionState ?? (sanitized.sessionFile ? "live" : "historical"),
      reconnectNote: sanitized.reconnectNote,
    };
  });
}

function formatSessionLines(message: unknown, mode: "transcript" | "log"): string[] {
  if (!message || typeof message !== "object" || !("role" in message)) return [];

  if (message.role === "user" || message.role === "assistant") {
    const role = message.role === "assistant" ? "Assistant" : "User";
    const content = "content" in message ? message.content : [];
    if (!Array.isArray(content)) return [];
    const text = content
      .filter((item): item is { type: string; text?: string } => !!item && typeof item === "object" && "type" in item)
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text ? [`${role}: ${text}`] : [];
  }

  if (mode === "log" && message.role === "bashExecution") {
    const bashMessage = message as { command?: unknown; output?: unknown; exitCode?: unknown };
    const command = typeof bashMessage.command === "string" ? bashMessage.command : "";
    const output = typeof bashMessage.output === "string" ? bashMessage.output : "";
    const exitCode = typeof bashMessage.exitCode === "number" ? bashMessage.exitCode : undefined;
    const lines = [`Bash: ${command}${exitCode !== undefined ? ` (exit ${exitCode})` : ""}`];
    const outputLines = output
      .split(/\r?\n/)
      .map((line: string) => line.trimEnd())
      .filter(Boolean)
      .slice(0, 12)
      .map((line: string) => `  ${line}`);
    return [...lines, ...outputLines];
  }

  return [];
}

function createReconnectNote(): string {
  return "Could not reconnect after restart. Metadata remains visible locally, but steer/follow-up/abort only work for sessions reattached in-process.";
}

function isAbortLikeError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("abort") || lower.includes("cancel");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
