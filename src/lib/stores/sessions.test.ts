import { describe, it, expect, vi } from 'vitest';

// Mock Tauri event API before importing the store
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Dynamic import after mock is set up
const { sessionStore } = await import('./sessions.svelte');

describe('SessionStore', () => {
  function makeSession(overrides: Record<string, unknown> = {}) {
    return {
      session_id: 'test-session',
      cwd: '/tmp',
      started_at: '2026-03-19T12:00:00Z',
      current_tool: null,
      tool_history: [],
      active_subagents: 0,
      pending_approval: false,
      processing: false,
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

  it('runningCount counts sessions with current_tool', () => {
    sessionStore.sessions = [
      makeSession({ current_tool: { tool_name: 'Bash', timestamp: '', summary: null } }),
      makeSession({ session_id: 's2' }),
    ];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount counts sessions with active_subagents', () => {
    sessionStore.sessions = [makeSession({ active_subagents: 2 })];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount counts sessions with processing', () => {
    sessionStore.sessions = [makeSession({ processing: true })];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount does not count pending-only sessions', () => {
    sessionStore.sessions = [makeSession({ pending_approval: true })];
    expect(sessionStore.runningCount).toBe(0);
  });

  it('runningCount excludes pending sessions with current_tool', () => {
    sessionStore.sessions = [
      makeSession({ pending_approval: true, current_tool: { tool_name: 'Bash', timestamp: '', summary: null } }),
    ];
    expect(sessionStore.runningCount).toBe(0);
  });
});
