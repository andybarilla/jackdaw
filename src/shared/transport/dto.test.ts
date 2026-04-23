import { describe, expect, it } from "vitest";
import { summarizeWorkspace } from "./dto.js";
import { createWorkspace } from "../domain/workspace.js";
import type { WorkspaceSession } from "../domain/session.js";

function session(status: WorkspaceSession["status"]): WorkspaceSession {
  return {
    id: `ses-${status}`,
    workspaceId: "ws-1",
    name: status,
    repoRoot: "/repo",
    cwd: "/repo",
    runtime: {},
    status,
    liveSummary: `${status} summary`,
    recentFiles: [],
    linkedResources: {
      artifactIds: [],
      workItemIds: [],
      reviewIds: [],
    },
    connectionState: "live",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

describe("transport dto", () => {
  it("summarizes multi-repo workspaces without requiring HQ fields", () => {
    const workspace = createWorkspace({
      id: "ws-1",
      name: "Workspace One",
      description: "test workspace",
      repoRoots: [
        { id: "repo-1", path: "/repo-1", name: "repo-1" },
        { id: "repo-2", path: "/repo-2", name: "repo-2" },
      ],
      worktrees: [
        { id: "wt-1", repoRootId: "repo-1", path: "/repo-1" },
        { id: "wt-2", repoRootId: "repo-2", path: "/repo-2" },
      ],
      sessionIds: ["ses-awaiting-input", "ses-running"],
      artifactIds: [],
      preferences: {},
    });

    const summary = summarizeWorkspace(workspace, [session("awaiting-input"), session("running")]);

    expect(summary.repoRootCount).toBe(2);
    expect(summary.worktreeCount).toBe(2);
    expect(summary.sessionCount).toBe(2);
    expect(summary.attentionBand).toBe("needs-operator");
  });

  it("reports active when no session currently needs operator attention", () => {
    const workspace = createWorkspace({
      id: "ws-2",
      name: "Workspace Two",
      repoRoots: [{ id: "repo-1", path: "/repo-1", name: "repo-1" }],
      worktrees: [],
      sessionIds: ["ses-running"],
      artifactIds: [],
      preferences: {},
    });

    const summary = summarizeWorkspace(workspace, [session("running")]);
    expect(summary.attentionBand).toBe("active");
  });
});
