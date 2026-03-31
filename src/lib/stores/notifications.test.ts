import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

const { notificationStore } = await import('./notifications.svelte');

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    session_id: 'test-session',
    event_type: 'Stop',
    title: 'Waiting for Input',
    body: 'Session in /tmp is waiting',
    cwd: '/tmp',
    is_read: false,
    created_at: '2026-03-30T12:00:00Z',
    ...overrides,
  };
}

describe('NotificationStore', () => {
  it('unreadCount reflects unread notifications', () => {
    notificationStore.notifications = [
      makeNotification({ id: 1, is_read: false }),
      makeNotification({ id: 2, is_read: true }),
      makeNotification({ id: 3, is_read: false }),
    ];
    expect(notificationStore.unreadCount).toBe(2);
  });

  it('unreadCount is 0 when all read', () => {
    notificationStore.notifications = [
      makeNotification({ id: 1, is_read: true }),
    ];
    expect(notificationStore.unreadCount).toBe(0);
  });

  it('unreadCount is 0 when empty', () => {
    notificationStore.notifications = [];
    expect(notificationStore.unreadCount).toBe(0);
  });
});
