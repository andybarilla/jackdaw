# Informative Tray & Session Icons

## Goal

Replace the current monochrome tray dots and Unicode tool indicators with distinct, color-coded Lucide icons that communicate session and tool state at a glance.

## Tray Icons

### States (highest priority wins)

| Priority | State              | Lucide icon      | Color  | Trigger                                                                 |
|----------|--------------------|------------------|--------|-------------------------------------------------------------------------|
| 1        | Waiting for approval | `shield-alert` | Orange | Any session has `pending_approval == true`                              |
| 2        | Waiting for input  | `message-square` | Blue   | Any session idle (no tool, no subagents, not processing, not pending)   |
| 3        | Running            | `play`           | Green  | Any session has `current_tool`, `active_subagents > 0`, or `processing` |
| 4        | Idle               | `circle`         | Gray   | No sessions                                                            |

### Priority resolution

When multiple sessions exist in different states, the tray displays the single highest-priority state. Tooltip shows counts per state (e.g., "Jackdaw — 1 running, 1 waiting for approval").

### Tray PNGs

Manually export Lucide SVGs at 32px with the appropriate fill color. Stored in `static/icons/` replacing `tray-green.png`, `tray-yellow.png`, `tray-gray.png` with new files named by state:
- `tray-approval.png` (orange `shield-alert`)
- `tray-input.png` (blue `message-square`)
- `tray-running.png` (green `play`)
- `tray-idle.png` (gray `circle`)

## SessionCard Icons

### Session status

The colored dot in the SessionCard header row is replaced with the matching Lucide icon + color from the tray state table. This applies per-session (not the global priority — each card shows its own state).

### Tool-type icons

Replace `▶`/`✓` Unicode characters in the tool row and history list with tool-specific Lucide icons, color-coded by category:

| Category   | Tools        | Lucide icon                  | Color  |
|------------|--------------|------------------------------|--------|
| Shell      | Bash         | `terminal`                   | Green  |
| File read  | Read         | `file-text`                  | Blue   |
| File write | Edit, Write  | `pencil` / `file-plus`       | Orange |
| Search     | Glob, Grep   | `folder-search` / `search`   | Purple |
| Agent      | Agent        | `bot`                        | Cyan   |
| Unknown    | Everything else | `wrench`                  | Gray   |

### New component: `ToolIcon.svelte`

Takes a `toolName` prop, returns the correct Lucide icon with the appropriate color. Used in both the active tool row and history list.

## Backend Changes

### `tray.rs`

- New `TrayState` enum: `WaitingForApproval`, `WaitingForInput`, `Running`, `Idle`.
- `compute_tray_state` returns `TrayState` instead of `(usize, usize)`.
- 4 embedded PNGs (replacing 3).
- Tooltip includes counts per active state.

### `state.rs`

No changes. Existing fields (`pending_approval`, `current_tool`, `active_subagents`, `processing`) already capture all 4 states.

### `server.rs`

No changes. Event handling logic is unchanged.

## Frontend Changes

### Dependencies

- Add `lucide-svelte` npm package.

### `ToolIcon.svelte` (new)

Maps `tool_name` to a Lucide icon component and CSS color class. Falls back to `wrench` in gray for unknown tools.

### `SessionCard.svelte`

- Header row: replace `.status-dot` span with a Lucide session-state icon (per-session state, not global tray priority).
- Tool row (active): replace `▶` span with `ToolIcon`.
- Tool row (dimmed/completed): replace `✓` span with `ToolIcon`.
- History list: replace `✓` checkmarks with `ToolIcon`.

## Out of Scope

- Error state — deferred until a reliable signal exists in Claude Code hook events.
- Desktop notification styling — OS-level notifications unchanged.
- Backend `Session` struct changes — no new fields needed.
- IPC protocol changes — no payload changes.
