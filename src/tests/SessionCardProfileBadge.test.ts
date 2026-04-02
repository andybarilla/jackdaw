import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));
import SessionCard from '$lib/components/SessionCard.svelte';
import type { Session } from '$lib/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'test-session-id',
    cwd: '/home/user/project',
    started_at: new Date().toISOString(),
    git_branch: null,
    current_tool: null,
    tool_history: [],
    active_subagents: 0,
    pending_approval: false,
    processing: false,
    has_unread: false,
    source: 'external',
    display_name: null,
    metadata: {},
    shell_pty_id: null,
    parent_session_id: null,
    alert_tier: null,
    source_tool: null,
    profile_name: null,
    ...overrides,
  };
}

describe('SessionCard profile badge', () => {
  it('shows profile badge when profile_name is set', () => {
    const { getByText } = render(SessionCard, {
      props: { session: makeSession({ profile_name: 'Work' }), onDismiss: vi.fn() },
    });
    expect(getByText('Work')).toBeTruthy();
  });

  it('hides profile badge when profile_name is null', () => {
    const { queryByTestId } = render(SessionCard, {
      props: { session: makeSession({ profile_name: null }), onDismiss: vi.fn() },
    });
    expect(queryByTestId('profile-badge')).toBeNull();
  });
});
