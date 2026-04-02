<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import Settings from './Settings.svelte';
  import Terminal from './Terminal.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import NotificationPanel from './NotificationPanel.svelte';
  import AgentTree from './AgentTree.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { notificationStore, initNotificationListener } from '$lib/stores/notifications.svelte';
  import { initUpdaterListener } from '$lib/stores/updater.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { shortenPath, getProjectName } from '$lib/utils';
  import { matchShortcut } from '$lib/shortcuts';
  import ProjectGroup from './ProjectGroup.svelte';
  import { buildRenderList } from '$lib/grouping';
  import type { Session, HistorySession, DateFilter } from '$lib/types';

  let activeTab = $state<'active' | 'history' | 'settings'>('active');
  let selectedSessionId = $state<string | null>(null);
  let historySessions = $state<HistorySession[]>([]);
  let historyLoading = $state(false);
  let historySearchQuery = $state('');
  let historyDateFilter = $state<DateFilter | null>(null);
  let historyHasMore = $state(true);
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let showNewSessionMenu = $state(false);
  let recentCwds = $state<string[]>([]);
  let confirmCloseCount = $state<number | null>(null);
  let notificationPanelOpen = $state(false);
  let tabState = $state<Record<string, 'detail' | 'terminal' | 'tree'>>({});
  let previewUrl = $state<string | null>(null);

  let selectedSession = $derived(
    sessionStore.sessions.find(s => s.session_id === selectedSessionId) ?? null
  );

  let selectedHistorySession = $derived(
    historySessions.find(s => s.session_id === selectedSessionId) ?? null
  );

  let renderList = $derived(buildRenderList(sessionStore.sessions));

  function getChildrenByParent(): Map<string, Session[]> {
    const map = new Map<string, Session[]>();
    const sessionIds = new Set(sessionStore.sessions.map(s => s.session_id));
    for (const s of sessionStore.sessions) {
      if (s.parent_session_id && sessionIds.has(s.parent_session_id)) {
        const list = map.get(s.parent_session_id) || [];
        list.push(s);
        map.set(s.parent_session_id, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    }
    return map;
  }

  let selectedChildSessions = $derived(
    selectedSession
      ? sessionStore.sessions.filter(s => s.parent_session_id === selectedSession.session_id)
          .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      : []
  );

  let showTreeTab = $derived(
    selectedSession !== null && (selectedChildSessions.length > 0 || (selectedSession?.active_subagents ?? 0) > 0)
  );

  onMount(() => {
    const cleanupSessions = initSessionListener();
    const cleanupUpdater = initUpdaterListener();
    const cleanupNotifications = initNotificationListener();
    let cleanupConfirmClose: (() => void) | undefined;
    listen<number>('confirm-close', (event) => {
      confirmCloseCount = event.payload;
    }).then((fn) => {
      cleanupConfirmClose = fn;
    });
    return () => {
      cleanupSessions();
      cleanupUpdater();
      cleanupNotifications();
      cleanupConfirmClose?.();
    };
  });

  function openPreview(url: string) {
    previewUrl = url;
  }

  function closePreview() {
    previewUrl = null;
  }

  function toggleNotificationPanel(): void {
    notificationPanelOpen = !notificationPanelOpen;
  }

  function handleNotificationSelect(sessionId: string, cwd: string): void {
    const exists = sessionStore.sessions.some(s => s.session_id === sessionId);
    if (exists) {
      selectSession(sessionId);
    } else {
      const byCwd = sessionStore.sessions.find(s => s.cwd === cwd);
      if (byCwd) selectSession(byCwd.session_id);
    }
    notificationPanelOpen = false;
  }

  function dismissConfirmClose() {
    confirmCloseCount = null;
  }

  function handleHide() {
    confirmCloseCount = null;
    getCurrentWindow().hide();
  }

  function handleForceQuit() {
    invoke('force_quit');
  }

  function handleDismiss(sessionId: string) {
    invoke('dismiss_session', { sessionId });
    if (selectedSessionId === sessionId) {
      selectedSessionId = null;
    }
  }

  function selectSession(sessionId: string) {
    selectedSessionId = sessionId;
    invoke('mark_session_read', { sessionId });
  }

  async function switchTab(tab: 'active' | 'history' | 'settings') {
    activeTab = tab;
    if (tab === 'history') {
      await searchHistory();
    }
  }

  async function searchHistory(append: boolean = false) {
    if (!append) {
      historyLoading = true;
      historyHasMore = true;
    }
    const offset = append ? historySessions.length : 0;
    try {
      const results = await invoke<HistorySession[]>('search_session_history', {
        query: historySearchQuery || null,
        dateFilter: historyDateFilter,
        limit: 50,
        offset,
      });
      if (append) {
        historySessions = [...historySessions, ...results];
      } else {
        historySessions = results;
      }
      historyHasMore = results.length === 50;
    } catch (e) {
      console.error('Failed to search history:', e);
    } finally {
      historyLoading = false;
    }
  }

  function handleSearchInput(value: string) {
    historySearchQuery = value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchHistory(), 300);
  }

  function toggleDateFilter(filter: DateFilter) {
    historyDateFilter = historyDateFilter === filter ? null : filter;
    searchHistory();
  }

  function observeIntersection(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !historyLoading && historyHasMore) {
          searchHistory(true);
        }
      },
      { rootMargin: '100px' }
    );
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      },
    };
  }

  async function openNewSessionMenu() {
    try {
      recentCwds = await invoke<string[]>('get_recent_cwds');
    } catch (e) {
      console.error('Failed to load recent cwds:', e);
    }
    showNewSessionMenu = true;
  }

  async function spawnSession(cwd: string) {
    showNewSessionMenu = false;
    try {
      const sessionId = await invoke<string>('spawn_terminal', { cwd });
      selectedSessionId = sessionId;
    } catch (e) {
      console.error('Failed to spawn terminal:', e);
    }
  }

  async function openShell(sessionId: string) {
    try {
      const ptyId = await invoke<string>('open_session_shell', { sessionId });
      selectedSessionId = sessionId;
      tabState[sessionId] = 'terminal';
    } catch (e) {
      console.error('Failed to open shell:', e);
    }
  }

  function closeNewSessionMenu() {
    showNewSessionMenu = false;
  }

  async function handleHistoryOpenTerminal(cwd: string) {
    try {
      const sessionId = await invoke<string>('spawn_terminal', { cwd });
      selectedSessionId = sessionId;
      activeTab = 'active';
    } catch (e) {
      console.error('Failed to spawn terminal:', e);
    }
  }

  async function handleResumeSession(sessionId: string, cwd: string) {
    try {
      const result = await invoke<{ pty_id: string; resumed: boolean }>('resume_session', {
        sessionId,
        cwd,
      });
      selectedSessionId = result.pty_id;
      activeTab = 'active';
    } catch (e) {
      console.error('Failed to resume session:', e);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const action = matchShortcut(event);
    if (!action) return;

    event.preventDefault();
    const sessions = sessionStore.sessions;

    switch (action) {
      case 'next-session': {
        if (sessions.length === 0) return;
        const idx = sessions.findIndex(s => s.session_id === selectedSessionId);
        const next = idx < sessions.length - 1 ? idx + 1 : 0;
        selectSession(sessions[next].session_id);
        return;
      }
      case 'prev-session': {
        if (sessions.length === 0) return;
        const idx = sessions.findIndex(s => s.session_id === selectedSessionId);
        const prev = idx > 0 ? idx - 1 : sessions.length - 1;
        selectSession(sessions[prev].session_id);
        return;
      }
      case 'new-session':
        openNewSessionMenu();
        return;
      case 'dismiss-session':
        if (selectedSessionId) handleDismiss(selectedSessionId);
        return;
      case 'tab-active':
        switchTab('active');
        return;
      case 'tab-history':
        switchTab('history');
        return;
      case 'tab-settings':
        switchTab('settings');
        return;
      case 'close-modal':
        if (previewUrl) closePreview();
        else if (confirmCloseCount !== null) dismissConfirmClose();
        else if (showNewSessionMenu) closeNewSessionMenu();
        return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
  <Header
    sessionCount={sessionStore.count}
    globalState={sessionStore.globalState}
    unreadCount={notificationStore.unreadCount}
    onToggleNotifications={toggleNotificationPanel}
  />

  <div class="main-content">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="tabs">
          <button class="tab" class:active={activeTab === 'active'} onclick={() => switchTab('active')}>
            Active{#if sessionStore.count > 0} ({sessionStore.count}){/if}
          </button>
          <button class="tab" class:active={activeTab === 'history'} onclick={() => switchTab('history')}>
            History
          </button>
          <button class="tab" class:active={activeTab === 'settings'} onclick={() => switchTab('settings')}>
            Settings
          </button>
        </div>
        {#if activeTab === 'active'}
          <button class="new-session-btn" onclick={openNewSessionMenu} title="New session">+</button>
        {/if}
      </div>

      <div class="update-banner-wrapper">
        <UpdateBanner />
      </div>

      <div class="session-list">
        {#if activeTab === 'active'}
          {#if sessionStore.sessions.length === 0}
            <div class="empty">
              <HookSetup />
            </div>
          {:else}
            {#each renderList as item (item.key)}
              {#if item.type === 'group'}
                <ProjectGroup
                  cwd={item.cwd}
                  sessions={item.sessions}
                  {selectedSessionId}
                  onSelect={selectSession}
                  onDismiss={handleDismiss}
                  onOpenShell={openShell}
                  onPreviewUrl={openPreview}
                />
              {:else}
                <div
                  class="sidebar-session"
                  class:selected={selectedSessionId === item.session.session_id}
                  onclick={() => selectSession(item.session.session_id)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(item.session.session_id)}
                >
                  <SessionCard session={item.session} onDismiss={handleDismiss} onOpenShell={openShell} onPreviewUrl={openPreview} compact />
                </div>
                {#if getChildrenByParent().has(item.session.session_id)}
                  {#each getChildrenByParent().get(item.session.session_id) ?? [] as child (child.session_id)}
                    <div
                      class="sidebar-session child-session"
                      class:selected={selectedSessionId === child.session_id}
                      onclick={() => selectSession(child.session_id)}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(child.session_id)}
                    >
                      <SessionCard session={child} onDismiss={handleDismiss} onOpenShell={openShell} onPreviewUrl={openPreview} compact />
                    </div>
                  {/each}
                {/if}
              {/if}
            {/each}
          {/if}
        {:else if activeTab === 'history'}
          <div class="history-controls">
            <input
              class="history-search"
              type="text"
              placeholder="Search projects, branches..."
              value={historySearchQuery}
              oninput={(e) => handleSearchInput(e.currentTarget.value)}
            />
            <div class="filter-chips">
              <button
                class="chip"
                class:active={historyDateFilter === 'today'}
                onclick={() => toggleDateFilter('today')}
              >Today</button>
              <button
                class="chip"
                class:active={historyDateFilter === 'this_week'}
                onclick={() => toggleDateFilter('this_week')}
              >This Week</button>
              <button
                class="chip"
                class:active={historyDateFilter === 'this_month'}
                onclick={() => toggleDateFilter('this_month')}
              >This Month</button>
            </div>
          </div>
          {#if historyLoading}
            <div class="empty"><span class="loading-text">Loading...</span></div>
          {:else if historySessions.length === 0}
            <div class="empty"><span class="empty-text">No matching sessions</span></div>
          {:else}
            {#each historySessions as session (session.session_id)}
              <div
                class="sidebar-session"
                class:selected={selectedSessionId === session.session_id}
                onclick={() => { selectedSessionId = session.session_id; }}
                role="button"
                tabindex="0"
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (selectedSessionId = session.session_id)}
              >
                <SessionCard session={{
                  session_id: session.session_id,
                  cwd: session.cwd,
                  started_at: session.started_at,
                  git_branch: session.git_branch,
                  current_tool: null,
                  tool_history: session.tool_history.map(t => ({
                    tool_name: t.tool_name,
                    summary: t.summary,
                    timestamp: t.timestamp,
                    urls: [],
                    file_path: null,
                  })),
                  active_subagents: 0,
                  pending_approval: false,
                  processing: false,
                  has_unread: false,
                  source: 'external',
                  display_name: null,
                  metadata: {},
                  shell_pty_id: null,
                  parent_session_id: null,
                  alert_tier: null,
                  source_tool: null,
                }} onDismiss={handleDismiss} onPreviewUrl={openPreview} historyMode={true} endedAt={session.ended_at} compact />
              </div>
            {/each}
            {#if historyHasMore}
              <div class="load-sentinel" use:observeIntersection></div>
            {/if}
          {/if}
        {:else if activeTab === 'settings'}
          <Settings />
        {/if}
      </div>
    </div>

    <!-- Main area -->
    <div class="main-area">
      {#each sessionStore.sessions as session (session.session_id)}
        {#if session.source === 'spawned'}
          <div class="terminal-pane" class:active={selectedSessionId === session.session_id}>
            <Terminal ptyId={session.session_id} />
          </div>
        {/if}
      {/each}

      {#each sessionStore.sessions as session (session.session_id)}
        {#if session.shell_pty_id}
          <div class="terminal-pane" class:active={selectedSessionId === session.session_id && tabState[session.session_id] === 'terminal'}>
            <Terminal ptyId={session.shell_pty_id} />
          </div>
        {/if}
      {/each}

      {#if selectedSession?.source !== 'spawned'}
        {#if selectedSession}
          {#if selectedSession.shell_pty_id || showTreeTab}
            <div class="tab-bar">
              <button
                class="tab-btn"
                class:active={!tabState[selectedSession.session_id] || tabState[selectedSession.session_id] === 'detail'}
                onclick={() => { tabState[selectedSession.session_id] = 'detail'; }}
              >Detail</button>
              {#if showTreeTab}
                <button
                  class="tab-btn"
                  class:active={tabState[selectedSession.session_id] === 'tree'}
                  onclick={() => { tabState[selectedSession.session_id] = 'tree'; }}
                >Tree</button>
              {/if}
              {#if selectedSession.shell_pty_id}
                <button
                  class="tab-btn"
                  class:active={tabState[selectedSession.session_id] === 'terminal'}
                  onclick={() => { tabState[selectedSession.session_id] = 'terminal'; }}
                >Terminal</button>
              {/if}
            </div>
          {/if}
          {#if !tabState[selectedSession.session_id] || tabState[selectedSession.session_id] === 'detail'}
            <div class="detail-view">
              <SessionCard session={selectedSession} onDismiss={handleDismiss} onOpenShell={openShell} onPreviewUrl={openPreview} />
            </div>
          {:else if tabState[selectedSession.session_id] === 'tree'}
            <AgentTree
              parentSession={selectedSession}
              childSessions={selectedChildSessions}
              onDismiss={handleDismiss}
              onSelect={selectSession}
              onOpenShell={openShell}
            />
          {/if}
        {:else if activeTab === 'history' && selectedHistorySession}
          <div class="detail-view">
            <div class="history-actions">
              <button class="action-btn" onclick={() => handleHistoryOpenTerminal(selectedHistorySession.cwd)}>
                Open Terminal
              </button>
              <button class="action-btn action-btn-primary" onclick={() => handleResumeSession(selectedHistorySession.session_id, selectedHistorySession.cwd)}>
                Resume Session
              </button>
            </div>
            <SessionCard session={{
              session_id: selectedHistorySession.session_id,
              cwd: selectedHistorySession.cwd,
              started_at: selectedHistorySession.started_at,
              git_branch: selectedHistorySession.git_branch,
              current_tool: null,
              tool_history: selectedHistorySession.tool_history.map(t => ({
                tool_name: t.tool_name,
                summary: t.summary,
                timestamp: t.timestamp,
                urls: [],
                file_path: null,
              })),
              active_subagents: 0,
              pending_approval: false,
              processing: false,
              has_unread: false,
              source: 'external',
              display_name: null,
              metadata: {},
              shell_pty_id: null,
              parent_session_id: null,
              alert_tier: null,
              source_tool: null,
            }} onDismiss={handleDismiss} onPreviewUrl={openPreview} historyMode={true} endedAt={selectedHistorySession.ended_at} />
          </div>
        {:else}
          <div class="no-selection">
            <span class="no-selection-text">Select a session</span>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <NotificationPanel
    open={notificationPanelOpen}
    onClose={() => { notificationPanelOpen = false; }}
    onSelectSession={handleNotificationSelect}
  />

  <!-- New Session Modal -->
  {#if showNewSessionMenu}
    <div class="modal-backdrop" onclick={closeNewSessionMenu} role="presentation">
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
        <div class="modal-header">
          <span class="modal-title">New Session</span>
          <button class="modal-close" onclick={closeNewSessionMenu}>x</button>
        </div>
        <div class="modal-body">
          {#if recentCwds.length > 0}
            <div class="recent-label">Recent directories</div>
            {#each recentCwds as cwd}
              <button class="cwd-option" onclick={() => spawnSession(cwd)}>
                <span class="cwd-project">{getProjectName(cwd)}</span>
                <span class="cwd-path">{shortenPath(cwd)}</span>
              </button>
            {/each}
          {:else}
            <div class="empty-text">No recent sessions</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Preview Modal -->
  {#if previewUrl}
    <PreviewModal url={previewUrl} onClose={closePreview} />
  {/if}

  <!-- Confirm Close Modal -->
  {#if confirmCloseCount !== null}
    <div class="modal-backdrop" onclick={dismissConfirmClose} role="presentation">
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
        <div class="modal-header">
          <span class="modal-title">Active Sessions</span>
          <button class="modal-close" onclick={dismissConfirmClose}>x</button>
        </div>
        <div class="modal-body">
          <p class="confirm-text">
            {confirmCloseCount} {confirmCloseCount === 1 ? 'session is' : 'sessions are'} still running. What would you like to do?
          </p>
          <div class="confirm-actions">
            <button class="confirm-btn confirm-btn-cancel" onclick={dismissConfirmClose}>Cancel</button>
            <button class="confirm-btn confirm-btn-hide" onclick={handleHide}>Hide Window</button>
            <button class="confirm-btn confirm-btn-quit" onclick={handleForceQuit}>Quit</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }

  .main-content {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar {
    width: 320px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-right: 8px;
  }

  .tabs {
    display: flex;
    flex: 1;
    padding: 0 12px;
    gap: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 8px 12px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--active);
  }

  .new-session-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }

  .new-session-btn:hover {
    background: var(--border);
    color: var(--text-primary);
  }

  .update-banner-wrapper {
    padding: 8px 12px 0;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-session {
    cursor: pointer;
    transition: background 0.1s;
  }

  .sidebar-session:hover {
    background: var(--card-bg);
  }

  .sidebar-session.selected {
    background: var(--card-bg);
    outline: 1px solid var(--border);
  }

  .child-session {
    margin-left: 20px;
    border-left: 1px solid var(--border);
    padding-left: 8px;
  }

  .main-area {
    flex: 1;
    overflow: hidden;
    display: flex;
    position: relative;
  }

  .terminal-pane {
    position: absolute;
    inset: 0;
    display: flex;
    visibility: hidden;
  }

  .terminal-pane.active {
    visibility: visible;
  }

  .detail-view {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border);
    padding: 0 12px;
    flex-shrink: 0;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 8px 12px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab-btn:hover {
    color: var(--text-secondary);
  }

  .tab-btn.active {
    color: var(--text-primary);
    border-bottom-color: var(--active);
  }

  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .no-selection-text {
    color: var(--text-muted);
    font-size: 14px;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--card-bg);
    border: 1px solid var(--border);
    width: 400px;
    max-height: 500px;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
  }

  .modal-body {
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .recent-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 8px;
  }

  .cwd-option {
    background: none;
    border: 1px solid transparent;
    color: var(--text-primary);
    cursor: pointer;
    padding: 8px 12px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: background 0.1s;
  }

  .cwd-option:hover {
    background: var(--tool-bg);
    border-color: var(--border);
  }

  .cwd-project {
    font-size: 13px;
    font-weight: 600;
  }

  .cwd-path {
    font-size: 11px;
    color: var(--text-muted);
  }

  .confirm-text {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 16px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 14px;
    transition: background 0.1s;
  }

  .confirm-btn-cancel {
    background: none;
    color: var(--text-secondary);
  }

  .confirm-btn-cancel:hover {
    background: var(--tool-bg);
  }

  .confirm-btn-hide {
    background: none;
    color: var(--text-primary);
  }

  .confirm-btn-hide:hover {
    background: var(--tool-bg);
  }

  .confirm-btn-quit {
    background: var(--danger, #c53030);
    color: #fff;
    border-color: transparent;
  }

  .confirm-btn-quit:hover {
    opacity: 0.9;
  }

  .loading-text,
  .empty-text {
    color: var(--text-muted);
    font-size: 13px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    padding: 40px;
  }

  .history-controls {
    padding: 8px 8px 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .history-search {
    width: 100%;
    padding: 6px 10px;
    background: var(--tool-bg);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .history-search:focus {
    border-color: var(--active);
  }

  .history-search::placeholder {
    color: var(--text-muted);
  }

  .filter-chips {
    display: flex;
    gap: 4px;
  }

  .chip {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 8px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .chip:hover {
    color: var(--text-secondary);
    border-color: var(--text-muted);
  }

  .chip.active {
    background: var(--active);
    color: var(--bg);
    border-color: var(--active);
  }

  .load-sentinel {
    height: 1px;
  }

  .history-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .action-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 14px;
    transition: background 0.1s, color 0.1s;
  }

  .action-btn:hover {
    background: var(--tool-bg);
    color: var(--text-primary);
  }

  .action-btn-primary {
    background: var(--active);
    color: var(--bg);
    border-color: var(--active);
  }

  .action-btn-primary:hover {
    opacity: 0.9;
  }
</style>
