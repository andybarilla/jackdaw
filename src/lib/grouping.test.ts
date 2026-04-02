import { describe, it, expect } from 'vitest';
import { buildRenderList } from './grouping';
import type { Session } from '$lib/types';

function makeSession(id: string, cwd: string, startedAt: string): Session {
  return {
    session_id: id,
    cwd,
    started_at: startedAt,
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
  };
}

describe('buildRenderList', () => {
  it('returns empty list for no sessions', () => {
    expect(buildRenderList([])).toEqual([]);
  });

  it('returns bare session items when all cwds are unique', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/b', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'session')).toBe(true);
  });

  it('groups sessions sharing a cwd', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    if (result[0].type === 'group') {
      expect(result[0].sessions).toHaveLength(2);
      expect(result[0].cwd).toBe('/a');
      expect(result[0].key).toBe('group:/a');
    }
  });

  it('mixes groups and singles', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T02:00:00Z'),
      makeSession('s3', '/b', '2026-03-30T03:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(2);
    // /b is newest, so it comes first
    expect(result[0].type).toBe('session');
    expect(result[1].type).toBe('group');
  });

  it('sorts by most recent started_at descending', () => {
    const sessions = [
      makeSession('s1', '/old', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/new', '2026-03-30T03:00:00Z'),
      makeSession('s3', '/old', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    // /new (03:00) first, then /old group (max 02:00)
    expect(result[0].type).toBe('session');
    expect(result[1].type).toBe('group');
  });

  it('groups use max started_at for sort order', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T05:00:00Z'),
      makeSession('s3', '/b', '2026-03-30T03:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    // /a group has max 05:00, /b has 03:00 → group first
    expect(result[0].type).toBe('group');
    expect(result[1].type).toBe('session');
  });

  it('uses session_id as key for singles', () => {
    const sessions = [makeSession('s1', '/a', '2026-03-30T01:00:00Z')];
    const result = buildRenderList(sessions);
    expect(result[0].key).toBe('s1');
  });
});

describe('parent-child grouping', () => {
  it('excludes child sessions from top-level rendering', () => {
    const sessions = [
      makeSession('parent', '/a', '2026-03-30T01:00:00Z'),
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 'parent' },
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
    if (result[0].type === 'session') {
      expect(result[0].session.session_id).toBe('parent');
    }
  });

  it('child with no matching parent renders as top-level (orphaned)', () => {
    const sessions = [
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 'gone-parent' },
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
  });

  it('children do not count toward cwd group threshold', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 's1' },
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
  });
});
