import { describe, it, expect, vi, afterEach } from 'vitest';
import { getUptime, shortenPath, shortenSessionId } from './utils';

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
