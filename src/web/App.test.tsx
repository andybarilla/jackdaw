import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
    sessionCount: 2,
    attentionBand: "needs-operator",
    updatedAt: "2026-04-23T12:00:00.000Z",
  },
  {
    id: "ws-ops",
    name: "Ops Workspace",
    description: "Secondary operations workspace",
    repoRootCount: 1,
    worktreeCount: 1,
    sessionCount: 1,
    attentionBand: "active",
    updatedAt: "2026-04-23T12:10:00.000Z",
  },
];

const WORKSPACE_DETAIL: WorkspaceDetailDto = {
  workspace: {
    id: "ws-demo",
    name: "Demo Workspace",
    description: "Read-only demo workspace",
    repoRoots: [{ id: "repo-1", path: "/repos/jackdaw", name: "jackdaw", defaultBranch: "main" }],
    worktrees: [{ id: "wt-1", repoRootId: "repo-1", path: "/worktrees/jackdaw-live", branch: "feat/live" }],
    sessionIds: ["session-awaiting", "session-running"],
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
      worktree: "/worktrees/jackdaw-live",
      cwd: "/repos/jackdaw",
      branch: "feat/live-workspace",
      runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
      status: "awaiting-input",
      liveSummary: "Waiting for product direction.",
      pinnedSummary: "Need approval before continuing.",
      latestMeaningfulUpdate: "Waiting for product direction.",
      currentActivity: "Paused for operator reply",
      recentFiles: [{ path: "src/web/App.tsx", operation: "edited", timestamp: "2026-04-23T11:35:00.000Z" }],
      linkedResources: { artifactIds: ["artifact-1"], workItemIds: ["task-7"], reviewIds: [] },
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
      recentFiles: [],
      linkedResources: { artifactIds: [], workItemIds: ["task-8"], reviewIds: [] },
      connectionState: "live",
      updatedAt: "2026-04-23T11:55:00.000Z",
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
      linkedWorkItemIds: ["task-7"],
      createdAt: "2026-04-23T11:20:00.000Z",
      updatedAt: "2026-04-23T11:20:00.000Z",
    },
  ],
  recentAttention: [],
};

const OPS_WORKSPACE_DETAIL: WorkspaceDetailDto = {
  ...WORKSPACE_DETAIL,
  workspace: {
    ...WORKSPACE_DETAIL.workspace,
    id: "ws-ops",
    name: "Ops Workspace",
    repoRoots: [{ id: "repo-ops", path: "/repos/ops", name: "ops", defaultBranch: "main" }],
    worktrees: [{ id: "wt-ops", repoRootId: "repo-ops", path: "/worktrees/ops-live", branch: "ops/live" }],
    sessionIds: ["ops-awaiting"],
    artifactIds: [],
    preferences: { selectedSessionId: "ops-awaiting", attentionView: "all", detailView: "summary" },
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
      linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
    },
  ],
  artifacts: [],
};

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

class MockEventSource implements EventTarget {
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
  close(): void {}
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function mockFetchImplementation(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return createJsonResponse(HEALTH_RESPONSE, { status: 200 });
    }

    if (url.endsWith("/workspaces")) {
      return createJsonResponse(WORKSPACE_SUMMARIES, { status: 200 });
    }

    if (url.endsWith("/workspaces/ws-demo")) {
      return createJsonResponse(WORKSPACE_DETAIL, { status: 200 });
    }

    if (url.endsWith("/workspaces/ws-ops")) {
      return createJsonResponse(OPS_WORKSPACE_DETAIL, { status: 200 });
    }

    throw new Error(`Unexpected fetch for ${url}`);
  });
}

describe("App", () => {
  it("redirects the default route to the first workspace home and renders the home screen", async () => {
    mockFetchImplementation();
    vi.stubGlobal("EventSource", MockEventSource);

    render(<App />);

    expect(await screen.findByText("Workspace home")).toBeVisible();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/workspaces/ws-demo");
    });
    expect(screen.getByText("What needs me right now?")).toBeVisible();
  });

  it("uses the workspace home route when a workspace path is already selected", async () => {
    window.history.replaceState({}, "", "/workspaces/ws-ops");
    mockFetchImplementation();
    vi.stubGlobal("EventSource", MockEventSource);

    render(<App />);

    expect(await screen.findByDisplayValue("Ops Workspace")).toBeVisible();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/workspaces/ws-ops");
    });
    const matches = await screen.findAllByText("Ops operator follow-up");
    expect(matches.length).toBeGreaterThan(0);
  });
});
