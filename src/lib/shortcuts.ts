export type ShortcutAction =
  | 'next-session'
  | 'prev-session'
  | 'new-session'
  | 'dismiss-session'
  | 'tab-active'
  | 'tab-history'
  | 'tab-settings'
  | 'close-modal';

export interface ShortcutBinding {
  action: ShortcutAction;
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DEFAULT_BINDINGS: ShortcutBinding[] = [
  { action: 'next-session', key: 'J', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'prev-session', key: 'K', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'new-session', key: 'N', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'dismiss-session', key: 'D', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-active', key: '!', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-history', key: '@', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-settings', key: '#', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'close-modal', key: 'Escape', ctrl: false, shift: false, alt: false, meta: false },
];

let activeBindings: ShortcutBinding[] = [...DEFAULT_BINDINGS];

export function getDefaultBindings(): ShortcutBinding[] {
  return DEFAULT_BINDINGS.map((b) => ({ ...b }));
}

export function getBindings(): ShortcutBinding[] {
  return activeBindings.map((b) => ({ ...b }));
}

export function setBindings(bindings: ShortcutBinding[]): void {
  activeBindings = bindings.map((b) => ({ ...b }));
}

export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  if (binding.meta) parts.push('Meta');
  parts.push(binding.key);
  return parts.join('+');
}

export function matchShortcut(event: KeyEvent): ShortcutAction | null {
  for (const binding of activeBindings) {
    if (
      event.key === binding.key &&
      event.ctrlKey === binding.ctrl &&
      event.shiftKey === binding.shift &&
      event.altKey === binding.alt &&
      event.metaKey === binding.meta
    ) {
      return binding.action;
    }
  }

  return null;
}
