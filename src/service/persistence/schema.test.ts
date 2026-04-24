import { describe, expect, it } from "vitest";
import {
  createEmptyPersistedAppState,
  parsePersistedAppState,
  parsePersistedWorkspaceState,
  type PersistedAppState,
  type PersistedWorkspaceState,
} from "./schema.js";

const persistedWorkspaceState: PersistedWorkspaceState = {
  version: 1,
  workspace: {
    id: "ws-1",
    name: "Workspace 1",
    description: "Local workspace",
    repoRoots: [
      {
        id: "repo-1",
        path: "/repos/jackdaw",
        name: "jackdaw",
        defaultBranch: "main",
      },
    ],
    worktrees: [
      {
        id: "worktree-1",
        repoRootId: "repo-1",
        path: "/repos/jackdaw/.worktrees/task-3",
        branch: "task-3",
        label: "Task 3",
      },
    ],
    sessionIds: ["session-1"],
    artifactIds: ["artifact-1"],
    preferences: {
      selectedSessionId: "session-1",
      selectedArtifactId: "artifact-1",
      attentionView: "needs-operator",
      detailView: "artifacts",
    },
    optionalIntegrations: {
      hqProjectId: "hq-project-1",
      figmaFileKey: "figma-file-1",
    },
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T11:00:00.000Z",
  },
  sessions: [
    {
      id: "session-1",
      workspaceId: "ws-1",
      name: "Implement task 3",
      repoRoot: "/repos/jackdaw",
      worktree: "/repos/jackdaw/.worktrees/task-3",
      cwd: "/repos/jackdaw/.worktrees/task-3",
      branch: "task-3",
      runtime: {
        agent: "implementer",
        model: "sonnet",
        runtime: "pi",
      },
      status: "idle",
      liveSummary: "summary",
      recentFiles: [],
      linkedResources: {
        artifactIds: ["artifact-1"],
        workItemIds: ["task-3"],
        reviewIds: ["review-1"],
      },
      connectionState: "historical",
      pinnedSummary: "Pinned summary",
      reconnectNote: "Reconnect later",
      updatedAt: "2026-04-24T11:00:00.000Z",
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      workspaceId: "ws-1",
      kind: "plan",
      title: "Workspace plan",
      filePath: "docs/plan.md",
      sourceSessionId: "session-1",
      linkedSessionIds: ["session-1"],
      linkedWorkItemIds: ["task-3"],
      createdAt: "2026-04-24T10:30:00.000Z",
      updatedAt: "2026-04-24T11:00:00.000Z",
    },
  ],
};

const persistedAppState: PersistedAppState = {
  version: 1,
  selectedWorkspaceId: "ws-1",
  workspaces: [
    {
      id: "ws-1",
      name: "Workspace 1",
      description: "Local workspace",
      createdAt: "2026-04-24T10:00:00.000Z",
      updatedAt: "2026-04-24T11:00:00.000Z",
      lastOpenedAt: "2026-04-24T11:05:00.000Z",
    },
  ],
};

describe("service persistence schema", () => {
  it("creates an empty app state", () => {
    expect(createEmptyPersistedAppState()).toEqual({
      version: 1,
      workspaces: [],
    });
  });

  it("parses valid app state", () => {
    expect(parsePersistedAppState(persistedAppState)).toEqual(persistedAppState);
  });

  it("parses valid workspace state and preserves session and artifact links", () => {
    const session = {
      ...persistedWorkspaceState.sessions[0],
      status: "idle",
    };

    expect(parsePersistedWorkspaceState({
      ...persistedWorkspaceState,
      sessions: [session],
    })).toEqual({
      ...persistedWorkspaceState,
      sessions: [session],
    });
  });

  it("rejects malformed app state safely", () => {
    expect(() =>
      parsePersistedAppState({
        version: 1,
        workspaces: "oops",
      }),
    ).toThrow(/workspaces/i);
  });

  it("rejects malformed workspace state safely", () => {
    expect(() =>
      parsePersistedWorkspaceState({
        ...persistedWorkspaceState,
        sessions: [
          {
            ...persistedWorkspaceState.sessions[0],
            status: "offline",
          },
        ],
      }),
    ).toThrow(/status/i);
  });

  it("rejects workspace state when linked metadata does not match the workspace index", () => {
    const session = {
      ...persistedWorkspaceState.sessions[0],
      status: "idle",
    };

    expect(() =>
      parsePersistedWorkspaceState({
        ...persistedWorkspaceState,
        workspace: {
          ...persistedWorkspaceState.workspace,
          sessionIds: [],
        },
        sessions: [session],
      }),
    ).toThrow(/session-1/i);
  });
});
