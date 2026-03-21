# Compact Session Cards

## Problem

With multiple active sessions (especially with subagents), session cards fill the screen quickly. Each card shows header, current tool, subagent count, and 5 history items — all always visible.

## Design

Replace the current always-expanded `SessionCard` with a hybrid compact/expanded layout. The existing status badge ("Running", "Waiting", "Approval") and dismiss button in the header are removed entirely — status is conveyed by the dot color/animation, and dismiss moves into the expanded view.

### States

`isActive` = `!pending_approval && (current_tool !== null || active_subagents > 0 || processing)`. Pending-approval sessions are NOT active — they show as a compact row with the blue pulsing dot and no tool row.

### Collapsed State (default)

A single dense row per session:
- Status dot (green pulsing = running, yellow = waiting, blue pulsing = pending approval)
- Project name (last directory segment from `cwd`)
- Subagent count inline (if > 0, e.g., "· 2 agents") — shown in both collapsed and expanded states, always in the header row
- Uptime (right-aligned, e.g., "12m")
- Expand chevron (▶ collapsed, ▼ expanded)

### Stable Tool Row (active sessions only)

Below the header row, active sessions always display a tool row. This row is always present when `isActive` is true — it never collapses/expands, only its content changes:
- **When a tool is active:** shows tool name + summary with the existing `tool-bg`/`tool-border` styling
- **When between tools** (`current_tool` is null but `isActive` is true): shows last item from `tool_history` in a dimmed style (opacity ~0.5, muted colors, ✓ instead of ▶). If `tool_history` is empty (e.g., fresh session with only subagents), show "processing..." in muted text instead.
- **When session becomes inactive** (`isActive` flips to false): tool row is removed, card becomes a single compact row

This eliminates expand/collapse flicker entirely for rapid Bash/Agent calls.

### Expanded State (click to toggle)

Clicking the row header toggles the expanded section below the tool row:
- Session ID
- Dismiss button (only visible here)
- Tool history list (last 5, same format as current)

Expanded state is per-session local UI state (not persisted). Border changes to `--blue` when expanded to indicate selection.

## Components

### `SessionCard.svelte` changes

- Add `expanded` local state (`$state(false)`)
- Derive `isActive` as defined above (excludes pending)
- Remove the status badge and header dismiss button entirely
- Restructure template:
  1. Header row (always visible, clickable to toggle expand) — contains status dot, project name, subagent count, uptime, chevron
  2. Tool row (visible when `isActive`, content switches between active/dimmed)
  3. Expanded section (visible when `expanded`, contains session ID, history, dismiss)
- Use Svelte `slide` transition for the expanded section
- Subagent count is always inline in the header row (the separate `<div class="subagents">` is removed)

### `Dashboard.svelte`

No structural changes needed. Gap between cards can be reduced from 12px to 6px since cards are more compact.

### Types / Store

No changes needed — all data already available in `Session` interface.

## Behavior Details

- **Tool row dimmed state:** When `current_tool` is null but `isActive` is true, show last item from `tool_history` with opacity ~0.5 and muted colors. If `tool_history` is empty, show "processing..." placeholder.
- **Transition to idle:** When `isActive` becomes false, tool row is removed. Card is a single compact row.
- **Pending approval:** Shows as a compact row with blue pulsing dot. No tool row. Can still be expanded to see history and dismiss.
- **Expand/collapse:** Pure local state, no backend changes. Clicking anywhere on the header row toggles. Use Svelte `transition:slide` for the expanded section.

## Testing

- Frontend tests for the expand/collapse toggle behavior
- Test that dimmed state renders when `current_tool` is null but session is active
- Test that dismiss button only appears in expanded view
- Test that pending-approval sessions do not show the tool row
- Test fallback "processing..." when active with empty tool history
