<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import Settings from './Settings.svelte';
  import Terminal from './Terminal.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { initUpdaterListener } from '$lib/stores/updater.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { shortenPath, getProjectName } from '$lib/utils';
  import { matchShortcut } from '$lib/shortcuts';
  import type { HistorySession } from '$lib/types';

  let activeTab = $state<'active' | 'history' | 'settings'>('active');
  let selectedSessionId = $state<string | null>(null);
  let historySessions = $state<HistorySession[]>([]);
  let historyLoading = $state(false);
  let showNewSessionMenu = $state(false);
  let recentCwds = $state<string[]>([]);

  let selectedSession = $derived(
    sessionStore.sessions.find(s => s.session_id === selectedSessionId) ?? null
  );

  onMount(() => {
    const cleanupSessions = initSessionListener();
    const cleanupUpdater = initUpdaterListener();
    return () => {
      cleanupSessions();
      cleanupUpdater();
    };
  });

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
      await loadHistory();
    }
  }

  async function loadHistory() {
    historyLoading = true;
    try {
      historySessions = await invoke<HistorySession[]>('get_session_history', {
        limit: 50,
        offset: 0,
      });
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      historyLoading = false;
    }
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

  function closeNewSessionMenu() {
    showNewSessionMenu = false;
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
        if (showNewSessionMenu) closeNewSessionMenu();
        return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout">
  <Header sessionCount={sessionStore.count} globalState={sessionStore.globalState} />

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
            {#each sessionStore.sessions as session (session.session_id)}
              <div
                class="sidebar-session"
                class:selected={selectedSessionId === session.session_id}
                onclick={() => selectSession(session.session_id)}
                role="button"
                tabindex="0"
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(session.session_id)}
              >
                <SessionCard {session} onDismiss={handleDismiss} compact />
              </div>
            {/each}
          {/if}
        {:else if activeTab === 'history'}
          {#if historyLoading}
            <div class="empty"><span class="loading-text">Loading...</span></div>
          {:else if historySessions.length === 0}
            <div class="empty"><span class="empty-text">No history</span></div>
          {:else}
            {#each historySessions as session (session.session_id)}
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
                })),
                active_subagents: 0,
                pending_approval: false,
                processing: false,
                has_unread: false,
                source: 'external',
              }} onDismiss={handleDismiss} historyMode={true} endedAt={session.ended_at} />
            {/each}
          {/if}
        {:else if activeTab === 'settings'}
          <Settings />
        {/if}
      </div>
    </div>

    <!-- Main area -->
    <div class="main-area">
      {#if selectedSession?.source === 'spawned'}
        <Terminal sessionId={selectedSession.session_id} />
      {:else if selectedSession}
        <div class="detail-view">
          <SessionCard session={selectedSession} onDismiss={handleDismiss} />
        </div>
      {:else}
        <div class="no-selection">
          <span class="no-selection-text">Select a session</span>
        </div>
      {/if}
    </div>
  </div>

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

  .main-area {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .detail-view {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
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
</style>
