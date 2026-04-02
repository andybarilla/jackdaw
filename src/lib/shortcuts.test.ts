import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  matchShortcut,
  getBindings,
  getDefaultBindings,
  setBindings,
  formatBinding,
  loadBindings,
  saveBindings,
  type KeyEvent,
  type ShortcutBinding,
} from './shortcuts';

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

describe('getDefaultBindings', () => {
  it('returns 8 default bindings', () => {
    const defaults = getDefaultBindings();
    expect(defaults).toHaveLength(8);
  });

  it('includes all actions', () => {
    const actions = getDefaultBindings().map((b) => b.action);
    expect(actions).toContain('next-session');
    expect(actions).toContain('prev-session');
    expect(actions).toContain('new-session');
    expect(actions).toContain('dismiss-session');
    expect(actions).toContain('tab-active');
    expect(actions).toContain('tab-history');
    expect(actions).toContain('tab-settings');
    expect(actions).toContain('close-modal');
  });

  it('close-modal defaults to Escape with no modifiers', () => {
    const escape = getDefaultBindings().find((b) => b.action === 'close-modal');
    expect(escape).toEqual({
      action: 'close-modal',
      key: 'Escape',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });
});

describe('getBindings', () => {
  it('returns defaults before any setBindings call', () => {
    const bindings = getBindings();
    expect(bindings).toEqual(getDefaultBindings());
  });
});

describe('setBindings', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('updates active bindings used by matchShortcut', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'L', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('L', { alt: true }))).toBe('next-session');
    expect(matchShortcut(key('J', { ctrl: true, shift: true }))).toBeNull();
  });

  it('getBindings reflects the change', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'dismiss-session' ? { ...b, key: 'X', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    setBindings(custom);
    const found = getBindings().find((b) => b.action === 'dismiss-session');
    expect(found?.key).toBe('X');
  });
});

describe('formatBinding', () => {
  it('formats Ctrl+Shift+J', () => {
    expect(formatBinding({ action: 'next-session', key: 'J', ctrl: true, shift: true, alt: false, meta: false })).toBe(
      'Ctrl+Shift+J',
    );
  });

  it('formats Escape with no modifiers', () => {
    expect(
      formatBinding({ action: 'close-modal', key: 'Escape', ctrl: false, shift: false, alt: false, meta: false }),
    ).toBe('Escape');
  });

  it('formats Alt+K', () => {
    expect(
      formatBinding({ action: 'next-session', key: 'K', ctrl: false, shift: false, alt: true, meta: false }),
    ).toBe('Alt+K');
  });

  it('formats Meta+Ctrl+A', () => {
    expect(
      formatBinding({ action: 'next-session', key: 'A', ctrl: true, shift: false, alt: false, meta: true }),
    ).toBe('Ctrl+Meta+A');
  });

  it('formats all modifiers', () => {
    expect(formatBinding({ action: 'next-session', key: 'Z', ctrl: true, shift: true, alt: true, meta: true })).toBe(
      'Ctrl+Shift+Alt+Meta+Z',
    );
  });
});

describe('matchShortcut with alt/meta modifiers', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('matches Alt binding', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'N', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('N', { alt: true }))).toBe('next-session');
  });

  it('does not match when extra modifier pressed', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'N', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('N', { alt: true, ctrl: true }))).toBeNull();
  });
});

describe('loadBindings', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('loads bindings from store', async () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'Q', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    const mockStore = {
      get: vi.fn().mockResolvedValue(custom),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(mockStore.get).toHaveBeenCalledWith('shortcuts');
    const found = getBindings().find((b) => b.action === 'next-session');
    expect(found?.key).toBe('Q');
  });

  it('keeps defaults when store returns null', async () => {
    const mockStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(getBindings()).toEqual(getDefaultBindings());
  });

  it('keeps defaults when store returns empty array', async () => {
    const mockStore = {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(getBindings()).toEqual(getDefaultBindings());
  });
});

describe('saveBindings', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('writes bindings to store and updates active bindings', async () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'dismiss-session' ? { ...b, key: 'W', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    const mockStore = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    };
    await saveBindings(mockStore as any, custom);
    expect(mockStore.set).toHaveBeenCalledWith('shortcuts', custom);
    expect(mockStore.save).toHaveBeenCalled();
    const found = getBindings().find((b) => b.action === 'dismiss-session');
    expect(found?.key).toBe('W');
  });
});
