# Brutalist UI Skin

Replace the generic GitHub-dark visual skin with a brutalist design aligned to the whattheflock brand identity. Layout and component structure unchanged.

## Design Decisions

- **Direction**: Brutalist with pink glow on active elements
- **Typography**: JetBrains Mono for everything
- **Color strategy**: Pink (`#ff2d78`) for active/running, amber (`#d4a017`) for needs-attention, gray for idle
- **Geometry**: Zero border-radius everywhere. Hard 1px borders.

## Design Tokens

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#000000` | Page/dashboard background |
| `--card-bg` | `#111111` | Session card background |
| `--tool-bg` | `#0a0a0a` | Tool display row background |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--border` | `#222222` | Default borders (cards, dividers, tabs) |
| `--border-active` | `#ff2d7830` | Running session card border |
| `--border-active-tool` | `#ff2d7840` | Active tool row border |
| `--border-attention` | `#d4a01730` | Needs-attention session card border |
| `--border-attention-tool` | `#d4a01740` | Needs-attention tool row border |
| `--border-expanded` | `#ff2d78` | Expanded card border (solid pink) |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#d4d4d4` | Project names, headings |
| `--text-muted` | `#666666` | Uptime, idle text, secondary labels |
| `--text-dim` | `#777777` | History tool names |
| `--text-history` | `#555555` | History summaries |

### Accent Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--active` | `#ff2d78` | Running indicator, active tool name, active tab, subagent count |
| `--attention` | `#d4a017` | Approval/input indicator, attention tool name |
| `--idle` | `#444444` | Idle session indicator dot |

### Glow Effects

| Token | Value | Usage |
|-------|-------|-------|
| `--glow-active` | `0 0 12px #ff2d7810` | Running session card box-shadow |
| `--glow-attention` | `0 0 12px #d4a01710` | Needs-attention card box-shadow |

## Typography

- **Font**: `'JetBrains Mono', monospace` for all text
- **App name**: 14px, weight 700
- **Project names**: 11px, weight 600
- **Tool names**: 10px, weight 600
- **Summaries/metadata**: 10px, weight 400
- **Tab labels**: 10px, weight 400

Load JetBrains Mono via Google Fonts or bundle it.

## Geometry

- `border-radius: 0` on all elements (cards, buttons, tool rows, inputs, tabs)
- 1px borders everywhere
- No rounded corners on any element

## State Mapping

| Session State | Card Border | Glow | Indicator Color | Tool Border |
|--------------|-------------|------|----------------|-------------|
| Running | `--border-active` | `--glow-active` | `--active` (pink) | `--border-active-tool` |
| Approval needed | `--border-attention` | `--glow-attention` | `--attention` (amber) | `--border-attention-tool` |
| Input needed | `--border-attention` | `--glow-attention` | `--attention` (amber) | `--border-attention-tool` |
| Idle | `--border` | none | `--idle` (dark gray) | n/a |
| Expanded | `--border-expanded` | none | (inherits from state) | (inherits from state) |

## Scope

### Files to modify

- `src/app.css` — Replace all CSS custom properties with new tokens. Set global `font-family` to JetBrains Mono. Add `@import` or `@font-face` for JetBrains Mono. Add `* { border-radius: 0 }` reset.
- `src/lib/components/SessionCard.svelte` — Update `<style>` block: remove all `border-radius`, apply glow borders/box-shadows based on session state, update color references to new tokens.
- `src/lib/components/Header.svelte` — Update `<style>` block: remove `border-radius` from window buttons, update status colors to use `--active`/`--attention` instead of green/blue/orange.
- `src/lib/components/Dashboard.svelte` — Update `<style>` block: remove any `border-radius`, update tab active color from blue to `--active`.
- `src/lib/components/HookSetup.svelte` — Update `<style>` block: remove `border-radius`, update any accent colors.
- `src/lib/components/Settings.svelte` — Update `<style>` block: remove `border-radius`, update any accent colors.

### Not in scope

- Layout changes (flexbox structure, component hierarchy, expand/collapse behavior)
- Functionality changes
- Backend changes
- Tray icon changes (embedded at compile time, separate effort)
