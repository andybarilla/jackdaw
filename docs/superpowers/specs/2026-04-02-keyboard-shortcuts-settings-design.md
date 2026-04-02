# Keyboard Shortcuts Settings Design

Configurable keyboard shortcuts with a settings UI for rebinding. Bindings stored in Tauri Store, frontend-only — no backend changes.

## Data Model

New `"shortcuts"` key in Tauri Store (`settings.json`):

```typescript
interface ShortcutBinding {
  action: ShortcutAction;
  key: string;        // e.g. "J", "Escape", "1"
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}
```

Stored as `ShortcutBinding[]`. Missing or empty key falls back to hardcoded defaults. One binding per action — duplicate actions not allowed.

## Shortcuts Module Changes (`shortcuts.ts`)

The module becomes stateful with active bindings held in a module-level variable:

- `DEFAULT_BINDINGS: ShortcutBinding[]` — current hardcoded bindings with `alt`/`meta` fields added (both `false` for all defaults). Escape gets all modifiers `false`.
- `let activeBindings: ShortcutBinding[]` — starts as `DEFAULT_BINDINGS`, replaced when user bindings load.
- `loadBindings(store)` — reads `"shortcuts"` from Tauri Store, sets `activeBindings`. Called once on app init.
- `saveBindings(store, bindings)` — writes to store and updates `activeBindings`.
- `getBindings(): ShortcutBinding[]` — returns current active bindings.
- `getDefaultBindings(): ShortcutBinding[]` — returns defaults for "Reset to defaults".
- `matchShortcut(event)` — unchanged signature, iterates `activeBindings` instead of hardcoded `BINDINGS`.
- `formatBinding(binding): string` — human-readable label like "Ctrl+Shift+J" for the settings UI.

No changes to `Dashboard.svelte` — it still calls `matchShortcut(event)`.

## Settings UI

New "Keyboard Shortcuts" section in `Settings.svelte`, placed after Monitoring Profiles and before Alerts.

### Layout

Each shortcut as a row: action label on the left, current binding as a styled key combo badge on the right.

Action labels:
- `next-session` → "Next Session"
- `prev-session` → "Previous Session"
- `new-session` → "New Session"
- `dismiss-session` → "Dismiss Session"
- `tab-active` → "Active Tab"
- `tab-history` → "History Tab"
- `tab-settings` → "Settings Tab"
- `close-modal` → "Close Modal"

### Recording Mode

Clicking a binding enters recording mode — the badge changes to a pulsing "Press keys..." prompt with a cancel button beside it. The next keydown captures the new combo and saves immediately.

Cancel button exits recording without changes. (Escape is not used to cancel since it's a valid rebindable key.)

### Conflict Handling

If the captured combo is already bound to a different action, swap — the old action becomes unbound. No blocking dialogs, just an inline update.

### Reset

"Reset to Defaults" button at the bottom resets all bindings at once.

## No Changes To

- `Dashboard.svelte` (still calls `matchShortcut`)
- Backend Rust code
- `ShortcutAction` type (same set of actions)

## Testing

### `shortcuts.ts` (extend existing `shortcuts.test.ts`)

- `matchShortcut` works with custom bindings after `loadBindings`
- `matchShortcut` uses defaults when no saved bindings exist
- `matchShortcut` respects alt/meta modifiers
- `formatBinding` produces correct labels ("Ctrl+Shift+J", "Escape", "Alt+K")
- `saveBindings` + `loadBindings` roundtrip
- Binding a key already used by another action leaves only the new assignment

### Settings UI (new test file)

- Renders all 8 actions with their current bindings
- Clicking a binding shows recording state
- Cancel button exits recording without changing binding
- Reset to defaults restores all bindings
