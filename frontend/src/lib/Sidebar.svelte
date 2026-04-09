<script lang="ts">
  import { onDestroy } from "svelte";
  import { EventsOn } from "../../wailsjs/runtime/runtime";
  import type { DashboardSession, Workspace } from "./types";
  import { hasNotification } from "./notifications.svelte";

  interface Props {
    width?: number;
    workspaces: Workspace[];
    activeWorkspaceId: string;
    onSelect: (id: string) => void;
    onNew: () => void;
    onKill: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onViewDiff: (id: string) => void;
    onResize?: (width: number) => void;
    onSwitchWorkspace: (id: string) => void;
    onCreateWorkspace: (name: string) => void;
    onRenameWorkspace: (id: string, name: string) => void;
    onDeleteWorkspace: (id: string, moveToDefault: boolean) => void;
    onMoveSession: (sessionId: string, workspaceId: string) => void;
  }

  let {
    width = 280, workspaces, activeWorkspaceId,
    onSelect, onNew, onKill, onRename, onViewDiff, onResize,
    onSwitchWorkspace, onCreateWorkspace, onRenameWorkspace, onDeleteWorkspace, onMoveSession,
  }: Props = $props();

  let allSessions = $state<DashboardSession[]>([]);
  let editingId = $state<string | null>(null);
  let editValue = $state("");
  let menuOpenId = $state<string | null>(null);
  let wsDropdownOpen = $state(false);
  let newWsName = $state("");
  let showNewWsInput = $state(false);
  let editingWsId = $state<string | null>(null);
  let editWsValue = $state("");
  let deleteConfirmWsId = $state<string | null>(null);
  let wsMenuId = $state<string | null>(null);

  const cancelDashboard = EventsOn("dashboard-updated", (data: unknown) => {
    allSessions = ((data as DashboardSession[]) || []);
  });
  onDestroy(cancelDashboard);

  let dashboardSessions = $derived(
    allSessions.filter(s => s.workspace_id === activeWorkspaceId || (!s.workspace_id && activeWorkspaceId === "default"))
  );

  let deleteConfirmSessionCount = $derived(
    deleteConfirmWsId ? allSessions.filter(s => s.workspace_id === deleteConfirmWsId).length : 0
  );

  let activeWorkspaceName = $derived(
    workspaces.find(w => w.id === activeWorkspaceId)?.name ?? "Default"
  );

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

  function toggleWsDropdown(): void {
    wsDropdownOpen = !wsDropdownOpen;
    if (!wsDropdownOpen) {
      showNewWsInput = false;
      newWsName = "";
      editingWsId = null;
      wsMenuId = null;
    }
  }

  function closeWsDropdown(): void {
    wsDropdownOpen = false;
    showNewWsInput = false;
    newWsName = "";
    editingWsId = null;
    wsMenuId = null;
  }

  function handleWsSelect(id: string): void {
    onSwitchWorkspace(id);
    closeWsDropdown();
  }

  function handleNewWsKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && newWsName.trim()) {
      onCreateWorkspace(newWsName.trim());
      newWsName = "";
      showNewWsInput = false;
    } else if (event.key === "Escape") {
      showNewWsInput = false;
      newWsName = "";
    }
  }

  function startWsEditing(ws: Workspace, event: Event): void {
    event.stopPropagation();
    editingWsId = ws.id;
    editWsValue = ws.name;
    wsMenuId = null;
  }

  function commitWsRename(): void {
    if (editingWsId && editWsValue.trim()) {
      onRenameWorkspace(editingWsId, editWsValue.trim());
    }
    editingWsId = null;
  }

  function handleWsEditKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      commitWsRename();
    } else if (event.key === "Escape") {
      editingWsId = null;
    }
  }

  function handleDeleteClick(wsId: string, event: Event): void {
    event.stopPropagation();
    wsMenuId = null;
    const sessionCount = allSessions.filter(s => s.workspace_id === wsId).length;
    if (sessionCount > 0) {
      deleteConfirmWsId = wsId;
    } else {
      onDeleteWorkspace(wsId, false);
    }
  }

  function confirmDeleteMove(): void {
    if (deleteConfirmWsId) {
      onDeleteWorkspace(deleteConfirmWsId, true);
      deleteConfirmWsId = null;
    }
  }

  function confirmDeleteSessions(): void {
    if (deleteConfirmWsId) {
      onDeleteWorkspace(deleteConfirmWsId, false);
      deleteConfirmWsId = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar" style="width: {width}px; min-width: {width}px">
  <div class="workspace-switcher">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <button class="ws-trigger" onclick={toggleWsDropdown}>
      <span class="ws-name">{activeWorkspaceName}</span>
      <span class="ws-chevron">{wsDropdownOpen ? '\u25B4' : '\u25BE'}</span>
    </button>
    {#if wsDropdownOpen}
      <div class="ws-dropdown">
        {#each workspaces as ws (ws.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="ws-item" class:active={ws.id === activeWorkspaceId} onclick={() => handleWsSelect(ws.id)} role="button" tabindex="0">
            {#if editingWsId === ws.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="ws-rename-input"
                bind:value={editWsValue}
                onblur={commitWsRename}
                onkeydown={handleWsEditKeydown}
                onclick={(e: MouseEvent) => e.stopPropagation()}
                autofocus
              />
            {:else}
              <span class="ws-item-check">{ws.id === activeWorkspaceId ? '✓' : ''}</span>
              <span class="ws-item-name">{ws.name}</span>
            {/if}
            {#if ws.id !== "default" && editingWsId !== ws.id}
              <button class="ws-item-menu" onclick={(e: MouseEvent) => { e.stopPropagation(); wsMenuId = wsMenuId === ws.id ? null : ws.id; }} title="Workspace options">&#8943;</button>
              {#if wsMenuId === ws.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="ws-item-submenu" onclick={(e: MouseEvent) => e.stopPropagation()}>
                  <button class="menu-item" onclick={(e: Event) => startWsEditing(ws, e)}>Rename</button>
                  <button class="menu-item danger" onclick={(e: Event) => handleDeleteClick(ws.id, e)}>Delete</button>
                </div>
              {/if}
            {/if}
          </div>
        {/each}
        <div class="ws-divider"></div>
        {#if showNewWsInput}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="ws-new-input"
            placeholder="Workspace name"
            bind:value={newWsName}
            onkeydown={handleNewWsKeydown}
            onblur={() => { showNewWsInput = false; newWsName = ""; }}
            autofocus
          />
        {:else}
          <button class="ws-new-btn" onclick={() => { showNewWsInput = true; }}>+ New Workspace</button>
        {/if}
      </div>
    {/if}
  </div>

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
            {#if workspaces.length > 1}
              <div class="menu-divider"></div>
              <div class="menu-label">Move to...</div>
              {#each workspaces.filter(w => w.id !== session.workspace_id) as ws (ws.id)}
                <button class="menu-item" onclick={() => handleMenuAction(() => onMoveSession(session.id, ws.id))}>{ws.name}</button>
              {/each}
            {/if}
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

{#if menuOpenId || wsDropdownOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="menu-backdrop" onclick={() => { menuOpenId = null; closeWsDropdown(); }}></div>
{/if}

{#if deleteConfirmWsId}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog-backdrop" onclick={() => deleteConfirmWsId = null}>
    <div class="confirm-dialog" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <p>Workspace has {deleteConfirmSessionCount} session{deleteConfirmSessionCount !== 1 ? 's' : ''}.</p>
      <div class="confirm-actions">
        <button class="confirm-btn move" onclick={confirmDeleteMove}>Move to Default</button>
        <button class="confirm-btn delete" onclick={confirmDeleteSessions}>Delete sessions</button>
        <button class="confirm-btn cancel" onclick={() => deleteConfirmWsId = null}>Cancel</button>
      </div>
    </div>
  </div>
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
    font-family: 'JetBrains Mono NF', monospace;
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

  .menu-item.danger {
    color: var(--error);
  }

  .menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.15);
  }

  .menu-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .menu-label {
    padding: 4px 12px;
    font-size: 0.769rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .workspace-switcher {
    position: relative;
    margin: 12px 12px 0;
  }

  .ws-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.923rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ws-trigger:hover {
    border-color: var(--accent);
  }

  .ws-chevron {
    font-size: 0.769rem;
    color: var(--text-muted);
  }

  .ws-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    z-index: 201;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .ws-item {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    cursor: pointer;
    gap: 6px;
    position: relative;
  }

  .ws-item:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  .ws-item.active {
    color: var(--accent);
  }

  .ws-item-check {
    width: 14px;
    font-size: 0.846rem;
    flex-shrink: 0;
    text-align: center;
  }

  .ws-item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.923rem;
    color: var(--text-primary);
  }

  .ws-item.active .ws-item-name {
    color: var(--accent);
  }

  .ws-item-menu {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0 3px;
    line-height: 1;
    border-radius: 3px;
    opacity: 0;
    flex-shrink: 0;
  }

  .ws-item:hover .ws-item-menu {
    opacity: 1;
  }

  .ws-item-menu:hover {
    color: var(--text-primary);
    background: var(--bg-hover, #333);
  }

  .ws-item-submenu {
    position: absolute;
    right: -2px;
    top: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    z-index: 202;
    min-width: 100px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .ws-rename-input {
    flex: 1;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 0.923rem;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .ws-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .ws-new-input {
    display: block;
    width: calc(100% - 20px);
    margin: 4px 10px;
    padding: 4px 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 4px;
    font-size: 0.923rem;
    font-family: inherit;
    outline: none;
  }

  .ws-new-btn {
    display: block;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.923rem;
    cursor: pointer;
    text-align: left;
  }

  .ws-new-btn:hover {
    background: var(--bg-hover, #2a2a2a);
    color: var(--text-primary);
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confirm-dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    min-width: 280px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .confirm-dialog p {
    margin: 0 0 12px;
    color: var(--text-primary);
    font-size: 0.923rem;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
  }

  .confirm-btn {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.846rem;
    font-weight: 600;
  }

  .confirm-btn.move {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .confirm-btn.delete {
    background: none;
    color: var(--error);
    border-color: var(--error);
  }

  .confirm-btn.cancel {
    background: none;
    color: var(--text-muted);
  }

  .confirm-btn:hover {
    opacity: 0.9;
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
