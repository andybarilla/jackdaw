# Font Settings Implementation Plan

Spec: `docs/superpowers/specs/2026-04-09-font-settings-design.md`

## Task 1: Go Config Fields

**Files:** `internal/config/config.go`

Add four fields to `Config` struct:

```go
TerminalFontFamily string `json:"terminal_font_family,omitempty"`
TerminalFontSize   int    `json:"terminal_font_size,omitempty"`
UIFontFamily       string `json:"ui_font_family,omitempty"`
UIFontSize         int    `json:"ui_font_size,omitempty"`
```

No changes to `Defaults()` needed — the spec says defaults are applied on the frontend when values are zero/empty. The `omitempty` tags keep the config file clean.

**Verification:** `go test ./internal/config/...` — existing round-trip tests cover JSON marshal/unmarshal implicitly.

## Task 2: Frontend Config State

**Files:** `frontend/src/lib/config.svelte.ts`

Add four reactive state variables with defaults:

```ts
let terminalFontFamily = $state("'JetBrains Mono', 'Fira Code', monospace");
let terminalFontSize = $state(14);
let uiFontFamily = $state("-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
let uiFontSize = $state(13);
```

Add getter/setter pairs following the existing pattern (getter returns state, setter updates local state then reads config from Go, patches field, writes back).

Add `applyUIFonts()` function that sets `--ui-font-family` and `--ui-font-size` CSS custom properties on `document.documentElement`.

Call `applyUIFonts()` from `loadConfig()` after loading UI font values. Call it from each UI font setter.

In `loadConfig()`, read the four new fields from the Go config (using `||` for strings and `|| defaultValue` for numbers to apply defaults when zero/empty).

## Task 3: Terminal Font Application

**Files:** `frontend/src/lib/Terminal.svelte`

- Import `getTerminalFontFamily` and `getTerminalFontSize` from config
- In `onMount`, use `getTerminalFontSize()` and `getTerminalFontFamily()` instead of hardcoded values for the `new Terminal()` constructor
- Add a `$effect` that watches both terminal font config values and updates `terminal.options.fontSize` / `terminal.options.fontFamily` on the live instance, then calls `fitAddon.fit()`

## Task 4: CSS Custom Properties for UI Fonts

**Files:** `frontend/src/app.css`

Change body rule from hardcoded `font-family` to `var(--ui-font-family)` and add `font-size: var(--ui-font-size)`.

## Task 5: Settings UI

**Files:** `frontend/src/lib/SettingsEditor.svelte`

Add a "Fonts" section between Theme and Notifications with two subsections:

**Terminal:**
- Text input for font family (full CSS font-family string), uses `onchange` to call `setTerminalFontFamily`
- Number input for font size, min=8 max=32 step=1, uses `onchange` to call `setTerminalFontSize`

**UI:**
- Text input for font family, uses `onchange` to call `setUIFontFamily`
- Number input for font size, min=8 max=24 step=1, uses `onchange` to call `setUIFontSize`

Import the four new getters and setters from config.

## Verification

After all tasks:
- `go test ./internal/...`
- `cd frontend && npm run check`
