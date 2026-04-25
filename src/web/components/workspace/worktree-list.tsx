import React from "react";
import type { WorkspaceWorktree } from "../../../shared/domain/workspace.js";

export interface WorktreeListProps {
  worktrees: WorkspaceWorktree[];
}

export function WorktreeList({ worktrees }: WorktreeListProps): React.JSX.Element {
  return (
    <ul className="context-list" aria-label="Workspace worktrees">
      {worktrees.map((worktree) => (
        <li key={worktree.id}>
          <strong>{worktree.label ?? worktree.branch ?? worktree.path}</strong>
          <span>{worktree.path}</span>
          {worktree.branch !== undefined && <span>branch {worktree.branch}</span>}
        </li>
      ))}
      {worktrees.length === 0 && <li>No worktrees tracked yet.</li>}
    </ul>
  );
}
