<script lang="ts">
  import { PickDirectory, IsGitRepo, GetRecentDirs } from "../../wailsjs/go/main/App";
  import { onMount } from "svelte";

  interface Props {
    onSubmit: (workDir: string, worktreeEnabled: boolean, branchName: string) => void;
    onCancel: () => void;
  }

  let { onSubmit, onCancel }: Props = $props();
  let workDir = $state("");
  let isGitRepo = $state(false);
  let worktreeEnabled = $state(false);
  let branchName = $state("");
  let checkingGit = $state(false);
  let recentDirs: { path: string; last_used: string }[] = $state([]);

  let filteredDirs = $derived.by(() => {
    const trimmed = workDir.trim().toLowerCase();
    if (!trimmed) return recentDirs;
    return recentDirs.filter(
      (d) => d.path.toLowerCase().startsWith(trimmed) && d.path !== workDir
    );
  });

  onMount(async () => {
    try {
      recentDirs = await GetRecentDirs();
    } catch {
      recentDirs = [];
    }
  });

  function generateBranchName(dir: string): string {
    const basename = dir.split("/").pop() || "project";
    const short = Date.now().toString(36).slice(-6);
    return `jackdaw-${basename}-${short}`;
  }

  async function checkGitRepo(dir: string): Promise<void> {
    if (!dir.trim()) {
      isGitRepo = false;
      return;
    }
    checkingGit = true;
    try {
      isGitRepo = await IsGitRepo(dir);
      if (isGitRepo && !branchName) {
        branchName = generateBranchName(dir);
      }
    } catch {
      isGitRepo = false;
    } finally {
      checkingGit = false;
    }
  }

  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (checkTimer) clearTimeout(checkTimer);
    const dir = workDir;
    checkTimer = setTimeout(() => checkGitRepo(dir), 300);
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    const trimmed = workDir.trim();
    if (trimmed) {
      onSubmit(trimmed, worktreeEnabled, branchName.trim());
    }
  }

  async function handleBrowse() {
    const dir = await PickDirectory();
    if (dir) {
      workDir = dir;
    }
  }

</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onCancel} onkeydown={(e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }} role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <form
    class="dialog"
    onsubmit={handleSubmit}
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <h3>New Claude Code Session</h3>
    <label>
      Working Directory
      <div class="input-row">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={workDir}
          placeholder="/path/to/project"
          autofocus
        />
        <button type="button" class="browse" onclick={handleBrowse}>Browse</button>
      </div>
    </label>

    {#if filteredDirs.length > 0}
      <div class="recent-dirs">
        {#each filteredDirs as dir}
          <button
            type="button"
            class="recent-dir"
            onclick={() => { workDir = dir.path; }}
          >{dir.path}</button>
        {/each}
      </div>
    {/if}

    {#if isGitRepo}
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={worktreeEnabled} />
        Create isolated worktree
      </label>

      {#if worktreeEnabled}
        <label>
          Branch name
          <input
            type="text"
            bind:value={branchName}
            placeholder="jackdaw-project-abc123"
            class="branch-input"
          />
        </label>
      {/if}
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel}>Cancel</button>
      <button type="submit" class="submit" disabled={!workDir.trim() || (worktreeEnabled && !branchName.trim())}>
        Launch
      </button>
    </div>
  </form>
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
    width: 400px;
  }

  h3 {
    margin-bottom: 16px;
    font-size: 1.231rem;
  }

  label {
    display: block;
    font-size: 1rem;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  .input-row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  input[type="text"] {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 1.077rem;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .browse {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .branch-input {
    width: 100%;
    margin-top: 6px;
  }

  .recent-dirs {
    max-height: 160px;
    overflow-y: auto;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
  }

  .recent-dir {
    background: none;
    border: none;
    border-radius: 4px;
    padding: 6px 10px;
    text-align: left;
    color: var(--text-secondary);
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.923rem;
    cursor: pointer;
  }

  .recent-dir:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
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
    font-size: 1rem;
  }

  .cancel {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .submit {
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 600;
  }

  .submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
