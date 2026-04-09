# Sidebar Mini-Dashboard

Replace the current sidebar session list with rich session cards that show dashboard-level information inline. Remove the separate Dashboard pane entirely.

## Session Cards

Each card displays:
- **Status dot** — colored by session status (same palette as today)
- **Session name** — truncated with ellipsis
- **Elapsed time** — e.g. "5m", "2h 13m", "1d"
- **Work directory** — basename only, full path in tooltip
- **Branch badge** — shown when worktree is enabled
- **Last terminal line** — monospace, single line, truncated

Card actions:
- **Kill button** — visible on hover, only for running sessions
- **Three-dot overflow menu** — contains Rename and View Diff (visible on hover)
- **Click** — opens/focuses the session's terminal tab in the pane area (same behavior as today)

## Sidebar Resize

The sidebar becomes resizable by dragging its right edge.
- Default width: 280px
- Min width: 180px
- Max width: 480px
- Resize handle: 4px invisible drag zone on the right edge, `col-resize` cursor
- Width persisted in config (alongside layout)

## Dashboard Removal

Remove all traces of the standalone Dashboard pane:
- Delete `frontend/src/lib/Dashboard.svelte`
- Remove `dashboard` variant from `PaneContent` union in `layout.ts`
- Remove `findLeafByDashboard`, `collectDashboardPanes` from `layout.ts`
- Remove dashboard-related layout cleanup in `App.svelte` `onMount`
- Remove `openDashboard()` function and `session.dashboard` keybinding action from `App.svelte`
- Remove `onDashboard` prop from `Sidebar.svelte`
- Remove Dashboard button from sidebar template
- Remove `dashboard` case from `PaneContainer.svelte`
- Remove `dashboard` option from `QuickPicker.svelte`
- Keep `GetDashboardData()` Go binding (it will be replaced by the new event)

## Data: Push via Events

Replace the polling `GetDashboardData()` approach with a push model.

### Backend Changes (`app.go` / `manager.go`)

Add a `dashboard-updated` event emitted by the Go backend:
- Emit on the existing `SetOnUpdate` callback (fires whenever session state changes)
- Also emit periodically (every 2s) to keep `last_line` and elapsed time fresh
- Payload: `[]DashboardSession` (same struct, already has all needed fields)

The `SetOnUpdate` callback in `app.go` `Startup()` already fires on session changes. Add a `dashboard-updated` emit there:

```go
runtime.EventsEmit(ctx, "dashboard-updated", a.manager.DashboardData())
```

Add a 2-second ticker goroutine in `Startup()` that also emits `dashboard-updated` with the current `DashboardData()`. Stop it in `Shutdown()`.

`GetDashboardData()` binding can remain for now but the frontend will not call it.

### Frontend Changes

**`Sidebar.svelte`** — subscribe to `dashboard-updated` event:
- Import `EventsOn` from wailsjs runtime
- Replace `sessions: SessionInfo[]` prop with reactive `DashboardSession[]` state populated from the event
- Keep `sessions` prop only for the initial render (or remove it and let the first event populate)
- Render cards using `DashboardSession` data

**`App.svelte`** — stop passing `sessions` to Sidebar for card rendering (Sidebar manages its own data). Still pass callback props: `onSelect`, `onNew`, `onKill`, `onRename`, `onViewDiff`.

## Event Contract

```
Event: "dashboard-updated"
Direction: Go → Frontend
Frequency: On session state change + every 2 seconds
Payload: DashboardSession[]

DashboardSession {
  id: string
  name: string
  work_dir: string
  status: "idle" | "working" | "waiting_for_approval" | "error" | "stopped" | "exited"
  started_at: string (ISO 8601)
  last_line: string
  worktree_enabled?: boolean
  branch_name?: string
}
```

## File Changes Summary

| Action | File | Change |
|--------|------|--------|
| Modify | `app.go` | Emit `dashboard-updated` in `SetOnUpdate` callback; add 2s ticker goroutine |
| Modify | `internal/session/manager.go` | No struct changes needed (`DashboardSession` already exists) |
| Modify | `frontend/src/lib/Sidebar.svelte` | Replace session list with card layout; subscribe to `dashboard-updated`; add overflow menu; add resize handle |
| Modify | `frontend/src/App.svelte` | Add sidebar resize state; remove dashboard-related code; update Sidebar props |
| Modify | `frontend/src/lib/layout.ts` | Remove `dashboard` from `PaneContent`, remove `findLeafByDashboard` |
| Modify | `frontend/src/lib/PaneContainer.svelte` | Remove Dashboard import and rendering case |
| Modify | `frontend/src/lib/QuickPicker.svelte` | Remove dashboard option |
| Modify | `frontend/src/lib/TabBar.svelte` | Remove dashboard tab label case |
| Delete | `frontend/src/lib/Dashboard.svelte` | Entire file |
