<script lang="ts">
  import type { SessionInfo } from "./types";
  import { hasNotification } from "./notifications.svelte";

  interface Props {
    sessions: SessionInfo[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onKill: (id: string) => void;
    onRename: (id: string, name: string) => void;
  }

  let { sessions, activeSessionId, onSelect, onNew, onKill, onRename }: Props =
    $props();

  let editingId = $state<string | null>(null);
  let editValue = $state("");

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

  function startEditing(session: SessionInfo, event: Event): void {
    event.stopPropagation();
    editingId = session.id;
    editValue = session.name;
  }

  function commitRename(): void {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    editingId = null;
  }

  function handleEditKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      commitRename();
    } else if (event.key === "Escape") {
      editingId = null;
    }
  }
</script>

<aside class="sidebar">
  <button class="new-session" onclick={onNew}>+ New Session</button>

  <div class="session-list">
    {#each sessions as session (session.id)}
      <div
        class="session-item"
        class:active={session.id === activeSessionId}
        class:attention={hasNotification(session.id)}
        onclick={() => onSelect(session.id)}
        onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") onSelect(session.id); }}
        role="button"
        tabindex="0"
      >
        <span
          class="status-dot"
          class:pulse={hasNotification(session.id)}
          style="background: {hasNotification(session.id) ? 'var(--warning)' : statusColor(session.status)}"
        ></span>
        {#if editingId === session.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename-input"
            bind:value={editValue}
            onblur={commitRename}
            onkeydown={handleEditKeydown}
            onclick={(e: MouseEvent) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="session-name"
            ondblclick={(e: MouseEvent) => startEditing(session, e)}
          >{session.name}</span>
          {#if session.worktree_enabled}
            <span class="branch-badge" title={session.branch_name}>&#9741;</span>
          {/if}
          <button
            class="edit-btn"
            onclick={(e: MouseEvent) => startEditing(session, e)}
            title="Rename session"
          >&#9998;</button>
        {/if}
        {#if session.status === "running"}
          <button
            class="kill-btn"
            onclick={(e: MouseEvent) => { e.stopPropagation(); onKill(session.id); }}
            title="Kill session"
          >&#215;</button>
        {/if}
        {#if hasNotification(session.id)}
          <span class="attention-badge">!</span>
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

  .branch-badge {
    color: var(--accent);
    font-size: 14px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .edit-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: 0 4px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .session-item:hover .edit-btn {
    opacity: 1;
  }

  .edit-btn:hover {
    color: var(--text-primary);
  }

  .rename-input {
    flex: 1;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    min-width: 0;
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

  .session-item.attention {
    background: rgba(251, 146, 60, 0.1);
  }

  .status-dot.pulse {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .attention-badge {
    background: var(--warning);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
</style>
