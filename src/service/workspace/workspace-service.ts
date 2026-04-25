import path from "node:path";
import {
  attentionBandForStatus,
  compareAttentionCandidates,
  createAttentionCandidate,
  type AttentionEvent,
} from "../../shared/domain/attention.js";
import type { WorkspaceSession, WorkspaceSessionStatus } from "../../shared/domain/session.js";
import type { Workspace, WorkspaceRepoRoot } from "../../shared/domain/workspace.js";
import type {
  AddWorkspaceRepoDto,
  ArtifactLinkedEventDto,
  CreateSessionDto,
  CreateWorkspaceDto,
  FollowUpSessionDto,
  InterventionChangedEventDto,
  MutationResponseDto,
  OpenPathDto,
  PinSummaryDto,
  SessionRecentFilesUpdatedEventDto,
  SessionStatusChangedEventDto,
  SessionSummaryUpdatedEventDto,
  SessionsListDto,
  SteerSessionDto,
  UpdateWorkspaceDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
  WorkspaceUpdatedEventDto,
  WorkspaceStreamEventDto,
} from "../../shared/transport/dto.js";
import { summarizeWorkspace } from "../../shared/transport/dto.js";
import { AppStore } from "../persistence/app-store.js";
import { assertSafeWorkspaceId } from "../persistence/paths.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import type { CommandResult } from "../../shared/domain/commands.js";
import type { RuntimeManager } from "../orchestration/runtime-manager.js";
import { WorkspaceRegistry, type WorkspaceDetailRecord } from "./workspace-registry.js";
import {
  canonicalizeWorkspacePath,
  isWorkspacePathInside,
  normalizeWorkspacePathForComparison,
  workspacePathsMatch,
  WorkspacePathValidationError,
} from "./workspace-paths.js";

export interface WorkspaceMutationEvent {
  workspaceId: string;
  event: WorkspaceStreamEventDto;
}

export interface WorkspaceMutationResult<TPayload> {
  payload: TPayload;
  events: WorkspaceMutationEvent[];
}

export interface WorkspaceServiceLoadOptions {
  appDataDir: string;
}

export class WorkspaceMutationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMutationValidationError";
  }
}

export class WorkspaceService {
  private readonly recentAttentionByWorkspace = new Map<string, AttentionEvent[]>();
  private runtimeManager: RuntimeManager | undefined;
  private workspaceCounter: number;
  private repoCounter: number;
  private attentionCounter: number = 0;

  private constructor(private readonly registry: WorkspaceRegistry) {
    const workspaces = this.registry.listWorkspaces();
    this.workspaceCounter = getHighestPrefixedCounter(this.registry.listReservedWorkspaceIds(), "ws-");
    this.repoCounter = getHighestPrefixedCounter(
      workspaces.flatMap((workspace) => workspace.repoRoots.map((repoRoot) => repoRoot.id)),
      "repo-",
    );
  }

  static async load(options: WorkspaceServiceLoadOptions): Promise<WorkspaceService> {
    const appStore = new AppStore(path.join(options.appDataDir, "app-state.json"));
    const workspaceStores = new Map<string, WorkspaceStore>();
    const workspaceStoreFactory = (workspaceId: string): WorkspaceStore => {
      assertSafeWorkspaceId(workspaceId, "workspace id");

      const existingStore = workspaceStores.get(workspaceId);
      if (existingStore !== undefined) {
        return existingStore;
      }

      const store = new WorkspaceStore(path.join(options.appDataDir, "workspaces", workspaceId, "workspace.json"));
      workspaceStores.set(workspaceId, store);
      return store;
    };
    const registry = await WorkspaceRegistry.load({
      appStore,
      workspaceStoreFactory,
      workspacesDirectoryPath: path.join(options.appDataDir, "workspaces"),
    });

    return new WorkspaceService(registry);
  }

  async listWorkspaces(): Promise<WorkspaceSummaryDto[]> {
    return this.registry.listWorkspaces().map((workspace) => {
      const detail = this.registry.getWorkspaceDetail(workspace.id);
      return summarizeWorkspace(workspace, this.sortSessions(detail?.workspace, detail?.sessions ?? []));
    });
  }

  async getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetailDto | undefined> {
    const detail = this.registry.getWorkspaceDetail(workspaceId);
    if (detail === undefined) {
      return undefined;
    }

    return this.toWorkspaceDetailDto(detail);
  }

  getRuntimeRegistry(): WorkspaceRegistry {
    return this.registry;
  }

  setRuntimeManager(runtimeManager: RuntimeManager): void {
    this.runtimeManager = runtimeManager;
  }

  async getWorkspaceSessions(workspaceId: string): Promise<SessionsListDto | undefined> {
    const detail = this.registry.getWorkspaceDetail(workspaceId);
    if (detail === undefined) {
      return undefined;
    }

    return {
      workspaceId,
      sessions: this.sortSessions(detail.workspace, detail.sessions),
    };
  }

  async getSessionWorkspaceId(sessionId: string): Promise<string | undefined> {
    const sessionRecord = this.findSession(sessionId);
    return sessionRecord?.workspaceId;
  }

  async createWorkspace(input: CreateWorkspaceDto): Promise<WorkspaceMutationResult<WorkspaceDetailDto>> {
    const canonicalRepoPaths = await canonicalizeMutationPaths(input.repoRoots ?? [], "repoRoots");
    assertUniqueNewRepoRootPaths([], canonicalRepoPaths);
    this.workspaceCounter += 1;
    const createdAt = new Date().toISOString();
    const workspaceId = `ws-${this.workspaceCounter}`;
    const repoRoots = canonicalRepoPaths.map((repoPath) => this.createRepoRoot(repoPath));
    const detail = await this.registry.createWorkspace({
      id: workspaceId,
      name: input.name,
      description: input.description,
      repoRoots,
      createdAt,
      updatedAt: createdAt,
    });

    this.appendWorkspaceAttentionEvent(detail.workspace, createdAt, "Workspace created", `Created workspace ${detail.workspace.name}.`);

    return {
      payload: this.toWorkspaceDetailDto(detail),
      events: [{
        workspaceId,
        event: createWorkspaceUpdatedEvent(workspaceId, createdAt),
      }],
    };
  }

  async updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceDto,
  ): Promise<WorkspaceMutationResult<WorkspaceDetailDto> | undefined> {
    const existingDetail = this.registry.getWorkspaceDetail(workspaceId);
    if (existingDetail === undefined) {
      return undefined;
    }

    validateWorkspacePreferences(existingDetail.workspace, input.preferences);

    const detail = await this.registry.updateWorkspace(workspaceId, {
      name: input.name,
      description: input.description,
      preferences: input.preferences,
    });
    if (detail === undefined) {
      return undefined;
    }

    this.appendWorkspaceAttentionEvent(
      detail.workspace,
      detail.workspace.updatedAt,
      "Workspace updated",
      `Updated workspace ${detail.workspace.name}.`,
    );

    return {
      payload: this.toWorkspaceDetailDto(detail),
      events: [{
        workspaceId,
        event: createWorkspaceUpdatedEvent(workspaceId, detail.workspace.updatedAt),
      }],
    };
  }

  async addWorkspaceRepo(
    workspaceId: string,
    input: AddWorkspaceRepoDto,
  ): Promise<WorkspaceMutationResult<WorkspaceDetailDto> | undefined> {
    const currentDetail = this.registry.getWorkspaceDetail(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const canonicalRepoPath = await canonicalizeMutationPath(input.path, "repo path");
    assertUniqueNewRepoRootPaths(currentDetail.workspace.repoRoots, [canonicalRepoPath]);
    const repoRoot = this.createRepoRoot(canonicalRepoPath, input.name, input.defaultBranch);
    const detail = await this.registry.addRepoRoot(workspaceId, repoRoot);
    if (detail === undefined) {
      return undefined;
    }

    this.appendWorkspaceAttentionEvent(
      detail.workspace,
      detail.workspace.updatedAt,
      "Workspace repo added",
      `Added repo ${repoRoot.name} to ${detail.workspace.name}.`,
    );

    return {
      payload: this.toWorkspaceDetailDto(detail),
      events: [{
        workspaceId,
        event: createWorkspaceUpdatedEvent(workspaceId, detail.workspace.updatedAt),
      }],
    };
  }

  async createWorkspaceSession(
    workspaceId: string,
    input: CreateSessionDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const detail = this.registry.getWorkspaceDetail(workspaceId);
    if (detail === undefined) {
      return undefined;
    }

    const runtimeManager = this.requireRuntimeManager();
    const spawnResult = await runtimeManager.spawnSession(input);
    if (!spawnResult.result.ok) {
      if (isCreateSessionValidationReason(spawnResult.result.reason)) {
        throw new WorkspaceMutationValidationError(spawnResult.result.reason);
      }

      return {
        payload: createCommandResponse(spawnResult.result),
        events: [],
      };
    }

    const session = spawnResult.session ?? this.findNewestWorkspaceSession(workspaceId);
    if (session === undefined) {
      throw new Error("Runtime accepted session creation without persisted session metadata.");
    }

    this.appendAttentionEvent(session, spawnResult.result.acceptedAt, "Session created", `Accepted session request for ${input.task}.`, "operator");

    const events: WorkspaceMutationEvent[] = [
      { workspaceId, event: createWorkspaceUpdatedEvent(workspaceId, spawnResult.result.acceptedAt) },
      { workspaceId, event: createStatusChangedEvent(workspaceId, session.id, session.status, spawnResult.result.acceptedAt) },
      { workspaceId, event: createSummaryUpdatedEvent(session, spawnResult.result.acceptedAt) },
    ];

    for (const artifactId of session.linkedResources.artifactIds) {
      events.push({
        workspaceId,
        event: createArtifactLinkedEvent(workspaceId, artifactId, spawnResult.result.acceptedAt, session.id),
      });
    }

    return {
      payload: createCommandResponse(spawnResult.result),
      events,
    };
  }

  async steerSession(
    sessionId: string,
    input: SteerSessionDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().steerSession(input);
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, input.text, "Steer request rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(session, result.acceptedAt, "Steer request accepted", input.text, "operator");

    return this.createCommandMutation(session, result, input.text, "Steer request accepted");
  }

  async followUpSession(
    sessionId: string,
    input: FollowUpSessionDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().followUpSession(input);
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, input.text, "Follow-up rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(session, result.acceptedAt, "Follow-up requested", input.text, "operator");

    return this.createCommandMutation(session, result, input.text, "Follow-up requested");
  }

  async abortSession(sessionId: string): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().abortSession({ sessionId });
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, result.reason, "Abort rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(session, result.acceptedAt, "Abort requested", "Abort requested by operator.", "operator");

    return this.createCommandMutation(session, result, "Abort requested by operator.", "Abort requested");
  }

  async pinSessionSummary(
    sessionId: string,
    input: PinSummaryDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().pinSessionSummary(input);
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, result.reason, "Pinned summary rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(
      session,
      result.acceptedAt,
      "Pinned summary updated",
      input.summary ?? "Cleared the pinned summary.",
      "operator",
      false,
    );

    return this.createCommandMutation(session, result, input.summary ?? "Cleared the pinned summary.", "Pinned summary updated");
  }

  async openSessionPath(
    sessionId: string,
    input: OpenPathDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().openSessionPath(sessionId, input);
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, result.reason, "Recent file open rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(session, result.acceptedAt, "Recent file opened", input.path, "system", false);

    return this.createCommandMutation(session, result, input.path, "Recent file opened");
  }

  async runSessionShell(
    sessionId: string,
    command: string,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const result = await this.requireRuntimeManager().runShellFallback(sessionId, command);
    if (!result.ok) {
      const session = this.findSession(sessionId) ?? existingSession;
      return this.createCommandMutation(session, result, result.reason, "Shell fallback rejected");
    }

    const session = this.findSession(sessionId) ?? existingSession;
    this.appendAttentionEvent(session, result.acceptedAt, "Shell fallback requested", command, "operator");

    return this.createCommandMutation(session, result, command, "Shell fallback requested");
  }

  requireRuntimeManager(): RuntimeManager {
    if (this.runtimeManager === undefined) {
      throw new Error("WorkspaceService requires RuntimeManager for session commands.");
    }

    return this.runtimeManager;
  }

  private findNewestWorkspaceSession(workspaceId: string): WorkspaceSession | undefined {
    const detail = this.registry.getWorkspaceDetail(workspaceId);
    return [...(detail?.sessions ?? [])]
      .sort((left: WorkspaceSession, right: WorkspaceSession) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  private createCommandMutation(
    session: WorkspaceSession,
    result: CommandResult,
    detail: string,
    title: string,
  ): WorkspaceMutationResult<MutationResponseDto> {
    const occurredAt = result.ok ? result.acceptedAt : new Date().toISOString();
    if (!result.ok) {
      this.appendAttentionEvent(session, occurredAt, title, detail, "operator");
    }

    return {
      payload: createCommandResponse(result),
      events: createSessionMutationEvents(session, occurredAt),
    };
  }

  private toWorkspaceDetailDto(detail: WorkspaceDetailRecord): WorkspaceDetailDto {
    return {
      workspace: structuredClone(detail.workspace),
      sessions: this.sortSessions(detail.workspace, detail.sessions),
      artifacts: structuredClone(detail.artifacts),
      recentAttention: [
        ...structuredClone(this.runtimeManager?.listRecentAttention(detail.workspace.id) ?? []),
        ...structuredClone(this.recentAttentionByWorkspace.get(detail.workspace.id) ?? []),
      ].slice(0, 25),
    };
  }

  private createRepoRoot(repoPath: string, name?: string, defaultBranch?: string): WorkspaceRepoRoot {
    this.repoCounter += 1;

    return {
      id: `repo-${this.repoCounter}`,
      path: repoPath,
      name: name ?? path.basename(repoPath),
      defaultBranch,
    };
  }

  private findSession(sessionId: string): WorkspaceSession | undefined {
    for (const workspace of this.registry.listWorkspaces()) {
      const detail = this.registry.getWorkspaceDetail(workspace.id);
      const session = detail?.sessions.find((candidate) => candidate.id === sessionId);
      if (session !== undefined) {
        return session;
      }
    }

    return undefined;
  }

  private sortSessions(workspace: Workspace | undefined, sessions: readonly WorkspaceSession[]): WorkspaceSession[] {
    const sessionOrder = new Map<string, number>((workspace?.sessionIds ?? []).map((sessionId, index) => [sessionId, index]));

    return sessions
      .map((session) => ({
        session,
        candidate: createAttentionCandidate(session, sessionOrder.get(session.id) ?? Number.MAX_SAFE_INTEGER),
      }))
      .sort((left, right) => compareAttentionCandidates(left.candidate, right.candidate))
      .map(({ session }) => structuredClone(session));
  }

  private appendWorkspaceAttentionEvent(workspace: Workspace, occurredAt: string, title: string, detail: string): void {
    this.appendAttention({
      id: this.createAttentionEventId(),
      sessionId: `workspace:${workspace.id}`,
      workspaceId: workspace.id,
      band: "active",
      title,
      detail,
      occurredAt,
      source: "system",
      meaningful: true,
    });
  }

  private appendAttentionEvent(
    session: WorkspaceSession,
    occurredAt: string,
    title: string,
    detail: string,
    source: AttentionEvent["source"],
    meaningful: boolean = true,
  ): void {
    this.appendAttention({
      id: this.createAttentionEventId(),
      sessionId: session.id,
      workspaceId: session.workspaceId,
      band: attentionBandForStatus(session.status),
      title,
      detail,
      occurredAt,
      source,
      meaningful,
    });
  }

  private appendAttention(event: AttentionEvent): void {
    const currentEvents = this.recentAttentionByWorkspace.get(event.workspaceId) ?? [];
    this.recentAttentionByWorkspace.set(event.workspaceId, [event, ...currentEvents].slice(0, 25));
  }

  private createAttentionEventId(): string {
    this.attentionCounter += 1;
    return `attention-${this.attentionCounter}`;
  }
}

function createCommandResponse(result: CommandResult): MutationResponseDto {
  return { result };
}

function createSessionMutationEvents(session: WorkspaceSession, occurredAt: string): WorkspaceMutationEvent[] {
  return [
    { workspaceId: session.workspaceId, event: createWorkspaceUpdatedEvent(session.workspaceId, occurredAt) },
    { workspaceId: session.workspaceId, event: createStatusChangedEvent(session.workspaceId, session.id, session.status, occurredAt) },
    { workspaceId: session.workspaceId, event: createSummaryUpdatedEvent(session, occurredAt) },
    { workspaceId: session.workspaceId, event: createInterventionChangedEvent(session, occurredAt) },
    { workspaceId: session.workspaceId, event: createRecentFilesUpdatedEvent(session, occurredAt) },
  ];
}

function isCreateSessionValidationReason(reason: string): boolean {
  return reason.includes("absolute path")
    || reason.includes("repoRoot")
    || reason.includes("worktree")
    || reason.includes("linkedArtifactIds")
    || reason.includes("cwd must stay")
    || reason.includes("Workspace not found");
}

async function canonicalizeCreateSessionInput(input: CreateSessionDto): Promise<CreateSessionDto> {
  return {
    ...input,
    cwd: await canonicalizeMutationPath(input.cwd, "cwd"),
    repoRoot: input.repoRoot === undefined ? undefined : await canonicalizeMutationPath(input.repoRoot, "repoRoot"),
    worktree: input.worktree === undefined ? undefined : await canonicalizeMutationPath(input.worktree, "worktree"),
  };
}

async function canonicalizeMutationPaths(filePaths: readonly string[], context: string): Promise<string[]> {
  return Promise.all(filePaths.map((filePath, index) => canonicalizeMutationPath(filePath, `${context}[${index}]`)));
}

async function canonicalizeMutationPath(filePath: string, context: string): Promise<string> {
  try {
    return await canonicalizeWorkspacePath(filePath, context);
  } catch (error: unknown) {
    if (error instanceof WorkspacePathValidationError) {
      throw new WorkspaceMutationValidationError(error.message);
    }
    throw error;
  }
}

function assertUniqueNewRepoRootPaths(existingRepoRoots: readonly WorkspaceRepoRoot[], newRepoPaths: readonly string[]): void {
  const seenPaths = new Set<string>(existingRepoRoots.map((repoRoot) => normalizeWorkspacePathForComparison(repoRoot.path)));

  for (const repoPath of newRepoPaths) {
    const normalizedRepoPath = normalizeWorkspacePathForComparison(repoPath);
    if (seenPaths.has(normalizedRepoPath)) {
      throw new WorkspaceMutationValidationError(`repo root path must be unique: ${repoPath}`);
    }
    seenPaths.add(normalizedRepoPath);
  }
}

function validateWorkspacePreferences(
  workspace: Workspace,
  preferences: UpdateWorkspaceDto["preferences"] | undefined,
): void {
  if (preferences?.selectedSessionId !== undefined && !workspace.sessionIds.includes(preferences.selectedSessionId)) {
    throw new WorkspaceMutationValidationError(
      `selectedSessionId must reference a session in workspace ${workspace.id}: ${preferences.selectedSessionId}`,
    );
  }

  if (preferences?.selectedArtifactId !== undefined && !workspace.artifactIds.includes(preferences.selectedArtifactId)) {
    throw new WorkspaceMutationValidationError(
      `selectedArtifactId must reference an artifact in workspace ${workspace.id}: ${preferences.selectedArtifactId}`,
    );
  }
}

interface ResolvedSessionLocation {
  repoRoot: WorkspaceRepoRoot;
  worktree?: Workspace["worktrees"][number];
}

function validateCreateSessionInput(detail: WorkspaceDetailRecord, input: CreateSessionDto): ResolvedSessionLocation {
  const requestedWorktreePath = input.worktree;
  const worktree = requestedWorktreePath === undefined
    ? undefined
    : detail.workspace.worktrees.find((candidate) => pathsMatch(candidate.path, requestedWorktreePath));

  if (input.worktree !== undefined && worktree === undefined) {
    throw new WorkspaceMutationValidationError(
      `worktree must reference a registered worktree in workspace ${detail.workspace.id}: ${input.worktree}`,
    );
  }

  const repoRoot = resolveRepoRoot(detail, input, worktree);
  const cwdBasePath = worktree?.path ?? repoRoot.path;
  if (!isWorkspacePathInside(cwdBasePath, input.cwd)) {
    throw new WorkspaceMutationValidationError(`cwd must stay within ${cwdBasePath}: ${input.cwd}`);
  }

  if (worktree !== undefined && worktree.repoRootId !== repoRoot.id) {
    throw new WorkspaceMutationValidationError(
      `worktree ${input.worktree} must belong to repo root ${repoRoot.path}`,
    );
  }
  if (worktree !== undefined && !isWorkspacePathInside(repoRoot.path, worktree.path)) {
    throw new WorkspaceMutationValidationError(
      `worktree ${input.worktree} must stay inside repo root ${repoRoot.path}`,
    );
  }

  const workspaceArtifactIds = new Set(detail.workspace.artifactIds);
  for (const artifactId of input.linkedArtifactIds ?? []) {
    if (!workspaceArtifactIds.has(artifactId)) {
      throw new WorkspaceMutationValidationError(
        `linkedArtifactIds must reference existing workspace artifacts: ${artifactId}`,
      );
    }
  }

  return { repoRoot, worktree };
}

function resolveRepoRoot(
  detail: WorkspaceDetailRecord,
  input: CreateSessionDto,
  worktree: Workspace["worktrees"][number] | undefined,
): WorkspaceRepoRoot {
  const requestedRepoRootPath = input.repoRoot;
  if (requestedRepoRootPath !== undefined) {
    const explicitRepoRoot = detail.workspace.repoRoots.find((candidate) => pathsMatch(candidate.path, requestedRepoRootPath));
    if (explicitRepoRoot === undefined) {
      throw new WorkspaceMutationValidationError(
        `repoRoot must reference a registered repo root in workspace ${detail.workspace.id}: ${input.repoRoot}`,
      );
    }
    return explicitRepoRoot;
  }

  if (worktree !== undefined) {
    const worktreeRepoRoot = detail.workspace.repoRoots.find((candidate) => candidate.id === worktree.repoRootId);
    if (worktreeRepoRoot !== undefined) {
      return worktreeRepoRoot;
    }
  }

  const containingRepoRoots = detail.workspace.repoRoots.filter((candidate) => isWorkspacePathInside(candidate.path, input.cwd));
  containingRepoRoots.sort((left, right) =>
    normalizeWorkspacePathForComparison(right.path).length - normalizeWorkspacePathForComparison(left.path).length,
  );
  const inferredRepoRoot = containingRepoRoots[0];
  if (inferredRepoRoot === undefined) {
    throw new WorkspaceMutationValidationError(
      `repoRoot must reference a registered repo root in workspace ${detail.workspace.id}: ${input.cwd}`,
    );
  }

  return inferredRepoRoot;
}

function pathsMatch(leftPath: string, rightPath: string): boolean {
  return workspacePathsMatch(leftPath, rightPath);
}

function getHighestPrefixedCounter(ids: readonly string[], prefix: string): number {
  let highestCounter = 0;

  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      continue;
    }

    const counterValue = Number(id.slice(prefix.length));
    if (Number.isInteger(counterValue) && counterValue > highestCounter) {
      highestCounter = counterValue;
    }
  }

  return highestCounter;
}

function createWorkspaceUpdatedEvent(workspaceId: string, updatedAt: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "workspace.updated",
    payload: {
      workspaceId,
      updatedAt,
    } satisfies WorkspaceUpdatedEventDto,
  };
}

function createStatusChangedEvent(
  workspaceId: string,
  sessionId: string,
  status: WorkspaceSessionStatus,
  changedAt: string,
): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "session.status-changed",
    payload: {
      workspaceId,
      sessionId,
      status,
      changedAt,
    } satisfies SessionStatusChangedEventDto,
  };
}

function createSummaryUpdatedEvent(session: WorkspaceSession, updatedAt: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "session.summary-updated",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      liveSummary: session.liveSummary,
      pinnedSummary: session.pinnedSummary,
      updatedAt,
    } satisfies SessionSummaryUpdatedEventDto,
  };
}

function createRecentFilesUpdatedEvent(session: WorkspaceSession, updatedAt: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "session.recent-files-updated",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      files: structuredClone(session.recentFiles),
      updatedAt,
    } satisfies SessionRecentFilesUpdatedEventDto,
  };
}

function createInterventionChangedEvent(session: WorkspaceSession, updatedAt: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "session.intervention-changed",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      intervention: session.lastIntervention,
      updatedAt,
    } satisfies InterventionChangedEventDto,
  };
}

function createArtifactLinkedEvent(
  workspaceId: string,
  artifactId: string,
  linkedAt: string,
  sessionId?: string,
): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "artifact.linked",
    payload: {
      workspaceId,
      artifactId,
      sessionId,
      linkedAt,
    } satisfies ArtifactLinkedEventDto,
  };
}
