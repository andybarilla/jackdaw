# Settings Editor — Design Spec

## Overview

In-app settings editor rendered as a pane tab (`{ type: "settings" }`). Singleton — only one settings tab at a time. Opens via `Ctrl+,` keybinding or future UI affordance. No backend changes; uses existing `GetConfig`/`SetConfig` bindings.

## Pane Integration

- New union member: `{ type: "settings" }` added to `PaneContent` in `layout.ts`
- `PaneContainer.svelte` renders `SettingsEditor.svelte` when content type is `"settings"`
- `TabBar.svelte` labels it "Settings"
- Singleton enforcement: before opening, search layout tree for existing settings tab. If found, focus it instead of creating a new one.
- Settings tab does not survive restart (stripped during layout recovery like diff tabs)
- Closing the tab just removes it from the pane — no process cleanup needed

## Keybinding

New action `"app.openSettings"` with default binding `Ctrl+,`. Added to the `Action` union type, `DEFAULT_KEYMAP`, and the `actions` record in `App.svelte`.

## UI Sections

Single scrollable form component (`SettingsEditor.svelte`). Sections:

### 1. Theme
- Button group: whattheflock, dark, light
- Active theme highlighted
- Live preview on click (theme applies immediately via existing `setTheme()`)

### 2. Notifications
- Toggle: `notifications_enabled`
- Toggle: `desktop_notifications`
- Toggle: `error_detection_enabled`
- Number input: `toast_duration_seconds` (1-60 range)

### 3. Worktree
- Text input: `worktree_root` (path string)
- Radio group: `merge_mode` — "squash" or "merge"

### 4. History
- Number input: `history_max_bytes` displayed as MB (divide by 1048576 for display, multiply back for storage)
- Range: 1-100 MB

### 5. Keybindings
- Table: action name | current binding | edit button
- All 17+1 actions listed (including the new `app.openSettings`)
- Click "edit" enters capture mode: cell shows "Press keys..." prompt
- User presses key combo, it captures and saves via existing `setKeybinding()`
- Escape cancels capture mode
- Clicking another row while capturing cancels the previous capture

## Save Behavior

Changes save immediately on each interaction. Each control calls the appropriate config setter (`setTheme()`, `setKeybinding()`, or a direct `GetConfig()`/`SetConfig()` round-trip for other fields). The existing `loadConfig()` applies changes globally.

## Config State Extension

`config.svelte.ts` gains new exported state accessors and setters for fields not yet exposed:
- `notifications_enabled`, `desktop_notifications`, `error_detection_enabled`
- `worktree_root`, `merge_mode`
- `history_max_bytes`

These follow the same pattern as `setTheme()`: read config, update field, write config, update local reactive state.

## File Structure

```
frontend/src/lib/
  SettingsEditor.svelte    — new: main settings form component
  config.svelte.ts         — modified: add state/setters for all config fields
  layout.ts                — modified: add "settings" to PaneContent union
  keybindings.ts           — modified: add "app.openSettings" action
  PaneContainer.svelte     — modified: render SettingsEditor for settings type
  TabBar.svelte            — modified: label for settings tabs
App.svelte                 — modified: add openSettings action, strip settings on recovery
```

## Out of Scope

- Config file import/export
- Per-session settings overrides
- Custom theme creation
- Keybinding conflict detection (if two actions share a binding, last-match wins as today)
