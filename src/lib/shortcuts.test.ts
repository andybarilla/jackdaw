import { describe, it, expect } from 'vitest';
import { matchShortcut, type KeyEvent } from './shortcuts';

function key(
  k: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
): KeyEvent {
  return {
    key: k,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
    metaKey: modifiers.meta ?? false,
  };
}

describe('matchShortcut', () => {
  it('matches Ctrl+Shift+J to next-session', () => {
    expect(matchShortcut(key('J', { ctrl: true, shift: true }))).toBe('next-session');
  });

  it('matches Ctrl+Shift+K to prev-session', () => {
    expect(matchShortcut(key('K', { ctrl: true, shift: true }))).toBe('prev-session');
  });

  it('matches Ctrl+Shift+N to new-session', () => {
    expect(matchShortcut(key('N', { ctrl: true, shift: true }))).toBe('new-session');
  });

  it('matches Ctrl+Shift+D to dismiss-session', () => {
    expect(matchShortcut(key('D', { ctrl: true, shift: true }))).toBe('dismiss-session');
  });

  it('matches Ctrl+Shift+1 to tab-active', () => {
    expect(matchShortcut(key('!', { ctrl: true, shift: true }))).toBe('tab-active');
  });

  it('matches Ctrl+Shift+2 to tab-history', () => {
    expect(matchShortcut(key('@', { ctrl: true, shift: true }))).toBe('tab-history');
  });

  it('matches Ctrl+Shift+3 to tab-settings', () => {
    expect(matchShortcut(key('#', { ctrl: true, shift: true }))).toBe('tab-settings');
  });

  it('matches Escape to close-modal', () => {
    expect(matchShortcut(key('Escape'))).toBe('close-modal');
  });

  it('returns null for unbound keys', () => {
    expect(matchShortcut(key('a'))).toBeNull();
    expect(matchShortcut(key('J'))).toBeNull();
    expect(matchShortcut(key('J', { ctrl: true }))).toBeNull();
  });

  it('returns null when Alt is also pressed', () => {
    expect(matchShortcut(key('J', { ctrl: true, shift: true, alt: true }))).toBeNull();
  });
});
