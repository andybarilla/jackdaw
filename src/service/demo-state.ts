import {
  compareAttentionCandidates,
  createAttentionCandidate,
  type AttentionEvent,
} from "../shared/domain/attention.js";
import type { WorkspaceArtifact } from "../shared/domain/artifact.js";
import type { WorkspaceSession } from "../shared/domain/session.js";
import type { Workspace } from "../shared/domain/workspace.js";
import type {
  SessionsListDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
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

function listOrderedSessions(): WorkspaceSession[] {
  const sessionById: Map<string, WorkspaceSession> = new Map<string, WorkspaceSession>();
  for (const session of DEMO_SESSIONS) {
    sessionById.set(session.id, session);
  }

  return DEMO_SESSIONS
    .map((session: WorkspaceSession, index: number) => ({
      candidate: createAttentionCandidate(session, index),
      session,
    }))
    .sort((left, right) => compareAttentionCandidates(left.candidate, right.candidate))
    .map(({ session }: { session: WorkspaceSession }) => sessionById.get(session.id) ?? session);
}

export function listDemoWorkspaceSummaries(): WorkspaceSummaryDto[] {
  const sessions: WorkspaceSession[] = listOrderedSessions();
  return [summarizeWorkspace(DEMO_WORKSPACE, sessions)];
}

export function getDemoWorkspaceDetail(workspaceId: string): WorkspaceDetailDto | undefined {
  if (workspaceId !== DEMO_WORKSPACE_ID) {
    return undefined;
  }

  return {
    workspace: DEMO_WORKSPACE,
    sessions: listOrderedSessions(),
    artifacts: DEMO_ARTIFACTS,
    recentAttention: DEMO_ATTENTION_EVENTS,
  };
}

export function getDemoWorkspaceSessions(workspaceId: string): SessionsListDto | undefined {
  if (workspaceId !== DEMO_WORKSPACE_ID) {
    return undefined;
  }

  return {
    workspaceId: DEMO_WORKSPACE_ID,
    sessions: listOrderedSessions(),
  };
}
