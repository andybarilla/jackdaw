import { describe, it, expect, vi } from 'vitest';

// Mock Tauri event API before importing the store
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(() => Promise.resolve({ get: vi.fn(() => Promise.resolve(null)) })),
  },
}));

vi.mock('./alertSound.svelte', () => ({
  playAlertSound: vi.fn(),
}));

// Dynamic import after mock is set up
const { sessionStore } = await import('./sessions.svelte');

describe('SessionStore', () => {
  function makeSession(overrides: Record<string, unknown> = {}) {
    return {
      session_id: 'test-session',
      cwd: '/tmp',
      started_at: '2026-03-19T12:00:00Z',
      git_branch: null,
      current_tool: null,
      tool_history: [],
      active_subagents: 0,
      pending_approval: false,
      processing: false,
      has_unread: false,
      source: 'external' as const,
      display_name: null,
      metadata: {},
      shell_pty_id: null,
      parent_session_id: null,
      alert_tier: null,
      alert_volume: null,
      source_tool: null,
      profile_name: null,
      ...overrides,
    };
  }

  it('count returns session length', () => {
    sessionStore.sessions = [makeSession(), makeSession({ session_id: 's2' })];
    expect(sessionStore.count).toBe(2);
  });

  it('count is 0 when empty', () => {
    sessionStore.sessions = [];
    expect(sessionStore.count).toBe(0);
  });

  it('globalState is idle when no sessions', () => {
    sessionStore.sessions = [];
    expect(sessionStore.globalState).toBe('idle');
  });

  it('globalState is approval when any session has pending_approval', () => {
    sessionStore.sessions = [
      makeSession({ session_id: 's1', current_tool: { tool_name: 'Bash', timestamp: '', summary: null, urls: [], file_path: null } }),
      makeSession({ session_id: 's2', pending_approval: true }),
    ];
    expect(sessionStore.globalState).toBe('approval');
  });

  it('globalState is input when a session is idle (no tool, no subagents, not processing)', () => {
    sessionStore.sessions = [makeSession()];
    expect(sessionStore.globalState).toBe('input');
  });

  it('globalState is running when all sessions have tool/subagents/processing', () => {
    sessionStore.sessions = [
      makeSession({ session_id: 's1', current_tool: { tool_name: 'Bash', timestamp: '', summary: null, urls: [], file_path: null } }),
      makeSession({ session_id: 's2', active_subagents: 1 }),
    ];
    expect(sessionStore.globalState).toBe('running');
  });

  it('globalState is running for processing session', () => {
    sessionStore.sessions = [makeSession({ processing: true })];
    expect(sessionStore.globalState).toBe('running');
  });

  it('globalState approval takes priority over input', () => {
    sessionStore.sessions = [
      makeSession({ session_id: 's1' }), // input state
      makeSession({ session_id: 's2', pending_approval: true }), // approval state
    ];
    expect(sessionStore.globalState).toBe('approval');
  });

  it('globalState input takes priority over running', () => {
    sessionStore.sessions = [
      makeSession({ session_id: 's1' }), // input state (no tool, no subagents, not processing)
      makeSession({ session_id: 's2', current_tool: { tool_name: 'Bash', timestamp: '', summary: null, urls: [], file_path: null } }), // running
    ];
    expect(sessionStore.globalState).toBe('input');
  });
});
