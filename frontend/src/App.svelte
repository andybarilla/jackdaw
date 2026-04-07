<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import { CreateSession, ListSessions, KillSession } from "../wailsjs/go/main/App";
  import type { SessionInfo } from "./lib/types";
  import Sidebar from "./lib/Sidebar.svelte";
  import Terminal from "./lib/Terminal.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";
  import { getKeymap } from "./lib/config.svelte";
  import { matchKeybinding } from "./lib/keybindings";

  let sessions = $state<SessionInfo[]>([]);
  let activeSessionId = $state<string | null>(null);
  let showNewDialog = $state(false);
  let sidebarVisible = $state(true);
  let cleanups: Array<() => void> = [];

  const actions: Record<string, () => void> = {
    "session.new": () => (showNewDialog = true),
    "session.kill": () => {
      if (activeSessionId) handleKill(activeSessionId);
    },
    "session.next": () => selectAdjacentSession(1),
    "session.prev": () => selectAdjacentSession(-1),
    "app.toggleSidebar": () => (sidebarVisible = !sidebarVisible),
  };

  function selectAdjacentSession(delta: number): void {
    if (sessions.length === 0) return;
    const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
    const nextIndex =
      (currentIndex + delta + sessions.length) % sessions.length;
    activeSessionId = sessions[nextIndex].id;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const action = matchKeybinding(event, getKeymap());
    if (action && actions[action]) {
      event.preventDefault();
      actions[action]();
    }
  }

  onMount(async () => {
    sessions = ((await ListSessions()) || []) as SessionInfo[];

    const cancel = EventsOn("sessions-updated", (updated: unknown) => {
      sessions = (updated || []) as SessionInfo[];
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

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  {#if sidebarVisible}
    <Sidebar
      {sessions}
      {activeSessionId}
      onSelect={(id) => (activeSessionId = id)}
      onNew={() => (showNewDialog = true)}
      onKill={handleKill}
    />
  {/if}

  <div class="content">
    {#each sessions as session (session.id)}
      <div class="terminal-wrapper" class:active={session.id === activeSessionId}>
        <Terminal sessionId={session.id} visible={session.id === activeSessionId} />
      </div>
    {/each}
    {#if !activeSession}
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
    position: relative;
  }

  .terminal-wrapper {
    position: absolute;
    inset: 0;
    visibility: hidden;
  }

  .terminal-wrapper.active {
    visibility: visible;
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
