import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getUptime, getProjectName, shortenPath, shortenSessionId, formatEndedAt, getSessionState } from './utils';

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
