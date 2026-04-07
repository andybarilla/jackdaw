<script lang="ts">
  import type { SessionInfo } from "./types";

  interface Props {
    sessions: SessionInfo[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onKill: (id: string) => void;
  }

  let { sessions, activeSessionId, onSelect, onNew, onKill }: Props =
    $props();

  function statusColor(status: SessionInfo["status"]): string {
    switch (status) {
      case "running":
        return "var(--success)";
      case "exited":
        return "var(--warning)";
      case "stopped":
        return "var(--error)";
    }
  }

  function dirName(workDir: string): string {
    return workDir.split("/").pop() || workDir;
  }
</script>

<aside class="sidebar">
  <button class="new-session" onclick={onNew}>+ New Session</button>

  <div class="session-list">
    {#each sessions as session (session.id)}
      <div
        class="session-item"
        class:active={session.id === activeSessionId}
        onclick={() => onSelect(session.id)}
        onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") onSelect(session.id); }}
        role="button"
        tabindex="0"
      >
        <span class="status-dot" style="background: {statusColor(session.status)}"></span>
        <span class="session-name">{dirName(session.work_dir)}</span>
        {#if session.status === "running"}
          <button
            class="kill-btn"
            onclick={(e: MouseEvent) => { e.stopPropagation(); onKill(session.id); }}
            title="Kill session"
          >&#215;</button>
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style>
  .sidebar {
    width: 240px;
    min-width: 240px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .new-session {
    margin: 12px;
    padding: 8px 12px;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
  }

  .new-session:hover {
    opacity: 0.9;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
  }

  .session-item:hover {
    background: var(--bg-tertiary);
  }

  .session-item.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .session-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kill-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    line-height: 1;
  }

  .kill-btn:hover {
    color: var(--error);
  }
</style>
