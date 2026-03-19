<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  onMount(() => {
    const cleanup = initSessionListener();
    return () => cleanup();
  });

  function handleDismiss(sessionId: string) {
    invoke('dismiss_session', { sessionId });
  }
</script>

<div class="dashboard">
  <Header sessionCount={sessionStore.count} runningCount={sessionStore.runningCount} />

  <div class="session-list">
    {#if sessionStore.sessions.length === 0}
      <div class="empty">
        <HookSetup />
      </div>
    {:else}
      {#each sessionStore.sessions as session (session.session_id)}
        <SessionCard {session} onDismiss={handleDismiss} />
      {/each}
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

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
