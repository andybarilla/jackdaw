// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TreeNode from './TreeNode.svelte';
import type { Session } from '$lib/types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'test-session',
    cwd: '/home/user/project',
    started_at: '2026-04-01T12:00:00Z',
    git_branch: null,
    current_tool: null,
    tool_history: [],
    active_subagents: 0,
    pending_approval: false,
    processing: true,
    has_unread: false,
    source: 'external',
    display_name: null,
    metadata: {},
    shell_pty_id: null,
    parent_session_id: null,
    alert_tier: null,
    source_tool: null,
    ...overrides,
  };
}

describe('TreeNode', () => {
  const noop = () => {};

  it('renders session name from cwd', () => {
    render(TreeNode, {
      props: { session: makeSession(), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('project')).toBeTruthy();
  });

  it('renders display_name when set', () => {
    render(TreeNode, {
      props: { session: makeSession({ display_name: 'My Agent' }), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('renders state badge', () => {
    render(TreeNode, {
      props: { session: makeSession({ processing: true }), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('RUNNING')).toBeTruthy();
  });

  it('renders current tool', () => {
    const session = makeSession({
      current_tool: { tool_name: 'Bash', timestamp: '2026-04-01T12:00:00Z', summary: 'npm test' },
    });
    render(TreeNode, {
      props: { session, onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
  });

  it('renders action buttons', () => {
    render(TreeNode, {
      props: { session: makeSession(), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });
});
