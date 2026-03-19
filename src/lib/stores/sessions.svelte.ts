import { listen } from '@tauri-apps/api/event';
import type { Session } from '$lib/types';

class SessionStore {
  sessions = $state<Session[]>([]);

  get count(): number {
    return this.sessions.length;
  }

  get runningCount(): number {
    return this.sessions.filter(s => s.current_tool !== null).length;
  }
}

export const sessionStore = new SessionStore();

export function initSessionListener(): () => void {
  let unlisten: (() => void) | undefined;

  listen<Session[]>('session-update', (event) => {
    sessionStore.sessions = event.payload;
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
