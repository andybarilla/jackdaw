import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockFetchImplementation(overrides?: {
  workspacesResponse?: Response;
  workspaceDetailResponse?: Response;
}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return createJsonResponse(HEALTH_RESPONSE, { status: 200 });
    }

    if (url.endsWith("/workspaces")) {
      return overrides?.workspacesResponse ?? createJsonResponse(WORKSPACE_SUMMARIES, { status: 200 });
    }

    if (url.endsWith("/workspaces/ws-demo")) {
      return overrides?.workspaceDetailResponse ?? createJsonResponse(WORKSPACE_DETAIL, { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("App", () => {
  it("renders both health and workspace loading states before fetches resolve", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));

    render(<App />);

    expect(screen.getByText("Checking local orchestration service…")).toBeVisible();
    expect(screen.getByText("Loading workspace…")).toBeVisible();
  });

  it("renders the workspace, ordered sessions, and first-session details after successful fetches", async () => {
    mockFetchImplementation();

    render(<App />);

    expect(await screen.findByText("Demo Workspace")).toBeVisible();
    expect(screen.getByText("Operator follow-up")).toBeVisible();
    expect(screen.getByText("Service read model")).toBeVisible();
    expect(screen.getByText("Archive cleanup")).toBeVisible();
    expect(screen.getByText("Need approval before continuing.")).toBeVisible();
    expect(screen.getByText("Paused for operator reply")).toBeVisible();
    expect(screen.getByText("src/web/App.tsx")).toBeVisible();
  });

  it("updates the detail panel when a different session row is clicked", async () => {
    mockFetchImplementation();

    render(<App />);

    await screen.findByText("Demo Workspace");
    fireEvent.click(screen.getByText("Service read model"));

    await waitFor(() => {
      expect(screen.getByText("Implementing deterministic service fixtures.")).toBeVisible();
    });
    expect(screen.getByText("Editing demo-state.ts")).toBeVisible();
    expect(screen.getByText("src/service/demo-state.ts")).toBeVisible();
  });

  it("renders a workspace error card while health still loads normally when workspace fetch fails", async () => {
    mockFetchImplementation({
      workspacesResponse: createJsonResponse({ error: "Workspace fetch failed" }, { status: 500 }),
    });

    render(<App />);

    expect(await screen.findByText("Healthy")).toBeVisible();
    expect(await screen.findByText("Workspace fetch failed")).toBeVisible();
  });
});
