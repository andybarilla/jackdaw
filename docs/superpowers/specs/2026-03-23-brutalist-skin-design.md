# Brutalist UI Skin

Replace the generic GitHub-dark visual skin with a brutalist design aligned to the whattheflock brand identity. Layout and component structure unchanged.

## Design Decisions

- **Direction**: Brutalist with pink glow on active elements
- **Typography**: JetBrains Mono for everything
- **Color strategy**: Pink (`#ff2d78`) for active/running, amber (`#d4a017`) for needs-attention, gray for idle. Both "approval needed" and "input needed" map to amber intentionally — they're both "needs human" states.
- **Geometry**: Zero border-radius everywhere. Hard 1px borders.
- **Tool icons**: All tool icon colors collapse to `--active` (pink). The icon shape distinguishes tool types; color distinguishes state.

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

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#d4d4d4` | Project names, headings, primary labels |
| `--text-secondary` | `#999999` | Toggle labels, status text, secondary content |
| `--text-muted` | `#666666` | Uptime, idle text, session IDs, placeholders |

### Accent Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--active` | `#ff2d78` | Running indicator, active tool/icon color, active tab, subagent count, primary buttons |
| `--active-hover` | `#ff4d8e` | Primary button hover |
| `--attention` | `#d4a017` | Approval/input indicator and tool/icon color |
| `--success` | `#3fb950` | Success messages (hooks installed) |
| `--error` | `#f85149` | Error messages |
| `--idle` | `#444444` | Idle session indicator |

### Glow Effects

| Token | Value | Usage |
|-------|-------|-------|
| `--glow-active` | `0 0 12px #ff2d7810` | Running session card box-shadow |
| `--glow-attention` | `0 0 12px #d4a01710` | Needs-attention card box-shadow |

### Token Migration

Old tokens removed and their replacements:

| Old Token | Replacement |
|-----------|-------------|
| `--green` | `--active` (session status), `--success` (messages) |
| `--yellow` | `--attention` |
| `--blue` | `--active` (buttons, tabs, checkboxes), `--attention` (input state) |
| `--orange` | `--attention` |
| `--purple` | `--active` |
| `--cyan` | `--active` |
| `--tool-border` | `--border-active-tool` or `--border` depending on state |
| `--badge-running-bg` | Removed (glow replaces badge backgrounds) |
| `--badge-running-border` | Removed |
| `--badge-waiting-bg` | Removed |
| `--badge-waiting-border` | Removed |

## Typography

- **Font**: `'JetBrains Mono', monospace` for all text
- Keep existing font sizes in each component (don't resize)
- Bundle JetBrains Mono (weights 400, 600, 700) as static assets in `src/assets/fonts/`. Google Fonts is unreliable for an offline desktop app. Load via `@font-face` in `app.css`.

## Geometry

- `border-radius: 0` on all elements (cards, buttons, tool rows, inputs, tabs)
- 1px borders everywhere

## State Mapping

| Session State | Card Border | Glow | Indicator/Icon Color | Tool Border |
|--------------|-------------|------|---------------------|-------------|
| Running | `--border-active` | `--glow-active` | `--active` (pink) | `--border-active-tool` |
| Approval needed | `--border-attention` | `--glow-attention` | `--attention` (amber) | `--border-attention-tool` |
| Input needed | `--border-attention` | `--glow-attention` | `--attention` (amber) | `--border-attention-tool` |
| Idle | `--border` | none | `--idle` (dark gray) | n/a |
| Dimmed tool (between calls) | (inherits card border) | (inherits) | `--text-muted` | `--border` |
| Expanded | Inherits from current state (not overridden) | Inherits | Inherits | Inherits |

Expanded cards do NOT override their state border — a running expanded card keeps its pink glow, an idle expanded card keeps `--border`.

## Scope

### Files to modify

- `src/app.css` — Replace all CSS custom properties with new tokens. Set global `font-family` to JetBrains Mono via `@font-face`. Add `* { border-radius: 0 !important }` reset.
- `src/app.html` (or equivalent) — Remove any Google Fonts links if present.
- `src/lib/components/SessionCard.svelte` — Remove `border-radius`, apply glow borders/box-shadows per state, update color references. Update expanded card border to inherit from state instead of using `--blue`.
- `src/lib/components/SessionStatusIcon.svelte` — Remap color classes: `status-green` → `--active`, `status-blue` → `--attention`, `status-orange` → `--attention`, `status-gray` → `--text-muted`. Keep the pulse animation.
- `src/lib/components/ToolIcon.svelte` — Collapse all tool color classes to single `--active` color. Icon shape distinguishes tools, not color.
- `src/lib/components/Header.svelte` — Remove `border-radius` from window buttons, update status colors to `--active`/`--attention`.
- `src/lib/components/Dashboard.svelte` — Remove `border-radius`, update tab active color from `--blue` to `--active`.
- `src/lib/components/HookSetup.svelte` — Remove `border-radius`, update `.btn-primary` from `--blue` to `--active`, update `.status.installed` from `--green` to `--success`, `.status.outdated` from `--yellow` to `--attention`. Update `accent-color` on radio inputs.
- `src/lib/components/Settings.svelte` — Remove `border-radius`, update `accent-color` on checkboxes from `--blue` to `--active`.
- `src/assets/fonts/` — Add bundled JetBrains Mono woff2 files (weights 400, 600, 700).

### Not in scope

- Layout changes (flexbox structure, component hierarchy, expand/collapse behavior)
- Functionality changes
- Backend changes
- Tray icon changes (embedded at compile time, separate effort)
