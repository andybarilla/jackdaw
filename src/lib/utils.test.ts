import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getUptime, getProjectName, shortenPath, shortenSessionId, formatEndedAt, getSessionState, relativeTime, computeToolVelocity } from './utils';
import type { ToolEvent } from './types';

describe('getProjectName', () => {
  it('returns last path segment', () => {
    expect(getProjectName('/home/andy/projects/api-server')).toBe('api-server');
  });

  it('handles trailing slash', () => {
    expect(getProjectName('/home/andy/projects/foo/')).toBe('foo');
  });

  it('returns root for root path', () => {
    expect(getProjectName('/')).toBe('/');
  });

  it('handles Windows-style paths', () => {
    expect(getProjectName('C:\\Users\\andy\\projects\\api-server')).toBe('api-server');
  });

  it('returns / for empty string', () => {
    expect(getProjectName('')).toBe('/');
  });

  it('returns display_name when provided', () => {
    expect(getProjectName('', 'CI Build #456')).toBe('CI Build #456');
  });

  it('prefers display_name over cwd', () => {
    expect(getProjectName('/home/user/project', 'Custom Name')).toBe('Custom Name');
  });
});

describe('shortenPath', () => {
  it('replaces /home/<user>/ with ~', () => {
    expect(shortenPath('/home/andy/projects/foo')).toBe('~/projects/foo');
  });

  it('replaces any user home', () => {
    expect(shortenPath('/home/otheruser/foo')).toBe('~/foo');
  });

  it('leaves non-home paths unchanged', () => {
    expect(shortenPath('/tmp/foo')).toBe('/tmp/foo');
  });

  it('leaves macOS paths unchanged', () => {
    expect(shortenPath('/Users/andy/foo')).toBe('/Users/andy/foo');
  });
});

describe('shortenSessionId', () => {
  it('truncates long IDs to 8 chars', () => {
    expect(shortenSessionId('abcdef123456')).toBe('abcdef12');
  });

  it('leaves short IDs unchanged', () => {
    expect(shortenSessionId('abc')).toBe('abc');
  });

  it('leaves exactly 8-char IDs unchanged', () => {
    expect(shortenSessionId('abcdefgh')).toBe('abcdefgh');
  });
});

describe('formatEndedAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 1 hour ago', () => {
    expect(formatEndedAt('2026-03-21T11:30:00Z')).toBe('just now');
  });

  it('returns hours ago', () => {
    expect(formatEndedAt('2026-03-21T09:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    expect(formatEndedAt('2026-03-19T12:00:00Z')).toBe('2d ago');
  });

  it('returns date for older than a week', () => {
    const result = formatEndedAt('2026-03-01T12:00:00Z');
    expect(result).toMatch(/3\/1\/2026|1\/3\/2026|2026/);
  });
});

describe('getSessionState', () => {
  const base = { pending_approval: false, current_tool: null, active_subagents: 0, processing: false };

  it('returns approval when pending_approval is true', () => {
    expect(getSessionState({ ...base, pending_approval: true })).toBe('approval');
  });

  it('returns running when processing', () => {
    expect(getSessionState({ ...base, processing: true })).toBe('running');
  });

  it('returns running when current_tool is set', () => {
    expect(getSessionState({ ...base, current_tool: { tool_name: 'Bash' } })).toBe('running');
  });

  it('returns running when active_subagents > 0', () => {
    expect(getSessionState({ ...base, active_subagents: 2 })).toBe('running');
  });

  it('returns input when idle', () => {
    expect(getSessionState(base)).toBe('input');
  });

  it('approval takes priority over running', () => {
    expect(getSessionState({ ...base, pending_approval: true, processing: true })).toBe('approval');
  });
});

describe('getUptime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns minutes for <60 min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:05:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours and minutes for >=60 min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T13:30:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('1h 30m ago');
  });

  it('returns 0m for just started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('0m ago');
  });
});

describe('relativeTime', () => {
  it('returns "just now" for less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('just now');
  });

  it('returns minutes for less than 1 hour', () => {
    const d = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(d)).toBe('5m ago');
  });

  it('returns hours for less than 24 hours', () => {
    const d = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(d)).toBe('3h ago');
  });

  it('returns days for 1+ days', () => {
    const d = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(relativeTime(d)).toBe('2d ago');
  });
});

describe('computeToolVelocity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero for empty history and no current tool', () => {
    expect(computeToolVelocity([], null, '2026-03-31T11:50:00Z')).toEqual({ total: 0, rate: 0 });
  });

  it('counts current tool in total', () => {
    const current: ToolEvent = { tool_name: 'Bash', timestamp: '2026-03-31T11:59:00Z', summary: null };
    expect(computeToolVelocity([], current, '2026-03-31T11:50:00Z').total).toBe(1);
  });

  it('calculates rate from tools in last 5 minutes', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:56:00Z', summary: null },
      { tool_name: 'Read', timestamp: '2026-03-31T11:57:00Z', summary: null },
      { tool_name: 'Edit', timestamp: '2026-03-31T11:58:00Z', summary: null },
      { tool_name: 'Bash', timestamp: '2026-03-31T11:59:00Z', summary: null },
    ];
    const result = computeToolVelocity(history, null, '2026-03-31T11:50:00Z');
    expect(result.total).toBe(4);
    expect(result.rate).toBe(0.8);
  });

  it('excludes tools older than 5 minutes from rate', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:50:00Z', summary: null },
      { tool_name: 'Read', timestamp: '2026-03-31T11:58:00Z', summary: null },
    ];
    const result = computeToolVelocity(history, null, '2026-03-31T11:50:00Z');
    expect(result.total).toBe(2);
    expect(result.rate).toBe(0.2);
  });

  it('uses session start time for rate window when session started less than 5 minutes ago', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:58:00Z', summary: null },
      { tool_name: 'Read', timestamp: '2026-03-31T11:59:00Z', summary: null },
    ];
    const result = computeToolVelocity(history, null, '2026-03-31T11:58:00Z');
    expect(result.total).toBe(2);
    expect(result.rate).toBe(1);
  });
});
