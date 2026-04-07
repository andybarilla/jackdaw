<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import { CreateSession, ListSessions, KillSession } from "../wailsjs/go/main/App";
  import type { SessionInfo } from "./lib/types";
  import Sidebar from "./lib/Sidebar.svelte";
  import Terminal from "./lib/Terminal.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";

  let sessions = $state<SessionInfo[]>([]);
  let activeSessionId = $state<string | null>(null);
  let showNewDialog = $state(false);
  let cleanups: Array<() => void> = [];

  onMount(async () => {
    sessions = (await ListSessions()) || [];

    const cancel = EventsOn("sessions-updated", (updated: SessionInfo[]) => {
      sessions = updated || [];
    });
    cleanups.push(cancel);
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
  });

  async function handleNewSession(workDir: string) {
    showNewDialog = false;
    const info = await CreateSession(workDir);
    activeSessionId = info.id;
  }

  async function handleKill(id: string) {
    await KillSession(id);
    if (activeSessionId === id) {
      activeSessionId = null;
    }
  }

  let activeSession = $derived(
    sessions.find((s) => s.id === activeSessionId),
  );
</script>

<main>
  <Sidebar
    {sessions}
    {activeSessionId}
    onSelect={(id) => (activeSessionId = id)}
    onNew={() => (showNewDialog = true)}
    onKill={handleKill}
  />

  <div class="content">
    {#if activeSession}
      {#key activeSession.id}
        <Terminal sessionId={activeSession.id} />
      {/key}
    {:else}
      <div class="empty">
        <p>No session selected</p>
        <button onclick={() => (showNewDialog = true)}>
          Launch a new session
        </button>
      </div>
    {/if}
  </div>

  {#if showNewDialog}
    <NewSessionDialog
      onSubmit={handleNewSession}
      onCancel={() => (showNewDialog = false)}
    />
  {/if}
</main>

<style>
  main {
    display: flex;
    height: 100%;
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-muted);
  }

  .empty button {
    padding: 8px 16px;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
</style>
