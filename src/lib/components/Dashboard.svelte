<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import Settings from './Settings.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { initUpdaterListener } from '$lib/stores/updater.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { HistorySession } from '$lib/types';

  let activeTab = $state<'active' | 'history' | 'settings'>('active');
  let historySessions = $state<HistorySession[]>([]);
  let historyLoading = $state(false);

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
</script>

<div class="dashboard">
  <Header sessionCount={sessionStore.count} globalState={sessionStore.globalState} />

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
          <SessionCard {session} onDismiss={handleDismiss} />
        {/each}
      {/if}
    {:else if activeTab === 'history'}
      {#if historyLoading}
        <div class="empty"><span class="loading-text">Loading history...</span></div>
      {:else if historySessions.length === 0}
        <div class="empty"><span class="empty-text">No session history yet</span></div>
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

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
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
    padding: 8px 16px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--active);
  }

  .loading-text,
  .empty-text {
    color: var(--text-muted);
    font-size: 13px;
  }

  .update-banner-wrapper {
    padding: 12px 12px 0;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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
