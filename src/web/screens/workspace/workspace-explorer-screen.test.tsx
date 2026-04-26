import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDetailDto } from "../../../shared/transport/dto.js";
import type { ApiClient } from "../../lib/api-client.js";
import { WorkspaceExplorerScreen } from "./workspace-explorer-screen.js";

const WORKSPACE_DETAIL: WorkspaceDetailDto = {
  workspace: {
    id: "ws-demo",
    name: "Demo Workspace",
    repoRoots: [{ id: "repo-1", path: "/workspace/jackdaw", name: "jackdaw", defaultBranch: "main" }],
    worktrees: [],
    sessionIds: [],
    artifactIds: [],
    preferences: {},
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z",
  },
  sessions: [],
  artifacts: [],
  recentAttention: [],
};

function createApiClient(): ApiClient {
  return {
    serviceBaseUrl: "http://127.0.0.1:7345",
    getHealth: vi.fn(),
    listWorkspaces: vi.fn(),
    getWorkspaceDetail: vi.fn(),
    updateWorkspace: vi.fn(),
    addWorkspaceWorktree: vi.fn(async () => ({
      ...WORKSPACE_DETAIL,
      workspace: {
        ...WORKSPACE_DETAIL.workspace,
        worktrees: [{
          id: "wt-1",
          repoRootId: "repo-1",
          path: "/workspace/jackdaw/.worktrees/task-10",
          branch: "task-10",
          label: "Task 10",
        }],
      },
    })),
    listWorkspaceArtifacts: vi.fn(),
    getArtifactDetail: vi.fn(),
    getIntegrationSettings: vi.fn(),
  } as ApiClient;
}

describe("WorkspaceExplorerScreen", () => {
  it("registers a worktree through the workspace transport API", async () => {
    const apiClient = createApiClient();
    render(
      <WorkspaceExplorerScreen
        apiClient={apiClient}
        detail={WORKSPACE_DETAIL}
        onBackToSessions={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    );

    const form = screen.getByRole("form", { name: "Register worktree" });
    fireEvent.change(within(form).getByLabelText("Worktree path"), { target: { value: "/workspace/jackdaw/.worktrees/task-10" } });
    fireEvent.change(within(form).getByLabelText("Branch"), { target: { value: "task-10" } });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "Task 10" } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(apiClient.addWorkspaceWorktree).toHaveBeenCalledWith("ws-demo", {
        repoRootId: "repo-1",
        path: "/workspace/jackdaw/.worktrees/task-10",
        branch: "task-10",
        label: "Task 10",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Worktree registered");
  });
});
