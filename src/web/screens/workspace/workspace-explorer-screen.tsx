import React from "react";
import type { WorkspaceDetailDto } from "../../../shared/transport/dto.js";
import { ArtifactList } from "../../components/artifacts/artifact-list.js";
import { RepoList } from "../../components/workspace/repo-list.js";
import { WorktreeList } from "../../components/workspace/worktree-list.js";

export interface WorkspaceExplorerScreenProps {
  detail: WorkspaceDetailDto;
  selectedArtifactId?: string;
  onOpenArtifact: (artifactId: string) => void;
  onBackToSessions: () => void;
}

export function WorkspaceExplorerScreen({ detail, selectedArtifactId, onOpenArtifact, onBackToSessions }: WorkspaceExplorerScreenProps): React.JSX.Element {
  return (
    <div className="explorer-screen" data-route="workspace-explorer-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Workspace explorer</p>
          <h2>{detail.workspace.name}</h2>
          <p>Context is available without replacing sessions as the primary workflow.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onBackToSessions}>Back to sessions</button>
      </header>

      <div className="explorer-grid">
        <section className="panel">
          <h3>Repositories</h3>
          <RepoList repos={detail.workspace.repoRoots} />
        </section>
        <section className="panel">
          <h3>Worktrees</h3>
          <WorktreeList worktrees={detail.workspace.worktrees} />
        </section>
        <section className="panel explorer-artifacts">
          <h3>Artifacts</h3>
          <ArtifactList artifacts={detail.artifacts} selectedArtifactId={selectedArtifactId} onSelectArtifact={onOpenArtifact} />
        </section>
      </div>
    </div>
  );
}
