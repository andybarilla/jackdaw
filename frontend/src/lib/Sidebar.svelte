<script lang="ts">
  import { onDestroy } from "svelte";
  import { EventsOn } from "../../wailsjs/runtime/runtime";
  import type { DashboardSession } from "./types";
  import { hasNotification } from "./notifications.svelte";

  interface Props {
    width?: number;
    onSelect: (id: string) => void;
    onNew: () => void;
    onKill: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onViewDiff: (id: string) => void;
    onResize?: (width: number) => void;
  }

  let { width = 280, onSelect, onNew, onKill, onRename, onViewDiff, onResize }: Props =
    $props();

  let dashboardSessions = $state<DashboardSession[]>([]);
  let editingId = $state<string | null>(null);
  let editValue = $state("");
  let menuOpenId = $state<string | null>(null);

  const cancelDashboard = EventsOn("dashboard-updated", (data: unknown) => {
    dashboardSessions = ((data as DashboardSession[]) || []);
  });
  onDestroy(cancelDashboard);

  // Resize handle state
  let resizing = $state(false);
  let startX = 0;
  let startWidth = 0;

  function handleResizeStart(e: MouseEvent): void {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = width;
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  }

  function handleResizeMove(e: MouseEvent): void {
    const newWidth = Math.min(480, Math.max(180, startWidth + e.clientX - startX));
    onResize?.(newWidth);
  }

  function handleResizeEnd(): void {
    resizing = false;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  }

  function statusColor(status: DashboardSession["status"]): string {
    switch (status) {
      case "idle":
        return "var(--text-muted)";
      case "working":
        return "var(--accent)";
      case "waiting_for_approval":
        return "var(--warning)";
      case "error":
        return "var(--error)";
      case "stopped":
      case "exited":
        return "var(--text-muted)";
    }
  }

  function formatElapsed(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const mins = Math.floor((now - start) / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) return `${hours}h ${remMins}m`;
    return `${Math.floor(hours / 24)}d`;
  }

  function basename(path: string): string {
    const parts = path.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || path;
  }

  function startEditing(session: DashboardSession, event: Event): void {
    event.stopPropagation();
    editingId = session.id;
    editValue = session.name;
    menuOpenId = null;
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

  function toggleMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    menuOpenId = menuOpenId === id ? null : id;
  }

  function handleMenuAction(action: () => void): void {
    menuOpenId = null;
    action();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar" style="width: {width}px; min-width: {width}px">
  <button class="new-session" onclick={onNew}>+ New Session</button>

  <div class="session-list">
    {#each dashboardSessions as session (session.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="session-card"
        class:attention={hasNotification(session.id)}
        onclick={() => onSelect(session.id)}
        role="button"
        tabindex="0"
        onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") onSelect(session.id); }}
      >
        <div class="card-row-1">
          <span
            class="status-dot"
            class:pulse={hasNotification(session.id) || session.status === 'waiting_for_approval'}
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
          {/if}
          <span class="elapsed">{formatElapsed(session.started_at)}</span>

          <div class="card-actions">
            {#if session.status !== "stopped" && session.status !== "exited"}
              <button
                class="action-btn kill-btn"
                onclick={(e: MouseEvent) => { e.stopPropagation(); onKill(session.id); }}
                title="Kill session"
              >&#215;</button>
            {/if}
            <button
              class="action-btn menu-btn"
              onclick={(e: MouseEvent) => toggleMenu(session.id, e)}
              title="More actions"
            >&#8943;</button>
          </div>

          {#if hasNotification(session.id)}
            <span class="attention-badge">!</span>
          {/if}
        </div>

        <div class="card-row-2">
          <span class="work-dir" title={session.work_dir}>{basename(session.work_dir)}</span>
          {#if session.worktree_enabled}
            <span class="branch-badge" title={session.branch_name}>&#9741; {session.branch_name}</span>
          {/if}
        </div>

        <div class="card-row-3">
          {#if session.last_line}
            <span class="last-line">{session.last_line}</span>
          {:else}
            <span class="last-line no-activity">No activity yet</span>
          {/if}
        </div>

        {#if menuOpenId === session.id}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="overflow-menu" onclick={(e: MouseEvent) => e.stopPropagation()}>
            <button class="menu-item" onclick={() => handleMenuAction(() => startEditing(session, new Event('click')))}>Rename</button>
            <button class="menu-item" onclick={() => handleMenuAction(() => onViewDiff(session.id))}>View Diff</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="resize-handle"
    class:active={resizing}
    onmousedown={handleResizeStart}
  ></div>
</aside>

{#if menuOpenId}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="menu-backdrop" onclick={() => menuOpenId = null}></div>
{/if}

<style>
  .sidebar {
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
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
    font-size: 1.077rem;
  }

  .new-session:hover {
    opacity: 0.9;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .session-card {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: relative;
  }

  .session-card:hover {
    border-color: var(--accent);
  }

  .session-card.attention {
    background: rgba(251, 146, 60, 0.08);
    border-color: var(--warning);
  }

  .card-row-1 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.pulse {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .session-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .elapsed {
    color: var(--text-muted);
    font-size: 0.846rem;
    flex-shrink: 0;
  }

  .card-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .session-card:hover .card-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1.077rem;
    padding: 0 3px;
    line-height: 1;
    border-radius: 3px;
  }

  .action-btn:hover {
    background: var(--bg-hover, #333);
  }

  .kill-btn:hover {
    color: var(--error);
  }

  .menu-btn:hover {
    color: var(--text-primary);
  }

  .attention-badge {
    background: var(--warning);
    color: var(--bg-primary);
    font-size: 0.769rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .card-row-2 {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 0.846rem;
    padding-left: 14px;
  }

  .work-dir {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-badge {
    color: var(--accent);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .card-row-3 {
    padding-left: 14px;
  }

  .last-line {
    font-family: monospace;
    font-size: 0.846rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }

  .last-line.no-activity {
    font-style: italic;
    color: var(--text-muted);
    font-family: inherit;
  }

  .rename-input {
    flex: 1;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 1rem;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .overflow-menu {
    position: absolute;
    right: 8px;
    top: 28px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    z-index: 200;
    min-width: 120px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.923rem;
    cursor: pointer;
    text-align: left;
  }

  .menu-item:hover {
    background: var(--bg-hover, #2a2a2a);
    color: var(--text-primary);
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: -2px;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }

  .resize-handle:hover,
  .resize-handle.active {
    background: var(--accent);
    opacity: 0.4;
  }
</style>
