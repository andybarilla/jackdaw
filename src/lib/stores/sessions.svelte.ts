import { listen } from '@tauri-apps/api/event';
import type { Session } from '$lib/types';
import { playAlertSound } from './alertSound.svelte';
import { Store } from '@tauri-apps/plugin-store';

class SessionStore {
  sessions = $state<Session[]>([]);
  #alertVolume = 80;

  constructor() {
    Store.load('settings.json').then(async (store) => {
      const vol = await store.get<number>('alert_volume');
      if (vol !== undefined && vol !== null) {
        this.#alertVolume = vol;
      }
    });
  }

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

  setVolume(volume: number): void {
    this.#alertVolume = volume;
  }

  handleAlerts(sessions: Session[]): void {
    for (const session of sessions) {
      if (session.alert_tier && session.alert_tier !== 'off') {
        playAlertSound(session.alert_tier, session.alert_volume ?? this.#alertVolume);
        break; // Play only the highest-priority alert sound per update
      }
    }
  }
}

export const sessionStore = new SessionStore();

export function initSessionListener(): () => void {
  let unlisten: (() => void) | undefined;

  listen<Session[]>('session-update', (event) => {
    sessionStore.handleAlerts(event.payload);
    sessionStore.sessions = event.payload;
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
