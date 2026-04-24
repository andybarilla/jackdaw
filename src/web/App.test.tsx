import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { HealthResponse } from "../shared/transport/api.js";
import type { WorkspaceDetailDto, WorkspaceSummaryDto } from "../shared/transport/dto.js";

const HEALTH_RESPONSE: HealthResponse = {
  ok: true,
  service: "jackdaw-service",
  version: "0.1.0",
  appDataDir: "/tmp/jackdaw",
  timestamp: "2026-04-23T12:00:00.000Z",
};

const WORKSPACE_SUMMARIES: WorkspaceSummaryDto[] = [
  {
    id: "ws-demo",
    name: "Demo Workspace",
    description: "Read-only demo workspace",
    repoRootCount: 2,
    worktreeCount: 1,
    sessionCount: 3,
    attentionBand: "needs-operator",
    updatedAt: "2026-04-23T12:00:00.000Z",
  },
  {
    id: "ws-ops",
    name: "Ops Workspace",
    description: "Secondary operations workspace",
    repoRootCount: 1,
    worktreeCount: 1,
    sessionCount: 2,
    attentionBand: "active",
    updatedAt: "2026-04-23T12:10:00.000Z",
  },
];

const WORKSPACE_DETAIL: WorkspaceDetailDto = {
  workspace: {
    id: "ws-demo",
    name: "Demo Workspace",
    description: "Read-only demo workspace",
    repoRoots: [
      { id: "repo-1", path: "/repos/jackdaw", name: "jackdaw", defaultBranch: "main" },
      { id: "repo-2", path: "/repos/hq", name: "hq", defaultBranch: "main" },
    ],
    worktrees: [{ id: "wt-1", repoRootId: "repo-1", path: "/worktrees/jackdaw-live", branch: "feat/live" }],
    sessionIds: ["session-awaiting", "session-running", "session-idle"],
    artifactIds: ["artifact-1"],
    preferences: { selectedSessionId: "session-missing", attentionView: "all", detailView: "summary" },
    optionalIntegrations: { hqProjectId: "hq-123" },
    createdAt: "2026-04-23T11:00:00.000Z",
    updatedAt: "2026-04-23T12:00:00.000Z",
  },
  sessions: [
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
      currentTool: "chat",
      lastIntervention: {
        kind: "follow-up",
        status: "pending-observation",
        text: "Confirm API contract changes",
        requestedAt: "2026-04-23T11:40:00.000Z",
      },
      recentFiles: [
        { path: "src/web/App.tsx", operation: "edited", timestamp: "2026-04-23T11:35:00.000Z" },
        { path: "src/service/server.ts", operation: "edited", timestamp: "2026-04-23T11:36:00.000Z" },
      ],
      linkedResources: { artifactIds: ["artifact-1"], workItemIds: ["task-8"], reviewIds: ["review-1"] },
      connectionState: "live",
      sessionFile: ".jackdaw/session-awaiting.json",
      startedAt: "2026-04-23T11:00:00.000Z",
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
      currentTool: "edit",
      recentFiles: [
        { path: "src/service/demo-state.ts", operation: "edited", timestamp: "2026-04-23T11:50:00.000Z" },
      ],
      linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
      connectionState: "live",
      startedAt: "2026-04-23T11:10:00.000Z",
      updatedAt: "2026-04-23T11:55:00.000Z",
    },
    {
      id: "session-idle",
      workspaceId: "ws-demo",
      name: "Archive cleanup",
      repoRoot: "/repos/jackdaw",
      cwd: "/repos/jackdaw/docs",
      branch: "chore/archive-cleanup",
      runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
      status: "idle",
      liveSummary: "Cleanup complete.",
      latestMeaningfulUpdate: "Cleanup complete.",
      currentActivity: "Waiting for next task",
      recentFiles: [],
      linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
      connectionState: "historical",
      startedAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:45:00.000Z",
      completedAt: "2026-04-23T10:50:00.000Z",
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      workspaceId: "ws-demo",
      kind: "plan",
      title: "Live workspace slice plan",
      filePath: "docs/superpowers/plans/2026-04-23-service-backed-live-workspace.md",
      sourceSessionId: "session-awaiting",
      linkedSessionIds: ["session-awaiting"],
      linkedWorkItemIds: ["task-8"],
      createdAt: "2026-04-23T11:20:00.000Z",
      updatedAt: "2026-04-23T11:20:00.000Z",
    },
  ],
  recentAttention: [
    {
      id: "attention-1",
      sessionId: "session-awaiting",
      workspaceId: "ws-demo",
      band: "needs-operator",
      title: "Operator input required",
      detail: "Confirm API contract changes",
      occurredAt: "2026-04-23T11:40:00.000Z",
      source: "operator",
      meaningful: true,
    },
  ],
};

const OPS_WORKSPACE_DETAIL: WorkspaceDetailDto = {
  ...WORKSPACE_DETAIL,
  workspace: {
    ...WORKSPACE_DETAIL.workspace,
    id: "ws-ops",
    name: "Ops Workspace",
    description: "Secondary operations workspace",
    repoRoots: [{ id: "repo-ops", path: "/repos/ops", name: "ops", defaultBranch: "main" }],
    worktrees: [{ id: "wt-ops", repoRootId: "repo-ops", path: "/worktrees/ops-live", branch: "ops/live" }],
    sessionIds: ["ops-awaiting", "ops-idle"],
    artifactIds: [],
    preferences: { selectedSessionId: "session-running", attentionView: "all", detailView: "summary" },
    optionalIntegrations: { hqProjectId: "hq-ops" },
    updatedAt: "2026-04-23T12:10:00.000Z",
  },
  sessions: [
    {
      ...WORKSPACE_DETAIL.sessions[0],
      id: "ops-awaiting",
      workspaceId: "ws-ops",
      name: "Ops operator follow-up",
      repoRoot: "/repos/ops",
      cwd: "/repos/ops",
      branch: "ops/handoff",
      liveSummary: "Waiting on rollout approval.",
      pinnedSummary: "Need release sign-off.",
      latestMeaningfulUpdate: "Waiting on rollout approval.",
      currentActivity: "Paused for operations review",
      recentFiles: [{ path: "ops/runbook.md", operation: "edited", timestamp: "2026-04-23T12:05:00.000Z" }],
      linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
      lastIntervention: {
        kind: "follow-up",
        status: "pending-observation",
        text: "Approve the rollout window",
        requestedAt: "2026-04-23T12:04:00.000Z",
      },
    },
    {
      ...WORKSPACE_DETAIL.sessions[2],
      id: "ops-idle",
      workspaceId: "ws-ops",
      name: "Ops cleanup",
      repoRoot: "/repos/ops",
      cwd: "/repos/ops/docs",
      branch: "ops/cleanup",
      liveSummary: "Ops notes archived.",
      latestMeaningfulUpdate: "Ops notes archived.",
    },
  ],
  artifacts: [],
  recentAttention: [
    {
      id: "attention-ops-1",
      sessionId: "ops-awaiting",
      workspaceId: "ws-ops",
      band: "needs-operator",
      title: "Ops approval required",
      detail: "Approve the rollout window",
      occurredAt: "2026-04-23T12:04:00.000Z",
      source: "operator",
      meaningful: true,
    },
  ],
};

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockFetchImplementation(overrides?: {
  workspacesResponse?: Response;
  workspaceDetailResponses?: Record<string, Response>;
}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (init?.method === "POST") {
      return createJsonResponse({ error: "Mutation route unavailable" }, { status: 405 });
    }

    if (url.endsWith("/health")) {
      return createJsonResponse(HEALTH_RESPONSE, { status: 200 });
    }

    if (url.endsWith("/workspaces")) {
      return overrides?.workspacesResponse ?? createJsonResponse(WORKSPACE_SUMMARIES, { status: 200 });
    }

    const detailUrlMatch = url.match(/\/workspaces\/([^/]+)$/);
    if (detailUrlMatch !== null) {
      const workspaceId = detailUrlMatch[1];
      const workspaceDetailResponse = overrides?.workspaceDetailResponses?.[workspaceId];
      if (workspaceDetailResponse !== undefined) {
        return workspaceDetailResponse;
      }

      if (workspaceId === "ws-demo") {
        return createJsonResponse(WORKSPACE_DETAIL, { status: 200 });
      }

      if (workspaceId === "ws-ops") {
        return createJsonResponse(OPS_WORKSPACE_DETAIL, { status: 200 });
      }
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders both health and workspace loading states before fetches resolve", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));

    render(<App />);

    expect(screen.getByText("Checking local orchestration service…")).toBeVisible();
    expect(screen.getByText("Loading workspace…")).toBeVisible();
  });

  it("renders the fetched workspace, keeps rail order, and shows the command center for the first ordered session", async () => {
    mockFetchImplementation();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Demo Workspace" })).toBeVisible();
    const attentionRail = await screen.findByRole("list", { name: "Attention rail" });

    const sessionButtons = within(attentionRail).getAllByRole("button");
    expect(sessionButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Operator follow-up"),
      expect.stringContaining("Service read model"),
      expect.stringContaining("Archive cleanup"),
    ]);

    const firstSessionButton = within(attentionRail).getByRole("button", { name: /Operator follow-up/i });
    expect(firstSessionButton).toHaveAttribute("aria-pressed", "true");

    const detailPanel = screen.getByLabelText("Selected session detail panel");
    expect(within(detailPanel).getByLabelText("Session command center")).toBeVisible();
    expect(within(detailPanel).getByRole("heading", { name: "Operator follow-up" })).toBeVisible();
    expect(within(within(detailPanel).getByLabelText("Live summary panel")).getByText("Waiting for product direction.")).toBeVisible();
    expect(within(detailPanel).getByText("Need approval before continuing.")).toBeVisible();
    expect(within(detailPanel).getByText("Paused for operator reply")).toBeVisible();
    expect(within(detailPanel).getByText("Confirm API contract changes")).toBeVisible();
    expect(within(detailPanel).getByText(/plan · Live workspace slice plan/)).toBeVisible();
    expect(within(detailPanel).getByRole("button", { name: "Shell fallback" })).toBeVisible();
  });

  it("updates the selected row and command center when a different session is clicked", async () => {
    mockFetchImplementation();

    render(<App />);

    const attentionRail = await screen.findByRole("list", { name: "Attention rail" });
    const initialSelection = within(attentionRail).getByRole("button", { name: /Operator follow-up/i });
    const nextSelection = within(attentionRail).getByRole("button", { name: /Service read model/i });

    fireEvent.click(nextSelection);

    await waitFor(() => {
      expect(nextSelection).toHaveAttribute("aria-pressed", "true");
    });
    expect(initialSelection).toHaveAttribute("aria-pressed", "false");

    const detailPanel = screen.getByLabelText("Selected session detail panel");
    expect(within(detailPanel).getByRole("heading", { name: "Service read model" })).toBeVisible();
    expect(within(within(detailPanel).getByLabelText("Live summary panel")).getByText("Implementing deterministic service fixtures.")).toBeVisible();
    expect(within(detailPanel).getByText("Editing demo-state.ts")).toBeVisible();
    expect(within(detailPanel).getByText("src/service/demo-state.ts · edited")).toBeVisible();
  });

  it("falls back to the first session when the selected session disappears after a workspace change on the same mount", async () => {
    mockFetchImplementation({
      workspaceDetailResponses: {
        "ws-demo": createJsonResponse(WORKSPACE_DETAIL, { status: 200 }),
        "ws-ops": createJsonResponse(OPS_WORKSPACE_DETAIL, { status: 200 }),
      },
    });

    let selectedWorkspaceSetter: React.Dispatch<React.SetStateAction<string | undefined>> | undefined;
    const originalUseState = React.useState;
    let undefinedStateCount = 0;

    vi.spyOn(React, "useState").mockImplementation(((initialState?: unknown) => {
      const stateTuple = initialState === undefined ? originalUseState() : originalUseState(initialState);

      if (initialState === undefined) {
        undefinedStateCount += 1;
        if (undefinedStateCount === 1) {
          selectedWorkspaceSetter = stateTuple[1] as React.Dispatch<React.SetStateAction<string | undefined>>;
        }
      }

      return stateTuple;
    }) as typeof React.useState);

    render(<App />);

    if (selectedWorkspaceSetter === undefined) {
      throw new Error("Selected workspace setter was not captured");
    }

    expect(await screen.findByRole("heading", { name: "Demo Workspace" })).toBeVisible();

    const attentionRail = await screen.findByRole("list", { name: "Attention rail" });
    const preservedSelection = within(attentionRail).getByRole("button", { name: /Service read model/i });

    fireEvent.click(preservedSelection);

    await waitFor(() => {
      expect(preservedSelection).toHaveAttribute("aria-pressed", "true");
    });

    await act(async () => {
      selectedWorkspaceSetter?.("ws-ops");
    });

    expect(await screen.findByRole("heading", { name: "Ops Workspace" })).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Service read model/i })).not.toBeInTheDocument();
    });

    const refreshedAttentionRail = await screen.findByRole("list", { name: "Attention rail" });
    const fallbackSelection = within(refreshedAttentionRail).getByRole("button", { name: /Ops operator follow-up/i });

    expect(fallbackSelection).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Selected session detail panel")).toHaveTextContent("Need release sign-off.");
  });

  it("renders a workspace error card while health still loads normally when workspace fetch fails", async () => {
    mockFetchImplementation({
      workspacesResponse: createJsonResponse({ error: "Workspace fetch failed" }, { status: 500 }),
    });

    render(<App />);

    expect(await screen.findByText("Healthy")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace fetch failed");
  });
});
