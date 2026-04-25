import { spawn } from "node:child_process";
import path from "node:path";
import type { AttentionEvent } from "../../shared/domain/attention.js";
import type {
  AbortSessionCommand,
  CommandResult,
  FollowUpSessionCommand,
  OpenPathCommand,
  PinSummaryCommand,
  ShellFallbackCommand,
  SpawnSessionCommand,
  SteerSessionCommand,
} from "../../shared/domain/commands.js";
import type {
  SessionIntervention,
  SessionInterventionKind,
  SessionRecentFile,
  WorkspaceSession,
} from "../../shared/domain/session.js";
import type { WorkspaceRepoRoot, WorkspaceWorktree } from "../../shared/domain/workspace.js";
import { stripTerminalControlSequences } from "../../utils/plain-text.js";
import type { WorkspaceDetailRecord, WorkspaceRegistry } from "../workspace/workspace-registry.js";
import {
  canonicalizeWorkspacePath,
  isWorkspacePathInside,
  normalizeWorkspacePathForComparison,
  workspacePathsMatch,
  WorkspacePathValidationError,
} from "../workspace/workspace-paths.js";
import { AttentionEngine, createSessionKey } from "./attention-engine.js";
import type { NormalizedSessionActivity } from "./event-normalizer.js";
import type { ManagedPiSession, PiSessionAdapter } from "./session-adapter.js";
import { SessionController, type SessionControllerRepository } from "./session-controller.js";

export interface RuntimeSessionMutation {
  session: WorkspaceSession;
  occurredAt: string;
}

export type RuntimeSessionMutationListener = (mutation: RuntimeSessionMutation) => void;

export interface RuntimeManagerOptions {
  registry: WorkspaceRegistry;
  adapter: PiSessionAdapter;
  attentionEngine?: AttentionEngine;
  shellExecutor?: ShellExecutor;
  pathOpener?: WorkspacePathOpener;
  now?: () => Date;
  onSessionMutation?: RuntimeSessionMutationListener;
}

export interface SpawnSessionResult {
  result: CommandResult;
  session?: WorkspaceSession;
}

export interface ReconnectSessionResult {
  workspaceId: string;
  sessionId: string;
  connectionState: WorkspaceSession["connectionState"];
}

export interface ShellCommandExecutionResult {
  command: string;
  cwd: string;
  exitCode: number | undefined;
  output: string;
  timedOut: boolean;
}

export interface ShellExecutorOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export type ShellExecutor = (
  command: string,
  cwd: string,
  options?: ShellExecutorOptions,
) => Promise<ShellCommandExecutionResult>;

export interface WorkspacePathOpenOptions {
  revealInFileManager?: boolean;
  openInTerminal?: boolean;
}

export interface WorkspacePathOpener {
  openPath(targetPath: string, options: WorkspacePathOpenOptions): Promise<void>;
  openExternalTerminal?(cwd: string): Promise<void>;
}

export class RuntimeManagerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeManagerValidationError";
  }
}

export class RuntimeManager {
  private readonly controllers = new Map<string, SessionController>();
  private readonly registry: WorkspaceRegistry;
  private readonly adapter: PiSessionAdapter;
  private readonly attentionEngine: AttentionEngine;
  private readonly shellExecutor: ShellExecutor;
  private readonly pathOpener: WorkspacePathOpener;
  private readonly now: () => Date;
  private readonly recentAttentionByWorkspace = new Map<string, AttentionEvent[]>();
  private readonly onSessionMutation: RuntimeSessionMutationListener | undefined;

  constructor(options: RuntimeManagerOptions) {
    this.registry = options.registry;
    this.adapter = options.adapter;
    this.attentionEngine = options.attentionEngine ?? new AttentionEngine();
    this.shellExecutor = options.shellExecutor ?? createBoundedShellExecutor();
    this.pathOpener = options.pathOpener ?? createDefaultPathOpener();
    this.now = options.now ?? (() => new Date());
    this.onSessionMutation = options.onSessionMutation;
  }

  async spawnSession(input: SpawnSessionCommand): Promise<SpawnSessionResult> {
    const detail = this.registry.getWorkspaceDetail(input.workspaceId);
    if (detail === undefined) {
      return {
        result: {
          ok: false,
          reason: `Workspace not found: ${input.workspaceId}`,
        },
      };
    }

    const acceptedAt = this.nowIso();
    let managedSession: ManagedPiSession | undefined;
    let session: WorkspaceSession | undefined;
    let sessionPersistenceAttempted = false;
    let controllerRegistered = false;

    try {
      const canonicalInput = await canonicalizeSpawnSessionInput(input);
      const location = resolveSessionLocation(detail, canonicalInput);
      managedSession = await this.adapter.spawnSession({
        workspaceId: input.workspaceId,
        cwd: canonicalInput.cwd,
        task: canonicalInput.task,
        modelId: canonicalInput.model,
      });
      session = createWorkspaceSessionFromManagedSession({
        command: canonicalInput,
        detail,
        location,
        managedSession,
        acceptedAt,
      });

      await this.disposeController(createSessionKey(session.workspaceId, session.id));
      sessionPersistenceAttempted = true;
      await this.registry.upsertSession(session, acceptedAt);
      this.attentionEngine.recordSession(session);
      const controller = await this.replaceController(session, managedSession);
      controllerRegistered = true;
      controller.beginInitialPrompt(canonicalInput.task);
      const promptedSessionId = session.id;
      const promptedWorkspaceId = session.workspaceId;
      void controller.waitForInitialPrompt().catch((error: unknown): void => {
        console.error(
          `Initial prompt failed for session ${promptedWorkspaceId}/${promptedSessionId}: ${errorMessage(error)}`,
        );
      });

      return {
        result: {
          ok: true,
          acceptedAt,
        },
        session: controller.currentSession,
      };
    } catch (error: unknown) {
      const reason = errorMessage(error);
      let rejectedReason = reason;
      let failedSession: WorkspaceSession | undefined;
      try {
        failedSession = await this.cleanupFailedSpawn(managedSession, session, sessionPersistenceAttempted, controllerRegistered, reason);
      } catch (cleanupError: unknown) {
        rejectedReason = `${reason}; cleanup failed: ${errorMessage(cleanupError)}`;
      }

      return {
        result: {
          ok: false,
          reason: rejectedReason,
        },
        session: failedSession,
      };
    }
  }

  async steerSession(input: SteerSessionCommand): Promise<CommandResult> {
    const lookup = this.findSession(input.sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${input.sessionId}`);
    }

    const controller = this.controllers.get(createSessionKey(lookup.session.workspaceId, lookup.session.id));
    if (controller === undefined) {
      return await this.recordUnmanagedInterventionFailure(lookup.session, "steer", input.text);
    }

    return await controller.steer(input.text);
  }

  async followUpSession(input: FollowUpSessionCommand): Promise<CommandResult> {
    const lookup = this.findSession(input.sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${input.sessionId}`);
    }

    const controller = this.controllers.get(createSessionKey(lookup.session.workspaceId, lookup.session.id));
    if (controller === undefined) {
      return await this.recordUnmanagedInterventionFailure(lookup.session, "follow-up", input.text);
    }

    return await controller.followUp(input.text);
  }

  async abortSession(input: AbortSessionCommand): Promise<CommandResult> {
    const lookup = this.findSession(input.sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${input.sessionId}`);
    }

    const controller = this.controllers.get(createSessionKey(lookup.session.workspaceId, lookup.session.id));
    if (controller === undefined) {
      return await this.recordUnmanagedInterventionFailure(lookup.session, "abort", "Abort requested by operator.");
    }

    return await controller.abort();
  }

  async pinSessionSummary(input: PinSummaryCommand): Promise<CommandResult> {
    const lookup = this.findSession(input.sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${input.sessionId}`);
    }

    const controller = this.controllers.get(createSessionKey(lookup.session.workspaceId, lookup.session.id));
    if (controller !== undefined) {
      return await controller.pinSummary(input.summary);
    }

    const acceptedAt = this.nowIso();
    try {
      await this.registry.upsertSession({
        ...lookup.session,
        pinnedSummary: input.summary,
        updatedAt: acceptedAt,
      });
    } catch (error: unknown) {
      return rejectedPersistenceCommand(error);
    }

    return {
      ok: true,
      acceptedAt,
    };
  }

  async openSessionPath(sessionId: string, input: OpenPathCommand): Promise<CommandResult> {
    const lookup = this.findSession(sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${sessionId}`);
    }
    if (lookup.session.workspaceId !== input.workspaceId) {
      return rejectedCommand(`workspaceId must match the session workspace: ${lookup.session.workspaceId}`);
    }

    const acceptedAt = this.nowIso();
    const resolvedPath = await this.resolveSessionPath(lookup.session, input.path);
    if (!resolvedPath.ok) {
      return resolvedPath.result;
    }

    try {
      if (input.revealInFileManager === true) {
        await this.pathOpener.openPath(resolvedPath.path, { revealInFileManager: true });
      }
      if (input.openInTerminal === true) {
        await this.pathOpener.openExternalTerminal?.(lookup.session.cwd);
      }
    } catch (error: unknown) {
      return rejectedCommand(errorMessage(error));
    }

    try {
      const updatedSession = await this.updateSessionFresh(sessionId, (currentSession: WorkspaceSession): WorkspaceSession => ({
        ...currentSession,
        recentFiles: mergeRecentFiles(currentSession.recentFiles, [{
          path: resolvedPath.path,
          operation: "unknown",
          timestamp: acceptedAt,
        }], 10),
        updatedAt: acceptedAt,
      }));
      if (updatedSession === undefined) {
        return rejectedCommand(`Session not found: ${sessionId}`);
      }
    } catch (error: unknown) {
      return rejectedPersistenceCommand(error);
    }

    return {
      ok: true,
      acceptedAt,
    };
  }

  async runShellFallback(sessionId: string, command: string): Promise<CommandResult>;
  async runShellFallback(input: ShellFallbackCommand): Promise<CommandResult>;
  async runShellFallback(sessionOrCommand: string | ShellFallbackCommand, maybeCommand?: string): Promise<CommandResult> {
    const sessionId = typeof sessionOrCommand === "string" ? sessionOrCommand : sessionOrCommand.sessionId;
    const command = typeof sessionOrCommand === "string" ? maybeCommand : sessionOrCommand.command;
    if (command === undefined || command.trim().length === 0) {
      return rejectedCommand("Shell command must not be empty.");
    }

    const lookup = this.findSession(sessionId);
    if (lookup === undefined) {
      return rejectedCommand(`Session not found: ${sessionId}`);
    }

    const startedAt = this.nowIso();
    let shellSession: WorkspaceSession;
    try {
      const updatedSession = await this.updateSessionFresh(sessionId, (currentSession: WorkspaceSession): WorkspaceSession => ({
        ...currentSession,
        status: "running",
        currentTool: "shell fallback",
        currentActivity: `Shell fallback running: ${command}`,
        liveSummary: `Shell fallback running: ${command}`,
        updatedAt: startedAt,
      }));
      if (updatedSession === undefined) {
        return rejectedCommand(`Session not found: ${sessionId}`);
      }
      shellSession = updatedSession;
    } catch (error: unknown) {
      return rejectedPersistenceCommand(error);
    }

    try {
      const result = await this.shellExecutor(command, shellSession.cwd, {
        timeoutMs: 120_000,
        maxOutputBytes: 32_000,
      });
      const completedAt = this.nowIso();
      const summary = summarizeShellResult(result.command, result.exitCode, result.timedOut);
      const status: WorkspaceSession["status"] = result.exitCode === 0 && !result.timedOut ? "idle" : "blocked";
      try {
        const updatedSession = await this.updateSessionFresh(sessionId, (currentSession: WorkspaceSession): WorkspaceSession => ({
          ...currentSession,
          status,
          currentTool: undefined,
          currentActivity: summary,
          liveSummary: summary,
          latestMeaningfulUpdate: previewShellOutput(result.output) || summary,
          updatedAt: completedAt,
        }));
        if (updatedSession === undefined) {
          return rejectedCommand(`Session not found: ${sessionId}`);
        }
      } catch (error: unknown) {
        return rejectedPersistenceCommand(error);
      }

      return {
        ok: true,
        acceptedAt: startedAt,
      };
    } catch (error: unknown) {
      const failedAt = this.nowIso();
      const message = errorMessage(error);
      try {
        const updatedSession = await this.updateSessionFresh(sessionId, (currentSession: WorkspaceSession): WorkspaceSession => ({
          ...currentSession,
          status: "failed",
          currentTool: undefined,
          currentActivity: `Shell fallback failed: ${message}`,
          liveSummary: `Shell fallback failed: ${command}`,
          latestMeaningfulUpdate: message,
          updatedAt: failedAt,
        }));
        if (updatedSession === undefined) {
          return rejectedCommand(`Session not found: ${sessionId}`);
        }
      } catch (persistenceError: unknown) {
        return rejectedPersistenceCommand(persistenceError);
      }

      return rejectedCommand(message);
    }
  }

  listWorkspaceSessions(workspaceId: string): WorkspaceSession[] {
    const detail = this.registry.getWorkspaceDetail(workspaceId);
    if (detail === undefined) {
      return [];
    }

    return this.attentionEngine.rankWorkspaceSessions(detail.workspace, detail.sessions);
  }

  listActiveSessionKeys(): string[] {
    return [...this.controllers.keys()].sort();
  }

  listRecentAttention(workspaceId: string): AttentionEvent[] {
    return structuredClone(this.recentAttentionByWorkspace.get(workspaceId) ?? []);
  }

  getSessionWorkspaceId(sessionId: string): string | undefined {
    return this.findSession(sessionId)?.session.workspaceId;
  }

  async reconnectPersistedSessions(workspaceId?: string): Promise<ReconnectSessionResult[]> {
    const workspaceIds = workspaceId === undefined
      ? this.registry.listWorkspaces().map((workspace) => workspace.id)
      : [workspaceId];
    const results: ReconnectSessionResult[] = [];

    for (const candidateWorkspaceId of workspaceIds) {
      const detail = this.registry.getWorkspaceDetail(candidateWorkspaceId);
      if (detail === undefined) {
        continue;
      }

      for (const session of detail.sessions) {
        results.push(await this.reconnectSession(session));
      }
    }

    return results;
  }

  async reconnectSession(session: WorkspaceSession): Promise<ReconnectSessionResult> {
    const key = createSessionKey(session.workspaceId, session.id);
    const existingController = this.controllers.get(key);
    if (existingController !== undefined) {
      return {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        connectionState: "live",
      };
    }

    if (session.sessionFile === undefined) {
      await this.markSessionHistorical(session, createReconnectNote("No pi session file was recorded for this session."));
      return {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        connectionState: "historical",
      };
    }

    let managedSession: ManagedPiSession | undefined;
    let liveSession: WorkspaceSession | undefined;
    let controllerRegistered = false;

    try {
      managedSession = await this.adapter.reconnectSession({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        cwd: session.cwd,
        sessionFile: session.sessionFile,
        modelId: session.runtime.model,
      });
      liveSession = {
        ...session,
        connectionState: "live",
        reconnectNote: undefined,
        sessionFile: managedSession.sessionFile ?? session.sessionFile,
        runtime: {
          ...session.runtime,
          model: managedSession.modelId ?? session.runtime.model,
          runtime: "pi",
        },
        updatedAt: this.nowIso(),
      };

      await this.registry.upsertSession(liveSession);
      const controller = await this.replaceController(liveSession, managedSession);
      controllerRegistered = true;
      try {
        await controller.reconcilePendingInterventionFromHistory();
      } catch (error: unknown) {
        console.error(
          `Reconnect reconciliation failed for session ${session.workspaceId}/${session.id}: ${errorMessage(error)}`,
        );
      }

      return {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        connectionState: "live",
      };
    } catch (error: unknown) {
      const reason = errorMessage(error);
      if (controllerRegistered) {
        await this.disposeController(key);
      } else if (managedSession !== undefined) {
        await disposeManagedSession(managedSession);
      }
      this.controllers.delete(key);
      await this.markSessionHistorical(liveSession ?? session, createReconnectNote(reason));
      return {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        connectionState: "historical",
      };
    }
  }

  private createController(session: WorkspaceSession, managedSession: ManagedPiSession): SessionController {
    return new SessionController({
      session,
      managedSession,
      repository: new RegistrySessionControllerRepository(this.registry),
      now: this.now,
      onRuntimeActivity: (updatedSession: WorkspaceSession, activity: NormalizedSessionActivity): void => {
        this.appendRuntimeAttention(updatedSession, activity);
      },
      onSessionMutation: (updatedSession: WorkspaceSession, occurredAt: string): void => {
        this.publishSessionMutation(updatedSession, occurredAt);
      },
    });
  }

  private async replaceController(session: WorkspaceSession, managedSession: ManagedPiSession): Promise<SessionController> {
    const key = createSessionKey(session.workspaceId, session.id);
    await this.disposeController(key);
    const controller = this.createController(session, managedSession);
    this.controllers.set(key, controller);
    return controller;
  }

  private async disposeController(key: string): Promise<void> {
    const existingController = this.controllers.get(key);
    if (existingController === undefined) {
      return;
    }

    this.controllers.delete(key);
    await existingController.dispose();
  }

  private appendRuntimeAttention(session: WorkspaceSession, activity: NormalizedSessionActivity): void {
    const event = this.attentionEngine.createRuntimeAttentionEvent(session, activity);
    const currentEvents = this.recentAttentionByWorkspace.get(session.workspaceId) ?? [];
    this.recentAttentionByWorkspace.set(session.workspaceId, [event, ...currentEvents].slice(0, 50));
  }

  private publishSessionMutation(session: WorkspaceSession, occurredAt: string): void {
    this.onSessionMutation?.({
      session: structuredClone(session),
      occurredAt,
    });
  }

  private async updateSessionFresh(
    sessionId: string,
    update: (session: WorkspaceSession) => WorkspaceSession | Promise<WorkspaceSession>,
  ): Promise<WorkspaceSession | undefined> {
    const lookup = this.findSession(sessionId);
    if (lookup === undefined) {
      return undefined;
    }

    const detail = await this.registry.updateSession(lookup.workspaceId, sessionId, update);
    return detail?.sessions.find((session) => session.id === sessionId);
  }

  private async markSessionHistorical(session: WorkspaceSession, reconnectNote: string): Promise<void> {
    const updatedAt = this.nowIso();
    const historicalSession: WorkspaceSession = {
      ...session,
      connectionState: "historical",
      reconnectNote,
      updatedAt,
    };
    await this.registry.upsertSession(historicalSession);
  }

  private async markSpawnedSessionHistorical(session: WorkspaceSession, reason: string): Promise<WorkspaceSession> {
    const summary = `Session startup failed: ${reason}`;
    const updatedAt = this.nowIso();
    const failedSession: WorkspaceSession = {
      ...session,
      status: "failed",
      connectionState: "historical",
      reconnectNote: `Session startup failed after pi session was created. Metadata remains visible locally, but no controller is attached. Reason: ${reason}`,
      currentTool: undefined,
      currentActivity: summary,
      liveSummary: summary,
      latestMeaningfulUpdate: summary,
      updatedAt,
    };
    await this.registry.upsertSession(failedSession);
    this.publishSessionMutation(failedSession, updatedAt);
    return failedSession;
  }

  private async cleanupFailedSpawn(
    managedSession: ManagedPiSession | undefined,
    session: WorkspaceSession | undefined,
    sessionPersistenceAttempted: boolean,
    controllerRegistered: boolean,
    reason: string,
  ): Promise<WorkspaceSession | undefined> {
    if (controllerRegistered && session !== undefined) {
      await this.disposeController(createSessionKey(session.workspaceId, session.id));
    } else if (managedSession !== undefined) {
      await disposeManagedSession(managedSession);
    }

    if (sessionPersistenceAttempted && session !== undefined) {
      return await this.markSpawnedSessionHistorical(session, reason);
    }

    return undefined;
  }

  private async recordUnmanagedInterventionFailure(
    session: WorkspaceSession,
    kind: SessionInterventionKind,
    text: string,
  ): Promise<CommandResult> {
    const requestedAt = this.nowIso();
    const reason = "Session is historical and cannot be controlled.";
    try {
      await this.registry.upsertSession({
        ...session,
        lastIntervention: {
          kind,
          status: "failed-locally",
          text,
          requestedAt,
          errorMessage: reason,
        } satisfies SessionIntervention,
        updatedAt: requestedAt,
      });
    } catch (error: unknown) {
      return rejectedPersistenceCommand(error);
    }

    return rejectedCommand(reason);
  }

  private async resolveSessionPath(session: WorkspaceSession, requestedPath: string): Promise<ResolvedSessionPath> {
    try {
      const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.join(session.cwd, requestedPath);
      const canonicalPath = await canonicalizeWorkspacePath(absolutePath, "open path");
      if (!isWorkspacePathInside(session.repoRoot, canonicalPath)) {
        return {
          ok: false,
          result: {
            ok: false,
            reason: `open path must stay inside session repo root ${session.repoRoot}: ${requestedPath}`,
          },
        };
      }

      return {
        ok: true,
        path: canonicalPath,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: error instanceof WorkspacePathValidationError ? error.message : errorMessage(error),
        },
      };
    }
  }

  private findSession(sessionId: string): { workspaceId: string; session: WorkspaceSession } | undefined {
    for (const workspace of this.registry.listWorkspaces()) {
      const detail = this.registry.getWorkspaceDetail(workspace.id);
      const session = detail?.sessions.find((candidate) => candidate.id === sessionId);
      if (session !== undefined) {
        return {
          workspaceId: workspace.id,
          session,
        };
      }
    }

    return undefined;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

class RegistrySessionControllerRepository implements SessionControllerRepository {
  constructor(private readonly registry: WorkspaceRegistry) {}

  async getWorkspaceSession(workspaceId: string, sessionId: string): Promise<WorkspaceSession | undefined> {
    return this.registry.getWorkspaceDetail(workspaceId)?.sessions.find((session) => session.id === sessionId);
  }

  async upsertSession(session: WorkspaceSession): Promise<void> {
    await this.registry.upsertSession(session);
  }
}

type ResolvedSessionPath =
  | { ok: true; path: string }
  | { ok: false; result: Extract<CommandResult, { ok: false }> };

interface CanonicalSpawnSessionCommand extends SpawnSessionCommand {
  cwd: string;
  repoRoot?: string;
  worktree?: string;
}

interface ResolvedSessionLocation {
  repoRoot: WorkspaceRepoRoot;
  worktree?: WorkspaceWorktree;
}

interface CreateWorkspaceSessionInput {
  command: CanonicalSpawnSessionCommand;
  detail: WorkspaceDetailRecord;
  location: ResolvedSessionLocation;
  managedSession: ManagedPiSession;
  acceptedAt: string;
}

async function canonicalizeSpawnSessionInput(input: SpawnSessionCommand): Promise<CanonicalSpawnSessionCommand> {
  return {
    ...input,
    cwd: await canonicalizeWorkspacePath(input.cwd, "cwd"),
    repoRoot: input.repoRoot === undefined ? undefined : await canonicalizeWorkspacePath(input.repoRoot, "repoRoot"),
    worktree: input.worktree === undefined ? undefined : await canonicalizeWorkspacePath(input.worktree, "worktree"),
  };
}

function resolveSessionLocation(
  detail: WorkspaceDetailRecord,
  input: CanonicalSpawnSessionCommand,
): ResolvedSessionLocation {
  const worktree = input.worktree === undefined
    ? undefined
    : detail.workspace.worktrees.find((candidate) => workspacePathsMatch(candidate.path, input.worktree!));
  if (input.worktree !== undefined && worktree === undefined) {
    throw new RuntimeManagerValidationError(`worktree must reference a registered worktree in workspace ${detail.workspace.id}: ${input.worktree}`);
  }

  const repoRoot = resolveRepoRoot(detail, input, worktree);
  const cwdBasePath = worktree?.path ?? repoRoot.path;
  if (!isWorkspacePathInside(cwdBasePath, input.cwd)) {
    throw new RuntimeManagerValidationError(`cwd must stay within ${cwdBasePath}: ${input.cwd}`);
  }
  if (worktree !== undefined && worktree.repoRootId !== repoRoot.id) {
    throw new RuntimeManagerValidationError(`worktree ${worktree.path} must belong to repo root ${repoRoot.path}`);
  }

  const workspaceArtifactIds = new Set(detail.workspace.artifactIds);
  for (const artifactId of input.linkedArtifactIds ?? []) {
    if (!workspaceArtifactIds.has(artifactId)) {
      throw new RuntimeManagerValidationError(`linkedArtifactIds must reference existing workspace artifacts: ${artifactId}`);
    }
  }

  return { repoRoot, worktree };
}

function resolveRepoRoot(
  detail: WorkspaceDetailRecord,
  input: CanonicalSpawnSessionCommand,
  worktree: WorkspaceWorktree | undefined,
): WorkspaceRepoRoot {
  if (input.repoRoot !== undefined) {
    const repoRoot = detail.workspace.repoRoots.find((candidate) => workspacePathsMatch(candidate.path, input.repoRoot!));
    if (repoRoot === undefined) {
      throw new RuntimeManagerValidationError(`repoRoot must reference a registered repo root in workspace ${detail.workspace.id}: ${input.repoRoot}`);
    }
    return repoRoot;
  }

  if (worktree !== undefined) {
    const repoRoot = detail.workspace.repoRoots.find((candidate) => candidate.id === worktree.repoRootId);
    if (repoRoot !== undefined) {
      return repoRoot;
    }
  }

  const containingRepoRoots = detail.workspace.repoRoots.filter((candidate) => isWorkspacePathInside(candidate.path, input.cwd));
  containingRepoRoots.sort((left, right) =>
    normalizeWorkspacePathForComparison(right.path).length - normalizeWorkspacePathForComparison(left.path).length,
  );
  const repoRoot = containingRepoRoots[0];
  if (repoRoot === undefined) {
    throw new RuntimeManagerValidationError(`repoRoot must reference a registered repo root in workspace ${detail.workspace.id}: ${input.cwd}`);
  }

  return repoRoot;
}

function createWorkspaceSessionFromManagedSession(input: CreateWorkspaceSessionInput): WorkspaceSession {
  const command = input.command;
  const worktree = input.location.worktree;

  return {
    id: input.managedSession.sessionId,
    workspaceId: command.workspaceId,
    name: command.name?.trim() || command.task,
    repoRoot: input.location.repoRoot.path,
    worktree: worktree?.path,
    cwd: command.cwd,
    branch: command.branch ?? worktree?.branch ?? input.location.repoRoot.defaultBranch,
    runtime: {
      agent: command.agent ?? "implementer",
      model: command.model ?? input.managedSession.modelId,
      runtime: "pi",
    },
    status: "running",
    liveSummary: `Queued initial prompt: ${command.task}`,
    latestMeaningfulUpdate: `Accepted session request for ${command.task}.`,
    currentActivity: "Queued initial prompt in pi.",
    currentTool: undefined,
    recentFiles: [],
    linkedResources: {
      artifactIds: structuredClone(command.linkedArtifactIds ?? []),
      workItemIds: structuredClone(command.linkedWorkItemIds ?? []),
      reviewIds: [],
    },
    connectionState: "live",
    sessionFile: input.managedSession.sessionFile,
    reconnectNote: undefined,
    startedAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  };
}

function rejectedCommand(reason: string): CommandResult {
  return {
    ok: false,
    reason,
  };
}

function rejectedPersistenceCommand(error: unknown): CommandResult {
  return rejectedCommand(`Failed to persist session state: ${errorMessage(error)}`);
}

async function disposeManagedSession(managedSession: ManagedPiSession): Promise<void> {
  await Promise.resolve(managedSession.dispose?.()).catch((): void => undefined);
}

function createReconnectNote(reason: string): string {
  return `Could not reconnect after restart. Metadata remains visible locally, but steer/follow-up/abort only work for sessions reattached in-process. Reason: ${reason}`;
}

function mergeRecentFiles(
  existingFiles: readonly SessionRecentFile[],
  incomingFiles: readonly SessionRecentFile[],
  limit: number,
): SessionRecentFile[] {
  const seenPaths = new Set<string>();
  const mergedFiles: SessionRecentFile[] = [];

  for (const file of [...incomingFiles, ...existingFiles]) {
    if (file.path.trim().length === 0 || seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    mergedFiles.push({ ...file });
  }

  return mergedFiles.slice(0, limit);
}

function createBoundedShellExecutor(defaultOptions: ShellExecutorOptions = {}): ShellExecutor {
  return async (command: string, cwd: string, options: ShellExecutorOptions = {}): Promise<ShellCommandExecutionResult> => {
    const timeoutMs = options.timeoutMs ?? defaultOptions.timeoutMs ?? 120_000;
    const maxOutputBytes = options.maxOutputBytes ?? defaultOptions.maxOutputBytes ?? 32_000;

    return await new Promise<ShellCommandExecutionResult>((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        env: process.env,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let settled = false;
      const timeout = setTimeout((): void => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill("SIGTERM");
        resolve({
          command,
          cwd,
          exitCode: undefined,
          output: truncateOutput(output, maxOutputBytes),
          timedOut: true,
        });
      }, timeoutMs);

      const collectOutput = (chunk: Buffer | string): void => {
        const chunkText = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        output = truncateOutput(output + chunkText, maxOutputBytes);
      };

      child.stdout?.on("data", collectOutput);
      child.stderr?.on("data", collectOutput);
      child.on("error", (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code: number | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve({
          command,
          cwd,
          exitCode: code ?? undefined,
          output: truncateOutput(output, maxOutputBytes),
          timedOut: false,
        });
      });
    });
  };
}

function createDefaultPathOpener(): WorkspacePathOpener {
  return {
    async openPath(targetPath: string): Promise<void> {
      await spawnDetached(getOpenCommand(targetPath));
    },
    async openExternalTerminal(cwd: string): Promise<void> {
      await spawnDetached(getTerminalCommand(cwd));
    },
  };
}

interface SpawnCommand {
  command: string;
  args: string[];
  cwd?: string;
}

function spawnDetached(command: SpawnCommand): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleRejected = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };
    const settleSpawned = (child: ReturnType<typeof spawn>): void => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        child.unref();
        resolve();
      } catch (error: unknown) {
        reject(error);
      }
    };

    try {
      const child = spawn(command.command, command.args, {
        cwd: command.cwd,
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      child.once("error", settleRejected);
      child.once("spawn", (): void => settleSpawned(child));
    } catch (error: unknown) {
      reject(error);
    }
  });
}

function getOpenCommand(targetPath: string): SpawnCommand {
  if (process.platform === "darwin") {
    return { command: "open", args: [targetPath] };
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", targetPath] };
  }

  return { command: "xdg-open", args: [targetPath] };
}

function getTerminalCommand(cwd: string): SpawnCommand {
  if (process.platform === "darwin") {
    return { command: "open", args: ["-a", "Terminal", cwd] };
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "cmd", "/K", "cd", "/d", cwd] };
  }

  return { command: "x-terminal-emulator", args: [], cwd };
}

function summarizeShellResult(command: string, exitCode: number | undefined, timedOut: boolean): string {
  if (timedOut) {
    return `Shell fallback timed out: ${command}`;
  }
  if (exitCode === 0) {
    return `Shell fallback completed: ${command}`;
  }
  if (exitCode === undefined) {
    return `Shell fallback ended without an exit code: ${command}`;
  }
  return `Shell fallback exited ${exitCode}: ${command}`;
}

function previewShellOutput(output: string): string {
  return stripTerminalControlSequences(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n")
    .slice(0, 800);
}

function truncateOutput(output: string, maxOutputBytes: number): string {
  if (Buffer.byteLength(output, "utf8") <= maxOutputBytes) {
    return output;
  }

  return output.slice(Math.max(0, output.length - maxOutputBytes));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
