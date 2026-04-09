# Settings Editor — Implementation Plan

**Spec:** `docs/specs/settings-editor.md`

## Task 1: Layout type + routing + keybinding

Add the settings pane type and wire it through the layout system.

**Files:**
- `frontend/src/lib/layout.ts` — add `{ type: "settings" }` to `PaneContent` union, add `findSettings()` helper to search tree for existing settings tab
- `frontend/src/lib/keybindings.ts` — add `"app.openSettings"` to `Action` union, add `"app.openSettings": "Ctrl+,"` to `DEFAULT_KEYMAP`
- `frontend/src/lib/TabBar.svelte` — add `"Settings"` label case in `getLabel()`
- `frontend/src/lib/PaneContainer.svelte` — add `{:else if content.type === "settings"}` branch (render placeholder div for now)
- `frontend/src/App.svelte` — add `"app.openSettings"` action that: checks for existing settings tab via `findSettings()`, focuses it if found, otherwise adds `{ type: "settings" }` tab in focused pane. Add settings tab stripping to layout recovery (alongside diff stripping).

**Acceptance:**
- `Ctrl+,` opens a settings tab (placeholder content)
- Second `Ctrl+,` focuses existing tab instead of creating another
- Settings tabs stripped on restart recovery
- Tab labeled "Settings" in tab bar
- `npm run check` passes

## Task 2: Config state expansion

Expose all config fields as reactive state with immediate-save setters.

**Files:**
- `frontend/src/lib/config.svelte.ts` — add `$state` variables and getter/setter pairs for: `notificationsEnabled`, `desktopNotifications`, `errorDetectionEnabled`, `worktreeRoot`, `mergeMode`, `historyMaxBytes`. Each setter follows the `setTheme()` pattern: update local state, read config, update field, write config.

**Acceptance:**
- All config fields have exported getters and setters
- Setters persist to backend via `SetConfig()`
- `loadConfig()` initializes all new state from backend config
- `npm run check` passes

## Task 3: SettingsEditor component

Build the full settings form.

**Files:**
- `frontend/src/lib/SettingsEditor.svelte` — new component with all 5 sections:
  - Theme: button group using `THEMES` array, calls `setTheme()`
  - Notifications: toggle switches for 3 booleans, number input for toast duration
  - Worktree: text input for root path, radio group for merge mode
  - History: number input showing MB (value / 1048576), stores bytes
  - Keybindings: table of all actions with current binding, click-to-edit capture mode
- `frontend/src/lib/PaneContainer.svelte` — replace placeholder with `<SettingsEditor />` import and render

**Styling:** Use existing CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, etc.). Scrollable container. Form controls sized consistently. Section headers with subtle separators.

**Keybinding capture:** Component-local state tracks which action is being edited. When active, a `keydown` listener on the capture cell builds the binding string from the event (Ctrl/Shift/Alt + key), saves via `setKeybinding()`, and exits capture mode. Escape cancels. `stopPropagation` prevents the global keydown handler from firing during capture.

**Acceptance:**
- All 5 sections render with correct current values from config
- Theme buttons switch theme with live preview
- Toggles and inputs save immediately
- Keybinding capture works: click edit, press keys, binding updates
- Escape cancels capture
- MB display correctly converts to/from bytes
- Scrollable when content exceeds viewport
- `npm run check` passes
- Looks reasonable in all 3 themes
