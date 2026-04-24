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
import { WorkspaceStore } from "../persistence/workspace-store.js";
import { WorkspaceRegistry, type WorkspaceDetailRecord } from "./workspace-registry.js";

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

export class WorkspaceService {
  private readonly recentAttentionByWorkspace = new Map<string, AttentionEvent[]>();
  private workspaceCounter: number;
  private repoCounter: number;
  private sessionCounter: number;
  private attentionCounter: number = 0;

  private constructor(private readonly registry: WorkspaceRegistry) {
    const workspaces = this.registry.listWorkspaces();
    this.workspaceCounter = getHighestPrefixedCounter(workspaces.map((workspace) => workspace.id), "ws-");
    this.repoCounter = getHighestPrefixedCounter(
      workspaces.flatMap((workspace) => workspace.repoRoots.map((repoRoot) => repoRoot.id)),
      "repo-",
    );
    this.sessionCounter = getHighestPrefixedCounter(
      workspaces.flatMap((workspace) => this.registry.getWorkspaceDetail(workspace.id)?.sessions.map((session) => session.id) ?? []),
      "ses-",
    );
  }

  static async load(options: WorkspaceServiceLoadOptions): Promise<WorkspaceService> {
    const appStore = new AppStore(path.join(options.appDataDir, "app-state.json"));
    const workspaceStoreFactory = (workspaceId: string): WorkspaceStore =>
      new WorkspaceStore(path.join(options.appDataDir, "workspaces", workspaceId, "workspace.json"));
    const registry = await WorkspaceRegistry.load({
      appStore,
      workspaceStoreFactory,
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
    this.workspaceCounter += 1;
    const createdAt = new Date().toISOString();
    const workspaceId = `ws-${this.workspaceCounter}`;
    const repoRoots = (input.repoRoots ?? []).map((repoPath) => this.createRepoRoot(repoPath));
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
    const repoRoot = this.createRepoRoot(input.path, input.name, input.defaultBranch);
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

    this.sessionCounter += 1;
    const acceptedAt = new Date().toISOString();
    const sessionId = `ses-${this.sessionCounter}`;
    const session: WorkspaceSession = {
      id: sessionId,
      workspaceId,
      name: input.name ?? input.task,
      repoRoot: input.repoRoot ?? input.cwd,
      worktree: input.worktree,
      cwd: input.cwd,
      branch: input.branch,
      runtime: {
        agent: input.agent ?? "implementer",
        model: input.model ?? "sonnet",
        runtime: "pi",
      },
      status: "running",
      liveSummary: `Created session for: ${input.task}`,
      latestMeaningfulUpdate: `Accepted session request for ${input.task}.`,
      currentActivity: "Queued in local workspace service.",
      recentFiles: [],
      linkedResources: {
        artifactIds: structuredClone(input.linkedArtifactIds ?? []),
        workItemIds: structuredClone(input.linkedWorkItemIds ?? []),
        reviewIds: [],
      },
      connectionState: "live",
      startedAt: acceptedAt,
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Session created", `Accepted session request for ${input.task}.`, "operator");

    const events: WorkspaceMutationEvent[] = [
      { workspaceId, event: createWorkspaceUpdatedEvent(workspaceId, acceptedAt) },
      { workspaceId, event: createStatusChangedEvent(workspaceId, sessionId, session.status, acceptedAt) },
      { workspaceId, event: createSummaryUpdatedEvent(session, acceptedAt) },
    ];

    for (const artifactId of session.linkedResources.artifactIds) {
      events.push({
        workspaceId,
        event: createArtifactLinkedEvent(workspaceId, artifactId, acceptedAt, sessionId),
      });
    }

    return {
      payload: createAcceptedResponse(acceptedAt),
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

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      lastIntervention: {
        kind: "steer",
        status: "accepted-locally",
        text: input.text,
        requestedAt: acceptedAt,
      },
      status: "running",
      liveSummary: input.text,
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Steer request accepted", input.text, "operator");

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [
        { workspaceId: session.workspaceId, event: createInterventionChangedEvent(session, acceptedAt) },
        { workspaceId: session.workspaceId, event: createStatusChangedEvent(session.workspaceId, session.id, session.status, acceptedAt) },
        { workspaceId: session.workspaceId, event: createSummaryUpdatedEvent(session, acceptedAt) },
      ],
    };
  }

  async followUpSession(
    sessionId: string,
    input: FollowUpSessionDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      lastIntervention: {
        kind: "follow-up",
        status: "pending-observation",
        text: input.text,
        requestedAt: acceptedAt,
      },
      latestMeaningfulUpdate: input.text,
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Follow-up requested", input.text, "operator");

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [
        { workspaceId: session.workspaceId, event: createInterventionChangedEvent(session, acceptedAt) },
        { workspaceId: session.workspaceId, event: createSummaryUpdatedEvent(session, acceptedAt) },
      ],
    };
  }

  async abortSession(sessionId: string): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      lastIntervention: {
        kind: "abort",
        status: "accepted-locally",
        text: "Abort requested by operator.",
        requestedAt: acceptedAt,
      },
      status: "failed",
      latestMeaningfulUpdate: "Abort requested by operator.",
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Abort requested", "Abort requested by operator.", "operator");

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [
        { workspaceId: session.workspaceId, event: createInterventionChangedEvent(session, acceptedAt) },
        { workspaceId: session.workspaceId, event: createStatusChangedEvent(session.workspaceId, session.id, session.status, acceptedAt) },
      ],
    };
  }

  async pinSessionSummary(
    sessionId: string,
    input: PinSummaryDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      pinnedSummary: input.summary,
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(
      session,
      acceptedAt,
      "Pinned summary updated",
      input.summary ?? "Cleared the pinned summary.",
      "operator",
      false,
    );

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [{
        workspaceId: session.workspaceId,
        event: createSummaryUpdatedEvent(session, acceptedAt),
      }],
    };
  }

  async openSessionPath(
    sessionId: string,
    input: OpenPathDto,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      recentFiles: [{
        path: input.path,
        operation: "edited" as const,
        timestamp: acceptedAt,
      }, ...existingSession.recentFiles].slice(0, 10),
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Recent file opened", input.path, "system", false);

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [{
        workspaceId: session.workspaceId,
        event: createRecentFilesUpdatedEvent(session, acceptedAt),
      }],
    };
  }

  async runSessionShell(
    sessionId: string,
    command: string,
  ): Promise<WorkspaceMutationResult<MutationResponseDto> | undefined> {
    const existingSession = this.findSession(sessionId);
    if (existingSession === undefined) {
      return undefined;
    }

    const acceptedAt = new Date().toISOString();
    const session: WorkspaceSession = {
      ...existingSession,
      currentActivity: `Shell fallback requested: ${command}`,
      liveSummary: `Shell fallback queued: ${command}`,
      updatedAt: acceptedAt,
    };

    await this.registry.upsertSession(session);
    this.appendAttentionEvent(session, acceptedAt, "Shell fallback requested", command, "operator");

    return {
      payload: createAcceptedResponse(acceptedAt),
      events: [{
        workspaceId: session.workspaceId,
        event: createSummaryUpdatedEvent(session, acceptedAt),
      }],
    };
  }

  private toWorkspaceDetailDto(detail: WorkspaceDetailRecord): WorkspaceDetailDto {
    return {
      workspace: structuredClone(detail.workspace),
      sessions: this.sortSessions(detail.workspace, detail.sessions),
      artifacts: structuredClone(detail.artifacts),
      recentAttention: structuredClone(this.recentAttentionByWorkspace.get(detail.workspace.id) ?? []),
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

function createAcceptedResponse(acceptedAt: string): MutationResponseDto {
  return {
    result: {
      ok: true,
      acceptedAt,
    },
  };
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
