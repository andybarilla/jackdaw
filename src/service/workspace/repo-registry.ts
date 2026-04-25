import type { WorkspaceRepoRoot, WorkspaceWorktree, Workspace } from "../../shared/domain/workspace.js";
import { isWorkspacePathInside, normalizeWorkspacePathForComparison } from "./workspace-paths.js";

export class RepoRegistry {
  addRepoRoot(workspace: Workspace, repoRoot: WorkspaceRepoRoot): Workspace {
    if (workspace.repoRoots.some((candidate) => candidate.id === repoRoot.id)) {
      throw new Error(`Cannot register duplicate repo root id: ${repoRoot.id}`);
    }

    const duplicateRepoRoot = workspace.repoRoots.find((candidate) =>
      normalizeWorkspacePathForComparison(candidate.path) === normalizeWorkspacePathForComparison(repoRoot.path),
    );
    if (duplicateRepoRoot !== undefined) {
      throw new Error(`Cannot register duplicate repo root path: ${repoRoot.path}`);
    }

    return {
      ...workspace,
      repoRoots: [...workspace.repoRoots, repoRoot],
    };
  }

  addWorktree(workspace: Workspace, worktree: WorkspaceWorktree): Workspace {
    const repoRoot = workspace.repoRoots.find((candidate) => candidate.id === worktree.repoRootId);
    if (repoRoot === undefined) {
      throw new Error(`Cannot register worktree for missing repo root: ${worktree.repoRootId}`);
    }
    if (!isWorkspacePathInside(repoRoot.path, worktree.path)) {
      throw new Error(`Cannot register worktree outside repo root ${repoRoot.path}: ${worktree.path}`);
    }
    if (workspace.worktrees.some((candidate) => candidate.id === worktree.id)) {
      throw new Error(`Cannot register duplicate worktree id: ${worktree.id}`);
    }

    const duplicateWorktree = workspace.worktrees.find((candidate) =>
      normalizeWorkspacePathForComparison(candidate.path) === normalizeWorkspacePathForComparison(worktree.path),
    );
    if (duplicateWorktree !== undefined) {
      throw new Error(`Cannot register duplicate worktree path: ${worktree.path}`);
    }

    return {
      ...workspace,
      worktrees: [...workspace.worktrees, worktree],
    };
  }

  removeRepoRoot(workspace: Workspace, repoRootId: string): Workspace {
    return {
      ...workspace,
      repoRoots: workspace.repoRoots.filter((repoRoot) => repoRoot.id !== repoRootId),
      worktrees: workspace.worktrees.filter((worktree) => worktree.repoRootId !== repoRootId),
    };
  }
}
