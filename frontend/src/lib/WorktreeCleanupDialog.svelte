<script lang="ts">
  import type { WorktreeStatus } from "./types";

  interface Props {
    sessionName: string;
    branchName: string;
    baseBranch: string;
    status: WorktreeStatus | null;
    onKeep: () => void;
    onMerge: () => void;
    onDelete: () => void;
  }

  let { sessionName, branchName, baseBranch, status, onKeep, onMerge, onDelete }: Props = $props();
</script>

<div class="overlay" role="presentation">
  <div class="dialog">
    <h3>Session ended</h3>
    <p class="session-name">{sessionName}</p>
    <p class="branch">Branch: <code>{branchName}</code></p>

    {#if status}
      <div class="status">
        {#if status.uncommitted_files > 0}
          <span class="warning">{status.uncommitted_files} uncommitted file{status.uncommitted_files === 1 ? "" : "s"}</span>
        {/if}
        {#if status.unpushed_commits > 0}
          <span class="warning">{status.unpushed_commits} unpushed commit{status.unpushed_commits === 1 ? "" : "s"}</span>
        {/if}
        {#if status.uncommitted_files === 0 && status.unpushed_commits === 0}
          <span class="clean">Clean — no unsaved changes</span>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <button class="keep" onclick={onKeep}>Keep worktree</button>
      <button
        class="merge"
        onclick={onMerge}
        disabled={status !== null && status.uncommitted_files > 0}
        title={status !== null && status.uncommitted_files > 0 ? "Commit or stash changes first" : `Squash merge into ${baseBranch}`}
      >Merge to {baseBranch}</button>
      <button class="delete" onclick={onDelete}>Delete worktree</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    width: 380px;
  }

  h3 {
    margin: 0 0 12px;
    font-size: 16px;
  }

  .session-name {
    font-weight: 600;
    margin: 0 0 4px;
  }

  .branch {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }

  .status {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
    font-size: 13px;
  }

  .warning {
    color: var(--warning);
  }

  .clean {
    color: var(--success);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }

  .keep {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .merge {
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 600;
  }

  .merge:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .delete {
    background: var(--error);
    color: white;
    font-weight: 600;
  }
</style>
