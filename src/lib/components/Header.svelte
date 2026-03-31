<script lang="ts">
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
</script>

<header class="header">
  <div class="header-left">
    <span class="app-name">Jackdaw</span>
  </div>
  <div class="header-right">
    {#if sessionCount > 0}
      {#if config}
        {@const Icon = config.icon}
        <span class="header-status-icon {config.colorClass}">
          <Icon size={12} strokeWidth={2} />
        </span>
      {/if}
      <span class="status-text">{sessionCount} active session{sessionCount !== 1 ? 's' : ''}</span>
    {:else}
      <span class="status-text">No active sessions</span>
    {/if}
  </div>
</header>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
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
</style>
