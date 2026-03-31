<script lang="ts">
  import { notificationStore } from '$lib/stores/notifications.svelte';
  import { relativeTime, getProjectName } from '$lib/utils';
  import type { Notification } from '$lib/types';

  interface Props {
    open: boolean;
    onClose: () => void;
    onSelectSession: (sessionId: string) => void;
  }

  let { open, onClose, onSelectSession }: Props = $props();

  let filters = $state<Set<string>>(new Set(['Notification', 'Stop', 'SessionEnd']));
  let now = $state(Date.now());

  $effect(() => {
    if (!open) return;
    const timer = setInterval(() => { now = Date.now(); }, 30000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (open) {
      notificationStore.load();
      filters = new Set(['Notification', 'Stop', 'SessionEnd']);
    }
  });

  let filtered = $derived(
    notificationStore.notifications.filter(n => filters.has(n.event_type))
  );

  function toggleFilter(eventType: string): void {
    const next = new Set(filters);
    if (next.has(eventType)) {
      next.delete(eventType);
    } else {
      next.add(eventType);
    }
    filters = next;
  }

  function handleClick(notification: Notification): void {
    notificationStore.markRead(notification.id);
    onSelectSession(notification.session_id);
    onClose();
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }

  async function loadMore(): Promise<void> {
    await notificationStore.load(50, notificationStore.notifications.length);
  }

  function timeAgo(isoDate: string): string {
    void now;
    return relativeTime(isoDate);
  }

  const eventTypeLabel: Record<string, string> = {
    Notification: 'Approval',
    Stop: 'Input',
    SessionEnd: 'Ended',
  };

  const eventTypeColorVar: Record<string, string> = {
    Notification: 'var(--state-approval)',
    Stop: 'var(--state-input)',
    SessionEnd: 'var(--state-idle)',
  };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel-backdrop" onclick={handleBackdropClick}>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Notifications</span>
        <div class="panel-actions">
          <button class="mark-all-btn" onclick={() => notificationStore.markAllRead()}>Mark all read</button>
          <button class="close-btn" onclick={onClose}>×</button>
        </div>
      </div>

      <div class="filter-bar">
        {#each ['Notification', 'Stop', 'SessionEnd'] as eventType}
          <button
            class="filter-pill"
            class:active={filters.has(eventType)}
            style="--pill-color: {eventTypeColorVar[eventType]}"
            onclick={() => toggleFilter(eventType)}
          >
            {eventTypeLabel[eventType]}
          </button>
        {/each}
      </div>

      <div class="notification-list">
        {#if filtered.length === 0}
          <div class="empty-state">
            {notificationStore.notifications.length === 0 ? 'No notifications' : 'No matching notifications'}
          </div>
        {:else}
          {#each filtered as notification (notification.id)}
            <button class="notification-entry" class:unread={!notification.is_read} onclick={() => handleClick(notification)}>
              <span class="event-badge" style="background: {eventTypeColorVar[notification.event_type]}">
                {eventTypeLabel[notification.event_type]}
              </span>
              <div class="entry-content">
                <span class="entry-project">{getProjectName(notification.cwd)}</span>
                <span class="entry-body">{notification.body}</span>
              </div>
              <div class="entry-meta">
                <span class="entry-time" title={notification.created_at}>{timeAgo(notification.created_at)}</span>
                {#if !notification.is_read}
                  <span class="unread-dot"></span>
                {/if}
              </div>
            </button>
          {/each}
          <button class="load-more-btn" onclick={loadMore}>Load more</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 380px;
    background: var(--bg);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mark-all-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 4px 8px;
    transition: color 0.15s;
  }

  .mark-all-btn:hover {
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .filter-bar {
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }

  .filter-pill {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 12px;
    transition: all 0.15s;
  }

  .filter-pill.active {
    border-color: var(--pill-color);
    color: var(--pill-color);
  }

  .filter-pill:hover {
    border-color: var(--text-secondary);
  }

  .notification-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .notification-entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    width: 100%;
  }

  .notification-entry:hover {
    background: var(--card-bg);
  }

  .notification-entry.unread {
    background: rgba(255, 255, 255, 0.02);
  }

  .event-badge {
    font-size: 10px;
    font-weight: 600;
    color: #000;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-project {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .entry-body {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }

  .entry-time {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .unread-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--active);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-muted);
    font-size: 13px;
    padding: 40px;
  }

  .load-more-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 12px;
    text-align: center;
    transition: color 0.15s;
  }

  .load-more-btn:hover {
    color: var(--text-primary);
  }
</style>
