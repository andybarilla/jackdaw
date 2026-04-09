export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "session.viewDiff"
  | "app.toggleSidebar"
  | "terminal.search"
  | "pane.splitVertical"
  | "pane.splitHorizontal"
  | "pane.close"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.unsplit"
  | "tab.next"
  | "tab.prev"
  | "app.openSettings"
  | "commandPalette.open";

export interface ParsedBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type Keymap = Record<string, string>;

export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+X",
  "session.viewDiff": "Ctrl+Shift+D",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
  "terminal.search": "Ctrl+f",
  "pane.splitVertical": "Ctrl+Shift+|",
  "pane.splitHorizontal": "Ctrl+Shift+_",
  "pane.close": "Ctrl+Shift+W",
  "pane.focusUp": "Ctrl+Shift+ArrowUp",
  "pane.focusDown": "Ctrl+Shift+ArrowDown",
  "pane.focusLeft": "Ctrl+Shift+ArrowLeft",
  "pane.focusRight": "Ctrl+Shift+ArrowRight",
  "pane.unsplit": "Ctrl+Shift+j",
  "tab.next": "Ctrl+PageDown",
  "tab.prev": "Ctrl+PageUp",
  "app.openSettings": "Ctrl+,",
  "commandPalette.open": "Ctrl+Shift+P",
};

// Map binding key strings to physical key codes (event.code values).
// Using event.code avoids issues where Shift changes event.key
// (e.g. Shift+] produces "}" in event.key but "BracketRight" in event.code).
const KEY_TO_CODE: Record<string, string> = {
  "]": "BracketRight",
  "[": "BracketLeft",
  "}": "BracketRight",
  "{": "BracketLeft",
  "\\": "Backslash",
  "|": "Backslash",
  "-": "Minus",
  "_": "Minus",
  "=": "Equal",
  "+": "Equal",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "`": "Backquote",
  "~": "Backquote",
  ";": "Semicolon",
  "'": "Quote",
  "0": "Digit0",
  "1": "Digit1",
  "2": "Digit2",
  "3": "Digit3",
  "4": "Digit4",
  "5": "Digit5",
  "6": "Digit6",
  "7": "Digit7",
  "8": "Digit8",
  "9": "Digit9",
};

function keyToCode(key: string): string | null {
  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (lower >= "a" && lower <= "z") return `Key${lower.toUpperCase()}`;
    return KEY_TO_CODE[key] || null;
  }
  return null;
}

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

    if (
      event.ctrlKey !== parsed.ctrl ||
      event.shiftKey !== parsed.shift ||
      event.altKey !== parsed.alt
    ) {
      continue;
    }

    // Try code-based matching first (reliable with modifiers)
    const expectedCode = keyToCode(parsed.key);
    if (expectedCode) {
      if (event.code === expectedCode) return action;
      continue;
    }

    // Fall back to key-based matching for special keys (ArrowUp, etc.)
    if (event.key === parsed.key) return action;
  }
  return null;
}
