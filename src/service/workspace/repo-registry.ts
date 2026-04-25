import type { WorkspaceRepoRoot, WorkspaceWorktree, Workspace } from "../../shared/domain/workspace.js";
import { normalizeWorkspacePathForComparison } from "./workspace-paths.js";

export class RepoRegistry {
  addRepoRoot(workspace: Workspace, repoRoot: WorkspaceRepoRoot): Workspace {
    const duplicateRepoRoot = workspace.repoRoots.find((candidate) =>
      candidate.id !== repoRoot.id
        && normalizeWorkspacePathForComparison(candidate.path) === normalizeWorkspacePathForComparison(repoRoot.path),
    );
    if (duplicateRepoRoot !== undefined) {
      throw new Error(`Cannot register duplicate repo root path: ${repoRoot.path}`);
    }

    return {
      ...workspace,
      repoRoots: upsertById(workspace.repoRoots, repoRoot),
    };
  }

  addWorktree(workspace: Workspace, worktree: WorkspaceWorktree): Workspace {
    if (!workspace.repoRoots.some((repoRoot) => repoRoot.id === worktree.repoRootId)) {
      throw new Error(`Cannot register worktree for missing repo root: ${worktree.repoRootId}`);
    }

    const duplicateWorktree = workspace.worktrees.find((candidate) =>
      candidate.id !== worktree.id
        && normalizeWorkspacePathForComparison(candidate.path) === normalizeWorkspacePathForComparison(worktree.path),
    );
    if (duplicateWorktree !== undefined) {
      throw new Error(`Cannot register duplicate worktree path: ${worktree.path}`);
    }

    return {
      ...workspace,
      worktrees: upsertById(workspace.worktrees, worktree),
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

function upsertById<T extends { id: string }>(items: readonly T[], nextItem: T): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[existingIndex] = nextItem;
  return nextItems;
}
