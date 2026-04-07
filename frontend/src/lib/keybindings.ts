export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "app.toggleSidebar";

export interface ParsedBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type Keymap = Record<string, string>;

export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+W",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
};

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split("+");
  const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const key = parts[parts.length - 1];

  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    ctrl: modifiers.has("ctrl"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
  };
}

export function matchKeybinding(
  event: KeyboardEvent,
  keymap: Keymap,
): string | null {
  for (const [action, binding] of Object.entries(keymap)) {
    const parsed = parseBinding(binding);
    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (
      eventKey === parsed.key &&
      event.ctrlKey === parsed.ctrl &&
      event.shiftKey === parsed.shift &&
      event.altKey === parsed.alt
    ) {
      return action;
    }
  }
  return null;
}
