# Informative Tray & Session Icons

## Goal

Replace the current monochrome tray dots and Unicode tool indicators with distinct, color-coded Lucide icons that communicate session and tool state at a glance.

## Tray Icons

### Per-session state classification

Each session is classified into exactly one state using this priority order (first match wins):

1. **Waiting for approval** — `pending_approval == true` (even if `current_tool` is also set)
2. **Waiting for input** — not pending, not running (`current_tool` is None, `active_subagents == 0`, `processing == false`)
3. **Running** — has `current_tool`, `active_subagents > 0`, or `processing == true`

A session can have `pending_approval == true` and `current_tool` set simultaneously (tool pending permission). Approval takes precedence.

### Tray state (global)

The tray icon shows the highest-priority state across all sessions:

| Priority | State                | Lucide icon      | Color  |
|----------|----------------------|------------------|--------|
| 1        | Waiting for approval | `shield-alert`   | Orange |
| 2        | Waiting for input    | `message-square` | Blue   |
| 3        | Running              | `play`           | Green  |
| 4        | Idle (no sessions)   | `circle`         | Gray   |

"Idle" only applies when there are zero sessions. Individual sessions are always either running, waiting for input, or waiting for approval.

### Tooltip

Shows only non-zero counts: "Jackdaw — 2 running, 1 waiting for approval". When no sessions exist: "Jackdaw — idle".

### Tray PNGs

Manually export Lucide SVGs at 32px with the appropriate fill color. Stored in `static/icons/`. Delete old files (`tray-green.png`, `tray-yellow.png`, `tray-gray.png`) and add:
- `tray-approval.png` (orange `shield-alert`)
- `tray-input.png` (blue `message-square`)
- `tray-running.png` (green `play`)
- `tray-idle.png` (gray `circle`)

Update `include_bytes!` constants in `tray.rs` to reference the new filenames.

## SessionCard Icons

### Session status

Replace the `.status-dot` span in the SessionCard header row with a Lucide session-state icon using the per-session classification above (not the global tray priority). Preserve the pulse animation on the icon for running and approval states.

Icon sizes: 14px for the session status icon in the header row.

### Tool-type icons

Replace `▶`/`✓` Unicode characters in the tool row and history list with tool-specific Lucide icons, color-coded by category. Mapping is per-tool-name (not per-category), since tools in the same category may use different icons:

| Tool name  | Lucide icon      | Color  |
|------------|------------------|--------|
| Bash       | `terminal`       | Green  |
| Read       | `file-text`      | Blue   |
| Edit       | `pencil`         | Orange |
| Write      | `file-plus`      | Orange |
| Glob       | `folder-search`  | Purple |
| Grep       | `search`         | Purple |
| Agent      | `bot`            | Cyan   |
| (unknown)  | `wrench`         | Gray   |

Icon sizes: 12px in the tool row, 11px in the history list.

### New component: `ToolIcon.svelte`

Takes a `tool_name: string` prop (matching the existing `ToolEvent.tool_name` field in `types.ts`). Returns the correct Lucide icon component with the appropriate color CSS class. Used in both the active tool row and history list.

## Backend Changes

### `tray.rs`

- New `TrayState` enum: `WaitingForApproval`, `WaitingForInput`, `Running`, `Idle`.
- `compute_tray_state` classifies each session: check `pending_approval` first, then waiting-for-input (no tool, no subagents, not processing), then running. Returns the highest-priority `TrayState` across all sessions (approval > input > running > idle). Replaces the current `(usize, usize)` return type.
- 4 embedded PNGs replacing the current 3. Update `include_bytes!` constants.
- Tooltip builds string from non-zero counts only.
- Existing tests updated to use `TrayState` enum.

### `state.rs`

No changes. Existing fields (`pending_approval`, `current_tool`, `active_subagents`, `processing`) already capture all states.

### `server.rs`

No changes. Event handling logic is unchanged.

## Frontend Changes

### Dependencies

- Add `lucide-svelte` npm package.

### `ToolIcon.svelte` (new)

Maps `tool_name` to a Lucide icon component and CSS color class. Falls back to `wrench` in gray for unknown tools.

### `Header.svelte`

- Replace `.status-dot` span with a Lucide icon showing the global highest-priority state (matching the tray icon). Size: 12px.
- Remove unused `.status-dot` CSS.

### `SessionCard.svelte`

- Header row: replace `.status-dot` span with a Lucide session-state icon (per-session state). Keep pulse animation for running and approval states.
- Tool row (active): replace `▶` span with `ToolIcon`.
- Tool row (dimmed/completed): replace `✓` span with `ToolIcon`.
- History list: replace `✓` checkmarks with `ToolIcon`.
- Remove unused `.status-dot` CSS.

## Out of Scope

- Error state — deferred until a reliable signal exists in Claude Code hook events.
- Desktop notification styling — OS-level notifications unchanged.
- Backend `Session` struct changes — no new fields needed.
- IPC protocol changes — no payload changes.
