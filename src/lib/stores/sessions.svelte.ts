import { listen } from '@tauri-apps/api/event';
import type { Session } from '$lib/types';

class SessionStore {
  sessions = $state<Session[]>([]);

  get count(): number {
    return this.sessions.length;
  }

  get hasUnread(): boolean {
    return this.sessions.some(s => s.has_unread);
  }

  get globalState(): 'approval' | 'input' | 'running' | 'idle' {
    if (this.sessions.length === 0) return 'idle';
    for (const s of this.sessions) {
      if (s.pending_approval) return 'approval';
    }
    for (const s of this.sessions) {
      if (s.current_tool === null && s.active_subagents === 0 && !s.processing) return 'input';
    }
    return 'running';
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
