<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ShieldAlert, MessageSquare, Play, Circle } from 'lucide-svelte';

  interface Props {
    sessionCount: number;
    globalState: 'approval' | 'input' | 'running' | 'idle';
  }

  let { sessionCount, globalState }: Props = $props();

  const stateConfig = {
    approval: { icon: ShieldAlert, colorClass: 'status-orange' },
    input: { icon: MessageSquare, colorClass: 'status-blue' },
    running: { icon: Play, colorClass: 'status-green' },
    idle: { icon: Circle, colorClass: 'status-gray' },
  };

  let config = $derived(stateConfig[globalState]);

  function minimize() {
    getCurrentWindow().minimize();
  }

  function close() {
    getCurrentWindow().hide();
  }
</script>

<header class="header" data-tauri-drag-region>
  <div class="header-left" data-tauri-drag-region>
    <span class="app-name" data-tauri-drag-region>Jackdaw</span>
  </div>
  <div class="header-right">
    {#if sessionCount > 0}
      {#if config}
        {@const Icon = config.icon}
        <span class="header-status-icon {config.colorClass}">
          <Icon size={12} strokeWidth={2} />
        </span>
      {/if}
      <span class="status-text" data-tauri-drag-region>{sessionCount} active session{sessionCount !== 1 ? 's' : ''}</span>
    {:else}
      <span class="status-text" data-tauri-drag-region>No active sessions</span>
    {/if}
    <div class="window-controls">
      <button class="window-btn" onclick={minimize} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="window-btn close-btn" onclick={close} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</header>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--border);
  }

  .app-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-status-icon {
    display: inline-flex;
    align-items: center;
  }

  .status-green { color: var(--active); }
  .status-blue { color: var(--attention); }
  .status-orange { color: var(--attention); }
  .status-gray { color: var(--text-muted); }

  .status-text {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .window-controls {
    display: flex;
    margin-left: 8px;
  }

  .window-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    width: 32px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }

  .window-btn :global(svg) {
    pointer-events: none;
  }

  .window-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .close-btn:hover {
    background: #c42b1c;
    color: white;
  }
</style>
