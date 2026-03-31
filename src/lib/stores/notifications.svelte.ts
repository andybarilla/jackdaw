import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Notification } from '$lib/types';

class NotificationStore {
  notifications = $state<Notification[]>([]);

  get unreadCount(): number {
    return this.notifications.filter(n => !n.is_read).length;
  }

  async load(limit: number = 50, offset: number = 0, eventTypeFilter?: string): Promise<void> {
    const result = await invoke<Notification[]>('get_notifications', {
      limit,
      offset,
      eventTypeFilter: eventTypeFilter ?? null,
    });
    if (offset === 0) {
      this.notifications = result;
    } else {
      this.notifications = [...this.notifications, ...result];
    }
  }

  prepend(notification: Notification): void {
    this.notifications = [notification, ...this.notifications];
  }

  async markRead(id: number): Promise<void> {
    await invoke('mark_notification_read', { id });
    this.notifications = this.notifications.map(n =>
      n.id === id ? { ...n, is_read: true } : n
    );
  }

  async markAllRead(): Promise<void> {
    await invoke('mark_all_notifications_read');
    this.notifications = this.notifications.map(n => ({ ...n, is_read: true }));
  }
}

export const notificationStore = new NotificationStore();

export function initNotificationListener(): () => void {
  let unlisten: (() => void) | undefined;

  listen<Notification>('notification-event', (event) => {
    notificationStore.prepend(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
