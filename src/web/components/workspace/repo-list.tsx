import React from "react";
import type { WorkspaceRepoRoot } from "../../../shared/domain/workspace.js";

export interface RepoListProps {
  repos: WorkspaceRepoRoot[];
}

export function RepoList({ repos }: RepoListProps): React.JSX.Element {
  return (
    <ul className="context-list" aria-label="Workspace repositories">
      {repos.map((repo) => (
        <li key={repo.id}>
          <strong>{repo.name}</strong>
          <span>{repo.path}</span>
          {repo.defaultBranch !== undefined && <span>default {repo.defaultBranch}</span>}
        </li>
      ))}
      {repos.length === 0 && <li>No repositories registered.</li>}
    </ul>
  );
}
