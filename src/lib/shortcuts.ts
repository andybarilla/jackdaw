export type ShortcutAction =
  | 'next-session'
  | 'prev-session'
  | 'new-session'
  | 'dismiss-session'
  | 'tab-active'
  | 'tab-history'
  | 'tab-settings'
  | 'close-modal';

interface ShortcutBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  action: ShortcutAction;
}

const BINDINGS: ShortcutBinding[] = [
  { key: 'J', ctrl: true, shift: true, action: 'next-session' },
  { key: 'K', ctrl: true, shift: true, action: 'prev-session' },
  { key: 'N', ctrl: true, shift: true, action: 'new-session' },
  { key: 'D', ctrl: true, shift: true, action: 'dismiss-session' },
  // Shift+1/2/3 produce !/@ /# on US keyboards
  { key: '!', ctrl: true, shift: true, action: 'tab-active' },
  { key: '@', ctrl: true, shift: true, action: 'tab-history' },
  { key: '#', ctrl: true, shift: true, action: 'tab-settings' },
];

export interface KeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function matchShortcut(event: KeyEvent): ShortcutAction | null {
  if (event.key === 'Escape') {
    return 'close-modal';
  }

  if (event.altKey || event.metaKey) {
    return null;
  }

  for (const binding of BINDINGS) {
    if (
      event.key === binding.key &&
      event.ctrlKey === binding.ctrl &&
      event.shiftKey === binding.shift
    ) {
      return binding.action;
    }
  }

  return null;
}
