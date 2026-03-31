<script lang="ts">
  import { ShieldAlert, MessageSquare, Play, Circle, Bell } from 'lucide-svelte';

  interface Props {
    sessionCount: number;
    globalState: 'approval' | 'input' | 'running' | 'idle';
    unreadCount: number;
    onToggleNotifications: () => void;
  }

  let { sessionCount, globalState, unreadCount, onToggleNotifications }: Props = $props();

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
    <button class="bell-btn" onclick={onToggleNotifications} title="Notifications">
      <Bell size={14} strokeWidth={2} />
      {#if unreadCount > 0}
        <span class="bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {/if}
    </button>
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

  .bell-btn {
    position: relative;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    padding: 4px;
    transition: color 0.15s;
  }

  .bell-btn:hover {
    color: var(--text-primary);
  }

  .bell-badge {
    position: absolute;
    top: -2px;
    right: -4px;
    background: var(--active);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    min-width: 14px;
    height: 14px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
  }
</style>
