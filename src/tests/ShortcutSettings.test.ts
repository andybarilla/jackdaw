import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ShortcutSettings from '$lib/components/ShortcutSettings.svelte';
import { setBindings, getDefaultBindings, type ShortcutBinding } from '$lib/shortcuts';

describe('ShortcutSettings', () => {
  beforeEach(() => {
    setBindings(getDefaultBindings());
  });

  it('renders all 8 shortcut actions', () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    expect(getByText('Next Session')).toBeTruthy();
    expect(getByText('Previous Session')).toBeTruthy();
    expect(getByText('New Session')).toBeTruthy();
    expect(getByText('Dismiss Session')).toBeTruthy();
    expect(getByText('Active Tab')).toBeTruthy();
    expect(getByText('History Tab')).toBeTruthy();
    expect(getByText('Settings Tab')).toBeTruthy();
    expect(getByText('Close Modal')).toBeTruthy();
  });

  it('displays current key bindings', () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
    expect(getByText('Escape')).toBeTruthy();
  });

  it('enters recording mode on binding click', async () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    await fireEvent.click(getByText('Ctrl+Shift+J'));
    expect(getByText('Press keys...')).toBeTruthy();
  });

  it('cancels recording without changing binding', async () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    await fireEvent.click(getByText('Ctrl+Shift+J'));
    await fireEvent.click(getByText('Cancel'));
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
  });

  it('resets all bindings to defaults', async () => {
    const onSave = vi.fn();
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'Q', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    setBindings(custom);
    const { getByText } = render(ShortcutSettings, {
      props: { onSave },
    });
    expect(getByText('Ctrl+Q')).toBeTruthy();
    await fireEvent.click(getByText('Reset to Defaults'));
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
    expect(onSave).toHaveBeenCalled();
  });
});
