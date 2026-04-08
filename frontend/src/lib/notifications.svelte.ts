import type { AppNotification } from "./types";

let notifications = $state<Record<string, AppNotification>>({});

export function getNotifications(): Record<string, AppNotification> {
  return notifications;
}

export function addNotification(n: AppNotification): void {
  notifications = { ...notifications, [n.sessionID]: n };
}

export function dismissNotification(sessionID: string): void {
  const { [sessionID]: _, ...rest } = notifications;
  notifications = rest;
}

export function hasNotification(sessionID: string): boolean {
  return sessionID in notifications;
}
