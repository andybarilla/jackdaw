<script lang="ts">
  import { GetSessionDiff, GetFileDiff } from "../../wailsjs/go/main/App";
  import type { FileDiff, DiffHunk } from "./types";

  interface Props {
    sessionId: string;
    worktreeEnabled?: boolean;
    baseBranch?: string;
    uncommittedFiles?: number;
    onMerge?: () => void;
  }

  let { sessionId, worktreeEnabled, baseBranch, uncommittedFiles, onMerge }: Props = $props();
  let files = $state<FileDiff[]>([]);
  let selectedPath = $state<string | null>(null);
  let selectedFile = $state<FileDiff | null>(null);
  let loading = $state(true);
  let error = $state("");
  let loadingFile = $state(false);

  async function loadDiff(): Promise<void> {
    loading = true;
    error = "";
    try {
      const result = await GetSessionDiff(sessionId);
      files = (result || []) as FileDiff[];
      if (files.length > 0 && !selectedPath) {
        await selectFile(files[0].path);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function selectFile(path: string): Promise<void> {
    selectedPath = path;
    loadingFile = true;
    try {
      const result = await GetFileDiff(sessionId, path);
      selectedFile = result as FileDiff | null;
    } catch {
      // Fall back to the summary from the file list
      selectedFile = files.find((f) => f.path === path) || null;
    } finally {
      loadingFile = false;
    }
  }

  function statusIcon(status: string): string {
    switch (status) {
      case "added": return "+";
      case "deleted": return "-";
      case "renamed": return "R";
      default: return "M";
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case "added": return "status-added";
      case "deleted": return "status-deleted";
      default: return "status-modified";
    }
  }

  $effect(() => {
    void sessionId;
    loadDiff();
  });
</script>

<div class="diff-viewer">
  {#if loading}
    <div class="empty-state">Loading diff...</div>
  {:else if error}
    <div class="empty-state error-state">
      <p>{error}</p>
      <button class="retry-btn" onclick={loadDiff}>Retry</button>
    </div>
  {:else if files.length === 0}
    <div class="empty-state">No changes</div>
  {:else}
    <div class="file-list">
      <div class="file-list-header">
        <span>{files.length} file{files.length === 1 ? "" : "s"} changed</span>
        {#if worktreeEnabled && onMerge}
          <button
            class="merge-btn"
            onclick={onMerge}
            disabled={uncommittedFiles !== undefined && uncommittedFiles > 0}
            title={uncommittedFiles !== undefined && uncommittedFiles > 0 ? "Commit or stash changes first" : `Merge to ${baseBranch}`}
          >Merge</button>
        {/if}
      </div>
      {#each files as file (file.path)}
        <button
          class="file-item"
          class:selected={file.path === selectedPath}
          onclick={() => selectFile(file.path)}
        >
          <span class="file-status {statusClass(file.status)}">{statusIcon(file.status)}</span>
          <span class="file-path" title={file.path}>{file.path}</span>
          {#if file.binary}
            <span class="binary-badge">binary</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="diff-content">
      {#if loadingFile}
        <div class="empty-state">Loading...</div>
      {:else if selectedFile}
        <div class="diff-file-header">
          {#if selectedFile.old_path}
            <span class="old-path">{selectedFile.old_path}</span>
            <span class="arrow">&rarr;</span>
          {/if}
          <span>{selectedFile.path}</span>
        </div>
        {#if selectedFile.binary}
          <div class="empty-state">Binary file</div>
        {:else if selectedFile.hunks && selectedFile.hunks.length > 0}
          <div class="hunks">
            {#each selectedFile.hunks as hunk, hi (hi)}
              <div class="hunk">
                <div class="hunk-header">{hunk.header}</div>
                {#each hunk.lines as line, li (li)}
                  <div class="diff-line {line.type}">
                    <span class="line-num old">{line.old_line || ""}</span>
                    <span class="line-num new">{line.new_line || ""}</span>
                    <span class="line-marker">{line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}</span>
                    <span class="line-content">{line.content}</span>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">No hunks (file may be untracked)</div>
        {/if}
      {:else}
        <div class="empty-state">Select a file</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .diff-viewer {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    color: var(--text-primary);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-muted);
    font-size: 14px;
    gap: 12px;
  }

  .error-state {
    color: var(--error);
  }

  .retry-btn {
    padding: 6px 16px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .file-list {
    width: 220px;
    min-width: 180px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .file-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
  }

  .merge-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
  }

  .merge-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    text-align: left;
  }

  .file-item:hover {
    background: var(--bg-tertiary);
  }

  .file-item.selected {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .file-status {
    font-weight: 700;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .status-added { color: var(--success); }
  .status-deleted { color: var(--error); }
  .status-modified { color: var(--accent); }

  .file-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .binary-badge {
    font-size: 10px;
    padding: 1px 4px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .diff-content {
    flex: 1;
    overflow: auto;
    min-width: 0;
  }

  .diff-file-header {
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .old-path {
    text-decoration: line-through;
    opacity: 0.6;
  }

  .arrow {
    margin: 0 6px;
  }

  .hunks {
    padding-bottom: 24px;
  }

  .hunk {
    margin-bottom: 4px;
  }

  .hunk-header {
    padding: 4px 16px;
    background: rgba(100, 149, 237, 0.1);
    color: var(--text-muted);
    font-size: 12px;
    position: sticky;
    top: 32px;
    z-index: 0;
  }

  .diff-line {
    display: flex;
    line-height: 20px;
    white-space: pre;
  }

  .diff-line.add {
    background: rgba(40, 167, 69, 0.15);
  }

  .diff-line.delete {
    background: rgba(220, 53, 69, 0.15);
  }

  .diff-line.context {
    background: transparent;
  }

  .line-num {
    display: inline-block;
    width: 48px;
    padding: 0 8px;
    text-align: right;
    color: var(--text-muted);
    opacity: 0.5;
    flex-shrink: 0;
    user-select: none;
    font-size: 11px;
  }

  .line-marker {
    display: inline-block;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    color: var(--text-muted);
  }

  .add .line-marker { color: var(--success); }
  .delete .line-marker { color: var(--error); }

  .line-content {
    flex: 1;
    padding-right: 16px;
    min-width: 0;
  }
</style>
