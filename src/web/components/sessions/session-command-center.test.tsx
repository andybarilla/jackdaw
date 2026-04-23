import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { AttentionEvent } from "../../../shared/domain/attention.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import type { Workspace } from "../../../shared/domain/workspace.js";
import { SessionCommandCenter } from "./session-command-center.js";
import type { WorkspaceActionHandlers, WorkspaceActionResult } from "../../hooks/useWorkspaceActions.js";

const WORKSPACE: Workspace = {
  id: "ws-demo",
  name: "Demo Workspace",
  description: "Command center workspace",
  repoRoots: [{ id: "repo-1", path: "/repos/jackdaw", name: "jackdaw", defaultBranch: "main" }],
  worktrees: [{ id: "wt-1", repoRootId: "repo-1", path: "/worktrees/jackdaw-live", branch: "feat/live", label: "Live" }],
  sessionIds: ["session-1"],
  artifactIds: ["artifact-plan", "artifact-review"],
  preferences: { attentionView: "all", detailView: "summary", selectedSessionId: "session-1" },
  createdAt: "2026-04-23T11:00:00.000Z",
  updatedAt: "2026-04-23T12:00:00.000Z",
};

const SESSION: WorkspaceSession = {
  id: "session-1",
  workspaceId: "ws-demo",
  name: "Implement command center",
  repoRoot: "/repos/jackdaw",
  worktree: "/worktrees/jackdaw-live",
  cwd: "/worktrees/jackdaw-live",
  branch: "feat/live",
  runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
  status: "awaiting-input",
  liveSummary: "The live summary is current.",
  pinnedSummary: "Pinned before the latest runtime update.",
  latestMeaningfulUpdate: "Added the command center shell.",
  currentActivity: "Waiting for operator confirmation",
  currentTool: "chat",
  lastIntervention: {
    kind: "follow-up",
    status: "pending-observation",
    text: "Confirm the final command center actions",
    requestedAt: "2026-04-23T11:45:00.000Z",
  },
  recentFiles: [
    { path: "src/web/App.tsx", operation: "edited", timestamp: "2026-04-23T11:41:00.000Z" },
    { path: "src/web/components/sessions/session-command-center.tsx", operation: "created", timestamp: "2026-04-23T11:42:00.000Z" },
  ],
  linkedResources: {
    artifactIds: ["artifact-plan", "artifact-review"],
    workItemIds: ["task-8"],
    reviewIds: ["review-17"],
    hqWorkItemId: "hq-321",
  },
  connectionState: "live",
  sessionFile: ".jackdaw/session-1.json",
  startedAt: "2026-04-23T11:10:00.000Z",
  updatedAt: "2026-04-23T11:50:00.000Z",
};

const ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: "artifact-plan",
    workspaceId: "ws-demo",
    kind: "plan",
    title: "Workspace GUI successor plan",
    filePath: "docs/superpowers/plans/2026-04-17-workspace-gui-successor.md",
    linkedSessionIds: ["session-1"],
    linkedWorkItemIds: ["task-8"],
    createdAt: "2026-04-23T11:20:00.000Z",
    updatedAt: "2026-04-23T11:20:00.000Z",
  },
  {
    id: "artifact-review",
    workspaceId: "ws-demo",
    kind: "review-report",
    title: "Task 8 review state",
    filePath: "reviews/task-8.md",
    linkedSessionIds: ["session-1"],
    linkedWorkItemIds: [],
    createdAt: "2026-04-23T11:30:00.000Z",
    updatedAt: "2026-04-23T11:40:00.000Z",
  },
];

const ATTENTION_EVENTS: AttentionEvent[] = [
  {
    id: "attention-1",
    sessionId: "session-1",
    workspaceId: "ws-demo",
    band: "needs-operator",
    title: "Operator input required",
    detail: "Confirm the final command center actions",
    occurredAt: "2026-04-23T11:45:00.000Z",
    source: "operator",
    meaningful: true,
  },
  {
    id: "attention-2",
    sessionId: "session-1",
    workspaceId: "ws-demo",
    band: "active",
    title: "Latest meaningful update",
    detail: "Added the command center shell.",
    occurredAt: "2026-04-23T11:44:00.000Z",
    source: "runtime",
    meaningful: true,
  },
];

function createSuccessResult(message: string): WorkspaceActionResult {
  return {
    ok: true,
    acceptedAt: "2026-04-23T11:55:00.000Z",
    message,
    mode: "remote",
  };
}

function createActions(): WorkspaceActionHandlers {
  return {
    spawnSession: vi.fn(async () => createSuccessResult("spawned")),
    steerSession: vi.fn(async () => createSuccessResult("steered")),
    followUpSession: vi.fn(async () => createSuccessResult("followed up")),
    abortSession: vi.fn(async () => createSuccessResult("aborted")),
    pinSummary: vi.fn(async () => createSuccessResult("pinned")),
    openPath: vi.fn(async () => createSuccessResult("opened")),
    shellFallback: vi.fn(async () => createSuccessResult("shell")),
  };
}

function createDeferredResult(): {
  promise: Promise<WorkspaceActionResult>;
  resolve: (result: WorkspaceActionResult) => void;
} {
  let resolvePromise: ((result: WorkspaceActionResult) => void) | undefined;
  const promise = new Promise<WorkspaceActionResult>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (result: WorkspaceActionResult) => {
      resolvePromise?.(result);
    },
  };
}

describe("SessionCommandCenter", () => {
  it("opens the first file-backed linked artifact when earlier linked artifacts have no file path", async () => {
    const actions = createActions();
    const artifacts: WorkspaceArtifact[] = [
      {
        id: "artifact-review",
        workspaceId: "ws-demo",
        kind: "review-report",
        title: "Task 8 review state",
        filePath: "reviews/task-8.md",
        linkedSessionIds: ["session-1"],
        linkedWorkItemIds: [],
        createdAt: "2026-04-23T11:30:00.000Z",
        updatedAt: "2026-04-23T11:40:00.000Z",
      },
      {
        id: "artifact-plan",
        workspaceId: "ws-demo",
        kind: "plan",
        title: "Workspace GUI successor plan",
        linkedSessionIds: ["session-1"],
        linkedWorkItemIds: ["task-8"],
        createdAt: "2026-04-23T11:20:00.000Z",
        updatedAt: "2026-04-23T11:20:00.000Z",
      },
      {
        id: "artifact-spec",
        workspaceId: "ws-demo",
        kind: "spec",
        title: "Session command center spec",
        filePath: "docs/specs/session-command-center.md",
        linkedSessionIds: ["session-1"],
        linkedWorkItemIds: ["task-8"],
        createdAt: "2026-04-23T11:10:00.000Z",
        updatedAt: "2026-04-23T11:15:00.000Z",
      },
    ];

    render(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={{
          ...SESSION,
          linkedResources: {
            ...SESSION.linkedResources,
            artifactIds: ["artifact-plan", "artifact-spec", "artifact-review"],
          },
        }}
        artifacts={artifacts}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    const openLinkedArtifactButton = screen.getByRole("button", { name: "Open linked artifact" });
    expect(openLinkedArtifactButton).toBeEnabled();

    fireEvent.click(openLinkedArtifactButton);

    await waitFor(() => {
      expect(actions.openPath).toHaveBeenCalledWith(
        { workspaceId: "ws-demo", path: "docs/specs/session-command-center.md" },
        "session-1",
      );
    });
  });

  it("renders understanding and intervention context in one screen", () => {
    const actions = createActions();

    render(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={SESSION}
        artifacts={ARTIFACTS}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    const commandCenter = screen.getByLabelText("Session command center");
    expect(within(commandCenter).getByRole("heading", { name: "Implement command center" })).toBeVisible();
    expect(within(commandCenter).getByText("The live summary is current.")).toBeVisible();
    expect(within(commandCenter).getByText("Pinned before the latest runtime update.")).toBeVisible();
    expect(within(commandCenter).getByText("Waiting for operator confirmation")).toBeVisible();
    expect(within(commandCenter).getByText("Added the command center shell.")).toBeVisible();
    expect(within(commandCenter).getByText("Operator input required")).toBeVisible();
    expect(within(commandCenter).getByText(/src\/web\/App\.tsx · edited/)).toBeVisible();
    expect(within(commandCenter).getByText(/plan · Workspace GUI successor plan/)).toBeVisible();
    expect(within(commandCenter).getByText("task-8")).toBeVisible();
    expect(within(commandCenter).getByText("review-17")).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Spawn session" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Steer" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Follow-up" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Abort" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Open repo" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Open worktree" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Open linked artifact" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Pin summary" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Refresh summary" })).toBeVisible();
    expect(within(commandCenter).getByRole("button", { name: "Shell fallback" })).toBeVisible();
  });

  it("freezes the pinned summary snapshot when pinning and preserves it across live summary updates", async () => {
    const actions = createActions();
    const { rerender } = render(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={{ ...SESSION, pinnedSummary: undefined, liveSummary: "Original live summary." }}
        artifacts={ARTIFACTS}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pin summary" }));

    await waitFor(() => {
      expect(actions.pinSummary).toHaveBeenCalledWith({ sessionId: "session-1", summary: "Original live summary." });
    });

    const pinnedPanelBeforeUpdate = screen.getByLabelText("Pinned summary panel");
    expect(within(pinnedPanelBeforeUpdate).getByText("Original live summary.")).toBeVisible();

    rerender(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={{ ...SESSION, pinnedSummary: undefined, liveSummary: "Updated live summary after more work." }}
        artifacts={ARTIFACTS}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    const pinnedPanel = screen.getByLabelText("Pinned summary panel");
    expect(within(pinnedPanel).getByText("Original live summary.")).toBeVisible();
    expect(screen.getByLabelText("Live summary panel")).toHaveTextContent("Updated live summary after more work.");
  });

  it("replaces the pinned summary with the current live summary when refresh summary is clicked", async () => {
    const actions = createActions();

    render(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={SESSION}
        artifacts={ARTIFACTS}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh summary" }));

    await waitFor(() => {
      expect(actions.pinSummary).toHaveBeenCalledWith({ sessionId: "session-1", summary: "The live summary is current." });
    });

    const pinnedPanel = screen.getByLabelText("Pinned summary panel");
    expect(within(pinnedPanel).getByText("The live summary is current.")).toBeVisible();
    expect(screen.getByText("Pinned summary replaced: The live summary is current.")).toBeVisible();
  });

  it("ignores stale pin summary completions after switching sessions", async () => {
    const deferredResult = createDeferredResult();
    const actions = createActions();
    actions.pinSummary = vi.fn(async () => deferredResult.promise);
    const secondSession: WorkspaceSession = {
      ...SESSION,
      id: "session-2",
      name: "Review another session",
      pinnedSummary: "Pinned summary for session B.",
      liveSummary: "Session B live summary.",
      updatedAt: "2026-04-23T12:15:00.000Z",
    };
    const { rerender } = render(
      <SessionCommandCenter
        workspace={WORKSPACE}
        session={SESSION}
        artifacts={ARTIFACTS}
        recentAttention={ATTENTION_EVENTS}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pin summary" }));

    await act(async () => {
      rerender(
        <SessionCommandCenter
          workspace={WORKSPACE}
          session={secondSession}
          artifacts={ARTIFACTS}
          recentAttention={ATTENTION_EVENTS}
          actions={actions}
        />,
      );
    });

    await act(async () => {
      deferredResult.resolve(createSuccessResult("stale pin result"));
      await deferredResult.promise;
    });

    const pinnedPanel = screen.getByLabelText("Pinned summary panel");
    expect(within(pinnedPanel).getByText("Pinned summary for session B.")).toBeVisible();
    expect(screen.queryByText("Pinned summary frozen: The live summary is current.")).toBeNull();
    expect(screen.queryByText("stale pin result")).toBeNull();
  });
});
