import React from "react";
import type { FormEvent } from "react";
import type { WorkspaceDetailDto } from "../../../shared/transport/dto.js";
import { ArtifactList } from "../../components/artifacts/artifact-list.js";
import { RepoList } from "../../components/workspace/repo-list.js";
import { WorktreeList } from "../../components/workspace/worktree-list.js";
import type { ApiClient } from "../../lib/api-client.js";

export interface WorkspaceExplorerScreenProps {
  apiClient: ApiClient;
  detail: WorkspaceDetailDto;
  selectedArtifactId?: string;
  onOpenArtifact: (artifactId: string) => void;
  onBackToSessions: () => void;
}

export function WorkspaceExplorerScreen({ apiClient, detail, selectedArtifactId, onOpenArtifact, onBackToSessions }: WorkspaceExplorerScreenProps): React.JSX.Element {
  const [repoRootId, setRepoRootId] = React.useState<string>(detail.workspace.repoRoots[0]?.id ?? "");
  const [path, setPath] = React.useState<string>("");
  const [branch, setBranch] = React.useState<string>("");
  const [label, setLabel] = React.useState<string>("");
  const [statusMessage, setStatusMessage] = React.useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);

  React.useEffect((): void => {
    if (repoRootId.length === 0 && detail.workspace.repoRoots[0] !== undefined) {
      setRepoRootId(detail.workspace.repoRoots[0].id);
    }
  }, [detail.workspace.repoRoots, repoRootId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(undefined);

    try {
      await apiClient.addWorkspaceWorktree(detail.workspace.id, {
        repoRootId,
        path,
        branch: branch.trim().length === 0 ? undefined : branch.trim(),
        label: label.trim().length === 0 ? undefined : label.trim(),
      });
      setPath("");
      setBranch("");
      setLabel("");
      setStatusMessage("Worktree registered. Workspace context will refresh automatically.");
    } catch (error: unknown) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <form aria-label="Register worktree" onSubmit={handleSubmit}>
            <label>
              Repo root
              <select value={repoRootId} onChange={(event) => setRepoRootId(event.target.value)} disabled={detail.workspace.repoRoots.length === 0}>
                {detail.workspace.repoRoots.map((repoRoot) => (
                  <option key={repoRoot.id} value={repoRoot.id}>{repoRoot.name}</option>
                ))}
              </select>
            </label>
            <label>
              Worktree path
              <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/repo/.worktrees/task" required />
            </label>
            <label>
              Branch
              <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/task" />
            </label>
            <label>
              Label
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Task worktree" />
            </label>
            <button type="submit" className="secondary-button" disabled={isSubmitting || repoRootId.length === 0}>Register worktree</button>
            {statusMessage !== undefined && <p role="status">{statusMessage}</p>}
          </form>
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
