import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { HealthResponse } from "../shared/transport/api.js";
import type { WorkspaceDetailDto, WorkspaceSummaryDto } from "../shared/transport/dto.js";

const HEALTH_RESPONSE: HealthResponse = {
  ok: true,
  service: "jackdaw-service",
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
    preferences: { selectedSessionId: "session-awaiting", attentionView: "all", detailView: "summary" },
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
      linkedResources: { artifactIds: ["artifact-1"], workItemIds: [], reviewIds: [] },
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
      linkedWorkItemIds: [],
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

const WORKSPACE_DETAIL_WITH_PREFERRED_RUNNING_SESSION: WorkspaceDetailDto = {
  ...WORKSPACE_DETAIL,
  workspace: {
    ...WORKSPACE_DETAIL.workspace,
    preferences: {
      ...WORKSPACE_DETAIL.workspace.preferences,
      selectedSessionId: "session-running",
    },
  },
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

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

  it("renders the fetched workspace, keeps rail order, and selects the first session by default", async () => {
    mockFetchImplementation();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Demo Workspace" })).toBeVisible();
    const attentionRail = await screen.findByRole("list", { name: "Attention rail" });

    expect(screen.queryByText("GUI foundation is live")).not.toBeInTheDocument();
    expect(screen.getByText("Read-only demo workspace")).toBeVisible();
    expect(screen.getByText("needs-operator")).toBeVisible();
    expect(screen.getByText("3 sessions")).toBeVisible();

    const sessionButtons = within(attentionRail).getAllByRole("button");
    expect(sessionButtons).toHaveLength(3);
    expect(sessionButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Operator follow-up"),
      expect.stringContaining("Service read model"),
      expect.stringContaining("Archive cleanup"),
    ]);

    const firstSessionButton = within(attentionRail).getByRole("button", { name: /Operator follow-up/i });
    expect(firstSessionButton).toHaveAttribute("aria-pressed", "true");

    const detailPanel = screen.getByLabelText("Selected session detail panel");
    expect(within(detailPanel).getByRole("heading", { name: "Operator follow-up" })).toBeVisible();
    expect(within(detailPanel).getAllByText("awaiting-input")).toHaveLength(2);
    expect(within(detailPanel).getByText("Waiting for product direction.")).toBeVisible();
    expect(within(detailPanel).getByText("Need approval before continuing.")).toBeVisible();
    expect(within(detailPanel).getAllByText("/repos/jackdaw")).toHaveLength(2);
    expect(within(detailPanel).getByText("feat/live-workspace")).toBeVisible();
    expect(within(detailPanel).getByText("Paused for operator reply")).toBeVisible();
    expect(within(detailPanel).getByText("chat")).toBeVisible();
    expect(within(detailPanel).getByText("src/web/App.tsx")).toBeVisible();
    expect(within(detailPanel).getByText("src/service/server.ts")).toBeVisible();
    expect(within(detailPanel).getByText("follow-up")).toBeVisible();
    expect(within(detailPanel).getByText("pending-observation")).toBeVisible();
    expect(within(detailPanel).getByText("Confirm API contract changes")).toBeVisible();
  });

  it("updates the selected row and detail panel when a different session is clicked", async () => {
    mockFetchImplementation();

    render(<App />);

    const attentionRail = await screen.findByRole("list", { name: "Attention rail" });
    const initialSelection = within(attentionRail).getByRole("button", { name: /Operator follow-up/i });
    const nextSelection = within(attentionRail).getByRole("button", { name: /Service read model/i });

    expect(initialSelection).toHaveAttribute("aria-pressed", "true");
    expect(nextSelection).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(nextSelection);

    await waitFor(() => {
      expect(nextSelection).toHaveAttribute("aria-pressed", "true");
    });
    expect(initialSelection).toHaveAttribute("aria-pressed", "false");

    const detailPanel = screen.getByLabelText("Selected session detail panel");
    expect(within(detailPanel).getByRole("heading", { name: "Service read model" })).toBeVisible();
    expect(within(detailPanel).getByText("Implementing deterministic service fixtures.")).toBeVisible();
    expect(within(detailPanel).getAllByText("/repos/hq")).toHaveLength(2);
    expect(within(detailPanel).getByText("feat/service-read-model")).toBeVisible();
    expect(within(detailPanel).getByText("Editing demo-state.ts")).toBeVisible();
    expect(within(detailPanel).getByText("edit")).toBeVisible();
    expect(within(detailPanel).getByText("src/service/demo-state.ts")).toBeVisible();
  });

  it("falls back to the first remaining session when the seeded preferred session is missing after a controlled remount", async () => {
    mockFetchImplementation({
      workspaceDetailResponses: {
        "ws-demo": createJsonResponse(WORKSPACE_DETAIL_WITH_PREFERRED_RUNNING_SESSION, { status: 200 }),
        "ws-ops": createJsonResponse(OPS_WORKSPACE_DETAIL, { status: 200 }),
      },
    });

    const firstRender = render(<App />);

    expect(await screen.findByRole("heading", { name: "Demo Workspace" })).toBeVisible();

    const firstAttentionRail = screen.getByRole("list", { name: "Attention rail" });
    const preferredSelection = within(firstAttentionRail).getByRole("button", { name: /Service read model/i });
    expect(preferredSelection).toHaveAttribute("aria-pressed", "true");

    firstRender.unmount();
    vi.restoreAllMocks();

    mockFetchImplementation({
      workspacesResponse: createJsonResponse([WORKSPACE_SUMMARIES[1], WORKSPACE_SUMMARIES[0]], { status: 200 }),
      workspaceDetailResponses: {
        "ws-demo": createJsonResponse(WORKSPACE_DETAIL_WITH_PREFERRED_RUNNING_SESSION, { status: 200 }),
        "ws-ops": createJsonResponse(OPS_WORKSPACE_DETAIL, { status: 200 }),
      },
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Ops Workspace" })).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Service read model/i })).not.toBeInTheDocument();
    });

    const refreshedAttentionRail = screen.getByRole("list", { name: "Attention rail" });
    const fallbackSelection = within(refreshedAttentionRail).getByRole("button", { name: /Ops operator follow-up/i });

    expect(fallbackSelection).toHaveAttribute("aria-pressed", "true");

    const detailPanel = screen.getByLabelText("Selected session detail panel");
    expect(within(detailPanel).getByRole("heading", { name: "Ops operator follow-up" })).toBeVisible();
    expect(within(detailPanel).getByText("Need release sign-off.")).toBeVisible();
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
