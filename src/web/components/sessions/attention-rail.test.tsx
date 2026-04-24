import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import { AttentionRail } from "./attention-rail.js";

const SESSIONS: WorkspaceSession[] = [
  {
    id: "session-awaiting",
    workspaceId: "ws-demo",
    name: "Operator follow-up",
    repoRoot: "/repos/jackdaw",
    worktree: "/worktrees/jackdaw-live",
    cwd: "/repos/jackdaw",
    branch: "feat/live-workspace",
    runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
    status: "awaiting-input",
    liveSummary: "Waiting for product direction.",
    pinnedSummary: "Need approval before continuing.",
    latestMeaningfulUpdate: "Waiting for product direction.",
    currentActivity: "Paused for operator reply",
    recentFiles: [
      { path: "src/web/App.tsx", operation: "edited", timestamp: "2026-04-23T11:35:00.000Z" },
      { path: "src/service/server.ts", operation: "edited", timestamp: "2026-04-23T11:36:00.000Z" },
    ],
    linkedResources: { artifactIds: ["artifact-1"], workItemIds: ["task-7"], reviewIds: [] },
    lastIntervention: {
      kind: "follow-up",
      status: "pending-observation",
      text: "Confirm API contract changes",
      requestedAt: "2026-04-23T11:40:00.000Z",
    },
    connectionState: "live",
    updatedAt: "2026-04-23T11:45:00.000Z",
  },
  {
    id: "session-running",
    workspaceId: "ws-demo",
    name: "Service read model",
    repoRoot: "/repos/hq",
    cwd: "/repos/hq",
    branch: "feat/service-read-model",
    runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
    status: "running",
    liveSummary: "Implementing deterministic service fixtures.",
    latestMeaningfulUpdate: "Implementing deterministic service fixtures.",
    currentActivity: "Editing demo-state.ts",
    recentFiles: [{ path: "src/service/demo-state.ts", operation: "edited", timestamp: "2026-04-23T11:50:00.000Z" }],
    linkedResources: { artifactIds: [], workItemIds: ["task-8"], reviewIds: [] },
    connectionState: "live",
    updatedAt: "2026-04-23T11:55:00.000Z",
  },
];

const ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: "artifact-1",
    workspaceId: "ws-demo",
    kind: "plan",
    title: "Workspace GUI successor plan",
    filePath: "docs/superpowers/plans/2026-04-17-workspace-gui-successor.md",
    linkedSessionIds: ["session-awaiting"],
    linkedWorkItemIds: ["task-7"],
    createdAt: "2026-04-23T11:20:00.000Z",
    updatedAt: "2026-04-23T11:20:00.000Z",
  },
];

describe("AttentionRail", () => {
  it("renders explicit operator-facing session context without relying on color", () => {
    render(
      <AttentionRail
        sessions={SESSIONS}
        artifacts={ARTIFACTS}
        selectedSessionId="session-awaiting"
        onSelectSession={vi.fn()}
      />,
    );

    const needsOperatorGroup = screen.getByLabelText("Needs operator sessions");
    expect(within(needsOperatorGroup).getByText("Needs operator · Awaiting input")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Why it needs attention")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Current activity")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Latest update")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Repo context")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Recent files")).toBeVisible();
    expect(within(needsOperatorGroup).getByText("Linked work")).toBeVisible();
    expect(within(needsOperatorGroup).getByText(/Confirm API contract changes/)).toBeVisible();
    expect(within(needsOperatorGroup).getByText(/src\/web\/App\.tsx · edited/)).toBeVisible();
    expect(within(needsOperatorGroup).getByText(/plan · Workspace GUI successor plan/)).toBeVisible();
  });

  it("calls onSelectSession when an operator chooses a different session", () => {
    const onSelectSession = vi.fn();
    render(
      <AttentionRail
        sessions={SESSIONS}
        artifacts={ARTIFACTS}
        selectedSessionId="session-awaiting"
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Service read model/ }));

    expect(onSelectSession).toHaveBeenCalledWith("session-running");
  });
});
