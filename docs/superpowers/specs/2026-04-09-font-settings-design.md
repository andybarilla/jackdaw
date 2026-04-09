# Font Settings Design

Configurable font family and size for both terminal and UI, with live preview in settings and immediate application.

## Config Fields

Four new fields on the Go `Config` struct and JSON config file:

```go
TerminalFontFamily string `json:"terminal_font_family,omitempty"`
TerminalFontSize   int    `json:"terminal_font_size,omitempty"`
UIFontFamily       string `json:"ui_font_family,omitempty"`
UIFontSize         int    `json:"ui_font_size,omitempty"`
```

Defaults (applied when zero/empty):
- `terminal_font_family`: `"'JetBrains Mono', 'Fira Code', monospace"`
- `terminal_font_size`: `14`
- `ui_font_family`: `"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"`
- `ui_font_size`: `13`

## Frontend Config State

`config.svelte.ts` gets four reactive state variables with getter/setter pairs following the existing pattern:

- `getTerminalFontFamily()` / `setTerminalFontFamily(v: string)`
- `getTerminalFontSize()` / `setTerminalFontSize(v: number)`
- `getUIFontFamily()` / `setUIFontFamily(v: string)`
- `getUIFontSize()` / `setUIFontSize(v: number)`

Each setter updates local state, then reads config from Go, patches the field, and writes back (same pattern as all existing setters).

## Terminal Font Application

`Terminal.svelte` currently hardcodes `fontSize: 14` and `fontFamily: "'JetBrains Mono', 'Fira Code', monospace"` in the `new Terminal()` constructor.

Changes:
- Read `getTerminalFontFamily()` and `getTerminalFontSize()` from config in `onMount`
- Add a `$effect` that watches both values and updates `terminal.options.fontSize` and `terminal.options.fontFamily` on the live terminal instance, then calls `fitAddon.fit()` to reflow

## UI Font Application

CSS custom properties on `document.documentElement`:
- `--ui-font-family`
- `--ui-font-size` (with `px` suffix)

Applied by a new `applyUIFonts()` function called from `loadConfig()` and from each UI font setter.

`app.css` body rule changes from hardcoded font-family to `var(--ui-font-family)` and adds `font-size: var(--ui-font-size)`.

## Settings UI

New "Fonts" section in `SettingsEditor.svelte`, placed between Theme and Notifications sections.

Two subsections:

**Terminal**
- Text input for font family (full CSS font-family string)
- Number input for font size, min=8 max=32, step=1

**UI**
- Text input for font family (full CSS font-family string)
- Number input for font size, min=8 max=24, step=1

Changes apply live as the user types (onchange for text, onchange for number). No save button needed — matches existing settings behavior.

## Out of Scope

- Font picker / font browser
- Per-component font overrides
- Font weight configuration
- Font validation (user provides valid CSS font-family strings)

## Testing

**Go:** Existing `config.Load`/`config.Save` round-trip tests cover new fields implicitly (JSON marshal/unmarshal).

**Frontend:** `svelte-check` for type correctness. Manual testing for live preview behavior.
