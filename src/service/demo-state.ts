import {
  attentionBandForStatus,
  compareAttentionCandidates,
  createAttentionCandidate,
  type AttentionEvent,
} from "../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../shared/domain/artifact.js";
import type {
  WorkspaceSession,
  WorkspaceSessionStatus,
} from "../shared/domain/session.js";
import type { Workspace, WorkspaceRepoRoot } from "../shared/domain/workspace.js";
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
} from "../shared/transport/dto.js";
import { summarizeWorkspace } from "../shared/transport/dto.js";

export const DEMO_WORKSPACE_ID: string = "ws-demo";

const DEMO_WORKSPACE: Workspace = {
  id: DEMO_WORKSPACE_ID,
  name: "Jackdaw Live Workspace",
  description: "Deterministic service-backed demo workspace for the live GUI slice.",
  repoRoots: [
    {
      id: "repo-jackdaw",
      path: "/workspace/jackdaw",
      name: "jackdaw",
      defaultBranch: "main",
    },
    {
      id: "repo-hq",
      path: "/workspace/hq",
      name: "hq",
      defaultBranch: "main",
    },
  ],
  worktrees: [
    {
      id: "worktree-live-slice",
      repoRootId: "repo-jackdaw",
      path: "/workspace/jackdaw/.worktrees/feat-live-workspace-slice",
      branch: "feat-live-workspace-slice",
      label: "GUI slice",
    },
  ],
  sessionIds: ["ses-awaiting-input", "ses-running", "ses-idle"],
  artifactIds: ["artifact-plan-snapshot"],
  preferences: {
    selectedSessionId: "ses-awaiting-input",
    attentionView: "all",
    detailView: "summary",
  },
  optionalIntegrations: {
    hqProjectId: "project-demo-live-workspace",
  },
  createdAt: "2026-04-23T09:00:00.000Z",
  updatedAt: "2026-04-23T10:15:00.000Z",
};

const DEMO_SESSIONS: WorkspaceSession[] = [
  {
    id: "ses-awaiting-input",
    workspaceId: DEMO_WORKSPACE_ID,
    name: "Implement Task 1 service endpoints",
    repoRoot: "/workspace/jackdaw",
    worktree: "/workspace/jackdaw/.worktrees/feat-live-workspace-slice",
    cwd: "/workspace/jackdaw/.worktrees/feat-live-workspace-slice",
    branch: "feat-live-workspace-slice",
    runtime: {
      agent: "implementer",
      model: "sonnet",
      runtime: "pi",
    },
    status: "awaiting-input",
    liveSummary: "Service tests are written and waiting on endpoint implementation review.",
    pinnedSummary: "Need confirmation on deterministic demo-state route payloads before continuing.",
    latestMeaningfulUpdate: "Added failing Fastify inject coverage for workspace routes.",
    currentActivity: "Waiting for operator confirmation on seeded workspace detail shape.",
    currentTool: "vitest",
    lastIntervention: {
      kind: "follow-up",
      status: "pending-observation",
      text: "Confirm the seeded selected session should expose recent files and intervention metadata.",
      requestedAt: "2026-04-23T10:03:00.000Z",
    },
    recentFiles: [
      {
        path: "src/service/server.test.ts",
        operation: "created",
        timestamp: "2026-04-23T10:01:00.000Z",
      },
      {
        path: "src/service/demo-state.ts",
        operation: "edited",
        timestamp: "2026-04-23T10:02:30.000Z",
      },
    ],
    linkedResources: {
      artifactIds: ["artifact-plan-snapshot"],
      workItemIds: ["task-service-demo-state"],
      reviewIds: ["review-service-routes"],
      hqWorkItemId: "hq-work-item-demo-state",
    },
    connectionState: "live",
    sessionFile: ".pi/sessions/ses-awaiting-input.json",
    startedAt: "2026-04-23T09:55:00.000Z",
    updatedAt: "2026-04-23T10:05:00.000Z",
  },
  {
    id: "ses-running",
    workspaceId: DEMO_WORKSPACE_ID,
    name: "Render live workspace shell",
    repoRoot: "/workspace/jackdaw",
    cwd: "/workspace/jackdaw",
    branch: "feat-live-workspace-slice",
    runtime: {
      agent: "implementer",
      model: "sonnet",
      runtime: "pi",
    },
    status: "running",
    liveSummary: "Preparing the React shell to fetch workspace detail once service routes land.",
    latestMeaningfulUpdate: "Sketched fetch state transitions for workspace and session detail.",
    currentActivity: "Reviewing UI contract usage in App.tsx.",
    currentTool: "read",
    recentFiles: [
      {
        path: "src/web/App.tsx",
        operation: "edited",
        timestamp: "2026-04-23T10:07:00.000Z",
      },
    ],
    linkedResources: {
      artifactIds: [],
      workItemIds: ["task-web-live-workspace"],
      reviewIds: [],
    },
    connectionState: "live",
    startedAt: "2026-04-23T09:58:00.000Z",
    updatedAt: "2026-04-23T10:09:00.000Z",
  },
  {
    id: "ses-idle",
    workspaceId: DEMO_WORKSPACE_ID,
    name: "Spec review snapshot",
    repoRoot: "/workspace/hq",
    cwd: "/workspace/hq",
    branch: "main",
    runtime: {
      agent: "reviewer",
      model: "sonnet",
      runtime: "pi",
    },
    status: "idle",
    liveSummary: "Spec review finished with no blocking findings for the read-only slice.",
    latestMeaningfulUpdate: "Captured final checklist for service-backed workspace detail.",
    recentFiles: [
      {
        path: "docs/superpowers/specs/2026-04-23-service-backed-live-workspace-design.md",
        operation: "edited",
        timestamp: "2026-04-23T09:50:00.000Z",
      },
    ],
    linkedResources: {
      artifactIds: ["artifact-plan-snapshot"],
      workItemIds: [],
      reviewIds: ["review-spec-slice"],
    },
    connectionState: "historical",
    reconnectNote: "Completed earlier and left disconnected for reference.",
    startedAt: "2026-04-23T09:20:00.000Z",
    updatedAt: "2026-04-23T09:45:00.000Z",
    completedAt: "2026-04-23T09:44:00.000Z",
  },
];

const DEMO_ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: "artifact-plan-snapshot",
    workspaceId: DEMO_WORKSPACE_ID,
    kind: "plan",
    title: "Service-backed live workspace implementation plan",
    filePath: "docs/superpowers/plans/2026-04-23-service-backed-live-workspace.md",
    sourceSessionId: "ses-idle",
    linkedSessionIds: ["ses-awaiting-input", "ses-idle"],
    linkedWorkItemIds: ["task-service-demo-state"],
    createdAt: "2026-04-23T09:30:00.000Z",
    updatedAt: "2026-04-23T09:46:00.000Z",
  },
];

const DEMO_ATTENTION_EVENTS: AttentionEvent[] = [
  {
    id: "attention-awaiting-input",
    sessionId: "ses-awaiting-input",
    workspaceId: DEMO_WORKSPACE_ID,
    band: "needs-operator",
    title: "Operator input requested",
    detail: "The service demo state is waiting for confirmation before route work continues.",
    occurredAt: "2026-04-23T10:04:00.000Z",
    source: "operator",
    meaningful: true,
  },
  {
    id: "attention-running",
    sessionId: "ses-running",
    workspaceId: DEMO_WORKSPACE_ID,
    band: "active",
    title: "UI fetch flow in progress",
    detail: "The web shell is actively being prepared for service-backed workspace reads.",
    occurredAt: "2026-04-23T10:08:00.000Z",
    source: "runtime",
    meaningful: true,
  },
];

export interface DemoMutationEvent {
  workspaceId: string;
  event: WorkspaceStreamEventDto;
}

export interface DemoStateStore {
  listWorkspaces(): WorkspaceSummaryDto[];
  getWorkspaceDetail(workspaceId: string): WorkspaceDetailDto | undefined;
  getWorkspaceSessions(workspaceId: string): SessionsListDto | undefined;
  getSessionWorkspaceId(sessionId: string): string | undefined;
  createWorkspace(input: CreateWorkspaceDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] };
  updateWorkspace(workspaceId: string, input: UpdateWorkspaceDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] } | undefined;
  addWorkspaceRepo(workspaceId: string, input: AddWorkspaceRepoDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] } | undefined;
  createWorkspaceSession(workspaceId: string, input: CreateSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  steerSession(sessionId: string, input: SteerSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  followUpSession(sessionId: string, input: FollowUpSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  abortSession(sessionId: string): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  pinSessionSummary(sessionId: string, input: PinSummaryDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  openSessionPath(sessionId: string, input: OpenPathDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
  runSessionShell(sessionId: string, command: string): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined;
}

interface MutableDemoState {
  workspaces: Map<string, Workspace>;
  sessions: Map<string, WorkspaceSession>;
  artifacts: Map<string, WorkspaceArtifact>;
  recentAttention: AttentionEvent[];
  attentionCounter: number;
  workspaceCounter: number;
  repoCounter: number;
  sessionCounter: number;
}

export function createDemoStateStore(): DemoStateStore {
  const state: MutableDemoState = {
    workspaces: new Map<string, Workspace>([[DEMO_WORKSPACE.id, structuredClone(DEMO_WORKSPACE)]]),
    sessions: new Map<string, WorkspaceSession>(DEMO_SESSIONS.map((session) => [session.id, structuredClone(session)])),
    artifacts: new Map<string, WorkspaceArtifact>(DEMO_ARTIFACTS.map((artifact) => [artifact.id, structuredClone(artifact)])),
    recentAttention: structuredClone(DEMO_ATTENTION_EVENTS),
    attentionCounter: DEMO_ATTENTION_EVENTS.length,
    workspaceCounter: 1,
    repoCounter: DEMO_WORKSPACE.repoRoots.length,
    sessionCounter: DEMO_SESSIONS.length,
  };

  const listOrderedSessions = (workspaceId: string): WorkspaceSession[] => {
    const workspace = state.workspaces.get(workspaceId);
    if (workspace === undefined) {
      return [];
    }

    return workspace.sessionIds
      .map((sessionId) => state.sessions.get(sessionId))
      .filter((session): session is WorkspaceSession => session !== undefined)
      .map((session, index) => ({
        candidate: createAttentionCandidate(session, index),
        session,
      }))
      .sort((left, right) => compareAttentionCandidates(left.candidate, right.candidate))
      .map(({ session }) => structuredClone(session));
  };

  const getWorkspaceDetail = (workspaceId: string): WorkspaceDetailDto | undefined => {
    const workspace = state.workspaces.get(workspaceId);
    if (workspace === undefined) {
      return undefined;
    }

    const artifacts = workspace.artifactIds
      .map((artifactId) => state.artifacts.get(artifactId))
      .filter((artifact): artifact is WorkspaceArtifact => artifact !== undefined)
      .map((artifact) => structuredClone(artifact));

    return {
      workspace: structuredClone(workspace),
      sessions: listOrderedSessions(workspaceId),
      artifacts,
      recentAttention: state.recentAttention
        .filter((event) => event.workspaceId === workspaceId)
        .map((event) => structuredClone(event)),
    };
  };

  const makeWorkspaceUpdatedEvent = (workspaceId: string, updatedAt: string): WorkspaceStreamEventDto => ({
    version: 1,
    type: "workspace.updated",
    payload: {
      workspaceId,
      updatedAt,
    } satisfies WorkspaceUpdatedEventDto,
  });

  const makeStatusChangedEvent = (
    workspaceId: string,
    sessionId: string,
    status: WorkspaceSessionStatus,
    changedAt: string,
  ): WorkspaceStreamEventDto => ({
    version: 1,
    type: "session.status-changed",
    payload: {
      workspaceId,
      sessionId,
      status,
      changedAt,
    } satisfies SessionStatusChangedEventDto,
  });

  const makeSummaryUpdatedEvent = (
    session: WorkspaceSession,
    updatedAt: string,
  ): WorkspaceStreamEventDto => ({
    version: 1,
    type: "session.summary-updated",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      liveSummary: session.liveSummary,
      pinnedSummary: session.pinnedSummary,
      updatedAt,
    } satisfies SessionSummaryUpdatedEventDto,
  });

  const makeRecentFilesEvent = (
    session: WorkspaceSession,
    updatedAt: string,
  ): WorkspaceStreamEventDto => ({
    version: 1,
    type: "session.recent-files-updated",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      files: structuredClone(session.recentFiles),
      updatedAt,
    } satisfies SessionRecentFilesUpdatedEventDto,
  });

  const makeInterventionEvent = (
    session: WorkspaceSession,
    updatedAt: string,
  ): WorkspaceStreamEventDto => ({
    version: 1,
    type: "session.intervention-changed",
    payload: {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      intervention: session.lastIntervention,
      updatedAt,
    } satisfies InterventionChangedEventDto,
  });

  const makeArtifactLinkedEvent = (
    workspaceId: string,
    artifactId: string,
    linkedAt: string,
    sessionId?: string,
  ): WorkspaceStreamEventDto => ({
    version: 1,
    type: "artifact.linked",
    payload: {
      workspaceId,
      artifactId,
      sessionId,
      linkedAt,
    } satisfies ArtifactLinkedEventDto,
  });

  const touchWorkspace = (workspaceId: string, updatedAt: string): Workspace | undefined => {
    const workspace = state.workspaces.get(workspaceId);
    if (workspace === undefined) {
      return undefined;
    }

    workspace.updatedAt = updatedAt;
    return workspace;
  };

  const appendAttentionRecord = (
    sessionId: string,
    workspaceId: string,
    band: AttentionEvent["band"],
    occurredAt: string,
    title: string,
    detail: string,
    source: AttentionEvent["source"],
    meaningful: boolean,
  ): void => {
    state.attentionCounter += 1;
    state.recentAttention = [{
      id: `attention-${state.attentionCounter}`,
      sessionId,
      workspaceId,
      band,
      title,
      detail,
      occurredAt,
      source,
      meaningful,
    }, ...state.recentAttention].slice(0, 25);
  };

  const appendAttentionEvent = (
    session: WorkspaceSession,
    occurredAt: string,
    title: string,
    detail: string,
    source: AttentionEvent["source"],
    meaningful: boolean = true,
  ): void => {
    appendAttentionRecord(
      session.id,
      session.workspaceId,
      attentionBandForStatus(session.status),
      occurredAt,
      title,
      detail,
      source,
      meaningful,
    );
  };

  const appendWorkspaceAttentionEvent = (
    workspace: Workspace,
    occurredAt: string,
    title: string,
    detail: string,
  ): void => {
    appendAttentionRecord(
      `workspace:${workspace.id}`,
      workspace.id,
      "active",
      occurredAt,
      title,
      detail,
      "system",
      true,
    );
  };

  const findSession = (sessionId: string): WorkspaceSession | undefined => {
    return state.sessions.get(sessionId);
  };

  const createAcceptedResponse = (acceptedAt: string): MutationResponseDto => ({
    result: {
      ok: true,
      acceptedAt,
    },
  });

  return {
    listWorkspaces(): WorkspaceSummaryDto[] {
      return Array.from(state.workspaces.values()).map((workspace) => summarizeWorkspace(workspace, listOrderedSessions(workspace.id)));
    },

    getWorkspaceDetail,

    getWorkspaceSessions(workspaceId: string): SessionsListDto | undefined {
      const workspace = state.workspaces.get(workspaceId);
      if (workspace === undefined) {
        return undefined;
      }

      return {
        workspaceId,
        sessions: listOrderedSessions(workspaceId),
      };
    },

    getSessionWorkspaceId(sessionId: string): string | undefined {
      return findSession(sessionId)?.workspaceId;
    },

    createWorkspace(input: CreateWorkspaceDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] } {
      state.workspaceCounter += 1;
      const createdAt = new Date().toISOString();
      const workspaceId = `ws-${state.workspaceCounter}`;
      const repoRoots: WorkspaceRepoRoot[] = (input.repoRoots ?? []).map((repoPath, index) => ({
        id: `repo-${state.repoCounter + index + 1}`,
        path: repoPath,
        name: repoPath.split("/").filter(Boolean).at(-1) ?? `repo-${index + 1}`,
      }));
      state.repoCounter += repoRoots.length;

      const workspace: Workspace = {
        id: workspaceId,
        name: input.name,
        description: input.description,
        repoRoots,
        worktrees: [],
        sessionIds: [],
        artifactIds: [],
        preferences: {},
        createdAt,
        updatedAt: createdAt,
      };

      state.workspaces.set(workspaceId, workspace);
      appendWorkspaceAttentionEvent(workspace, createdAt, "Workspace created", `Created workspace ${workspace.name}.`);
      return {
        detail: getWorkspaceDetail(workspaceId) as WorkspaceDetailDto,
        events: [{
          workspaceId,
          event: makeWorkspaceUpdatedEvent(workspaceId, createdAt),
        }],
      };
    },

    updateWorkspace(workspaceId: string, input: UpdateWorkspaceDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] } | undefined {
      const workspace = state.workspaces.get(workspaceId);
      if (workspace === undefined) {
        return undefined;
      }

      const updatedAt = new Date().toISOString();
      workspace.name = input.name ?? workspace.name;
      workspace.description = input.description ?? workspace.description;
      workspace.preferences = input.preferences === undefined
        ? workspace.preferences
        : { ...workspace.preferences, ...input.preferences };
      workspace.updatedAt = updatedAt;
      appendWorkspaceAttentionEvent(workspace, updatedAt, "Workspace updated", `Updated workspace ${workspace.name}.`);

      return {
        detail: getWorkspaceDetail(workspaceId) as WorkspaceDetailDto,
        events: [{
          workspaceId,
          event: makeWorkspaceUpdatedEvent(workspaceId, updatedAt),
        }],
      };
    },

    addWorkspaceRepo(workspaceId: string, input: AddWorkspaceRepoDto): { detail: WorkspaceDetailDto; events: DemoMutationEvent[] } | undefined {
      const workspace = state.workspaces.get(workspaceId);
      if (workspace === undefined) {
        return undefined;
      }

      state.repoCounter += 1;
      workspace.repoRoots.push({
        id: `repo-${state.repoCounter}`,
        path: input.path,
        name: input.name ?? input.path.split("/").filter(Boolean).at(-1) ?? `repo-${state.repoCounter}`,
        defaultBranch: input.defaultBranch,
      });

      const updatedAt = new Date().toISOString();
      workspace.updatedAt = updatedAt;
      appendWorkspaceAttentionEvent(workspace, updatedAt, "Workspace repo added", `Added repo ${input.name ?? input.path} to ${workspace.name}.`);
      return {
        detail: getWorkspaceDetail(workspaceId) as WorkspaceDetailDto,
        events: [{
          workspaceId,
          event: makeWorkspaceUpdatedEvent(workspaceId, updatedAt),
        }],
      };
    },

    createWorkspaceSession(workspaceId: string, input: CreateSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const workspace = state.workspaces.get(workspaceId);
      if (workspace === undefined) {
        return undefined;
      }

      state.sessionCounter += 1;
      const acceptedAt = new Date().toISOString();
      const sessionId = `ses-${state.sessionCounter}`;
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
        currentActivity: "Queued in deterministic demo runtime.",
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

      workspace.sessionIds.push(sessionId);
      state.sessions.set(sessionId, session);
      touchWorkspace(workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Session created", `Accepted session request for ${input.task}.`, "operator");

      const events: DemoMutationEvent[] = [
        { workspaceId, event: makeWorkspaceUpdatedEvent(workspaceId, acceptedAt) },
        { workspaceId, event: makeStatusChangedEvent(workspaceId, sessionId, session.status, acceptedAt) },
        { workspaceId, event: makeSummaryUpdatedEvent(session, acceptedAt) },
      ];

      for (const artifactId of session.linkedResources.artifactIds) {
        events.push({ workspaceId, event: makeArtifactLinkedEvent(workspaceId, artifactId, acceptedAt, sessionId) });
      }

      return {
        response: createAcceptedResponse(acceptedAt),
        events,
      };
    },

    steerSession(sessionId: string, input: SteerSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.lastIntervention = {
        kind: "steer",
        status: "accepted-locally",
        text: input.text,
        requestedAt: acceptedAt,
      };
      session.status = "running";
      session.liveSummary = input.text;
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Steer request accepted", input.text, "operator");

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [
          { workspaceId: session.workspaceId, event: makeInterventionEvent(session, acceptedAt) },
          { workspaceId: session.workspaceId, event: makeStatusChangedEvent(session.workspaceId, session.id, session.status, acceptedAt) },
          { workspaceId: session.workspaceId, event: makeSummaryUpdatedEvent(session, acceptedAt) },
        ],
      };
    },

    followUpSession(sessionId: string, input: FollowUpSessionDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.lastIntervention = {
        kind: "follow-up",
        status: "pending-observation",
        text: input.text,
        requestedAt: acceptedAt,
      };
      session.latestMeaningfulUpdate = input.text;
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Follow-up requested", input.text, "operator");

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [
          { workspaceId: session.workspaceId, event: makeInterventionEvent(session, acceptedAt) },
          { workspaceId: session.workspaceId, event: makeSummaryUpdatedEvent(session, acceptedAt) },
        ],
      };
    },

    abortSession(sessionId: string): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.lastIntervention = {
        kind: "abort",
        status: "accepted-locally",
        text: "Abort requested by operator.",
        requestedAt: acceptedAt,
      };
      session.status = "failed";
      session.latestMeaningfulUpdate = "Abort requested by operator.";
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Abort requested", "Abort requested by operator.", "operator");

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [
          { workspaceId: session.workspaceId, event: makeInterventionEvent(session, acceptedAt) },
          { workspaceId: session.workspaceId, event: makeStatusChangedEvent(session.workspaceId, session.id, session.status, acceptedAt) },
        ],
      };
    },

    pinSessionSummary(sessionId: string, input: PinSummaryDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.pinnedSummary = input.summary;
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Pinned summary updated", input.summary ?? "Cleared the pinned summary.", "operator", false);

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [{
          workspaceId: session.workspaceId,
          event: makeSummaryUpdatedEvent(session, acceptedAt),
        }],
      };
    },

    openSessionPath(sessionId: string, input: OpenPathDto): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.recentFiles = [
        {
          path: input.path,
          operation: "edited" as const,
          timestamp: acceptedAt,
        },
        ...session.recentFiles,
      ].slice(0, 10);
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Recent file opened", input.path, "system", false);

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [{
          workspaceId: session.workspaceId,
          event: makeRecentFilesEvent(session, acceptedAt),
        }],
      };
    },

    runSessionShell(sessionId: string, command: string): { response: MutationResponseDto; events: DemoMutationEvent[] } | undefined {
      const session = findSession(sessionId);
      if (session === undefined) {
        return undefined;
      }

      const acceptedAt = new Date().toISOString();
      session.currentActivity = `Shell fallback requested: ${command}`;
      session.liveSummary = `Shell fallback queued: ${command}`;
      session.updatedAt = acceptedAt;
      touchWorkspace(session.workspaceId, acceptedAt);
      appendAttentionEvent(session, acceptedAt, "Shell fallback requested", command, "operator");

      return {
        response: createAcceptedResponse(acceptedAt),
        events: [{
          workspaceId: session.workspaceId,
          event: makeSummaryUpdatedEvent(session, acceptedAt),
        }],
      };
    },
  };
}

export function listDemoWorkspaceSummaries(): WorkspaceSummaryDto[] {
  return createDemoStateStore().listWorkspaces();
}

export function getDemoWorkspaceDetail(workspaceId: string): WorkspaceDetailDto | undefined {
  return createDemoStateStore().getWorkspaceDetail(workspaceId);
}

export function getDemoWorkspaceSessions(workspaceId: string): SessionsListDto | undefined {
  return createDemoStateStore().getWorkspaceSessions(workspaceId);
}
