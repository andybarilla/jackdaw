# Sidebar Mini-Dashboard — Implementation Plan

**Spec:** `docs/specs/sidebar-mini-dashboard.md`
**Branch:** `feature/sidebar-mini-dashboard`

## File Structure

| Action | Path |
|--------|------|
| Modify | `app.go` — emit `dashboard-updated` in `SetOnUpdate` callback; add 2s ticker goroutine |
| Modify | `frontend/src/lib/Sidebar.svelte` — replace session list with card layout; subscribe to `dashboard-updated`; add resize handle |
| Modify | `frontend/src/App.svelte` — sidebar resize state; remove dashboard refs; update Sidebar props |
| Modify | `frontend/src/lib/layout.ts` — remove `dashboard` from `PaneContent`; remove `findLeafByDashboard`, `collectDashboardPanes` |
| Modify | `frontend/src/lib/PaneContainer.svelte` — remove Dashboard import and rendering case |
| Modify | `frontend/src/lib/QuickPicker.svelte` — remove dashboard option |
| Modify | `frontend/src/lib/TabBar.svelte` — remove dashboard tab label case |
| Modify | `frontend/src/lib/keybindings.ts` — remove `session.dashboard` action and binding |
| Delete | `frontend/src/lib/Dashboard.svelte` |

## Tasks

### Task 1: Backend — emit `dashboard-updated` event

**Files:** `app.go`

1. In `Startup()`, after the existing `SetOnUpdate` callback body, add:
   ```go
   runtime.EventsEmit(ctx, "dashboard-updated", a.manager.DashboardData())
   ```
   This line goes inside the callback, after the `prevStatuses = currentStatuses` assignment.

2. Add a 2-second ticker goroutine in `Startup()`, after the `SetOnUpdate` block:
   ```go
   dashTicker := time.NewTicker(2 * time.Second)
   go func() {
       for range dashTicker.C {
           runtime.EventsEmit(ctx, "dashboard-updated", a.manager.DashboardData())
       }
   }()
   ```

3. Add `dashTicker *time.Ticker` field to the `App` struct. Store the ticker: `a.dashTicker = dashTicker`.

4. In `Shutdown()`, add `a.dashTicker.Stop()` before existing cleanup.

**Why a field:** The ticker must be stopped on shutdown to avoid goroutine leaks.

---

### Task 2: Remove dashboard from layout system

**Files:** `frontend/src/lib/layout.ts`

1. Remove `| { type: "dashboard" }` from the `PaneContent` union type.

2. Delete the `findLeafByDashboard` function (lines 214-232).

3. Delete the `collectDashboardPanes` function (lines 234-242).

4. In `migrateLayout`, the existing code handles any `PaneContent` generically — no dashboard-specific logic to remove.

---

### Task 3: Remove Dashboard pane rendering

**Files:** `frontend/src/lib/PaneContainer.svelte`, `frontend/src/lib/TabBar.svelte`, `frontend/src/lib/QuickPicker.svelte`

**PaneContainer.svelte:**
1. Remove `import Dashboard from "./Dashboard.svelte";` (line 10).
2. Remove the `{:else if content.type === "dashboard"}` block (lines 147-148).

**TabBar.svelte:**
1. In `getLabel()`, remove the `if (content.type === "dashboard") return "Dashboard";` line (line 33).

**QuickPicker.svelte:**
1. Change the `PaneChoice` type to `"terminal" | "session"` (remove `"dashboard"`).
2. Delete the Dashboard button element and its `.picker-btn.dashboard` styles.

---

### Task 4: Remove dashboard references from App.svelte

**Files:** `frontend/src/App.svelte`, `frontend/src/lib/keybindings.ts`

**App.svelte:**
1. Remove `findLeafByDashboard` and `collectDashboardPanes` from the layout imports (lines 30-31).
2. Remove the `openDashboard` function (lines 558-566).
3. Remove `"session.dashboard": () => openDashboard()` from the `actions` map (line 184).
4. Remove `onDashboard={openDashboard}` prop from the `<Sidebar>` component (line 676).
5. Remove the dashboard cleanup block in `onMount` (lines 333-338 — the `findLeafByDashboard` while loop).
6. In `handleQuickPick`, remove the `"dashboard"` case (lines 572-581). Update the type signature from `"terminal" | "session" | "dashboard"` to `"terminal" | "session"`.

**keybindings.ts:**
1. Remove `"session.dashboard"` from the `KeyAction` union type.
2. Remove `"session.dashboard": "Ctrl+Shift+G"` from the default keymap.

---

### Task 5: Delete Dashboard.svelte

**Files:** `frontend/src/lib/Dashboard.svelte`

Delete the file. All imports were removed in Tasks 3-4.

---

### Task 6: Sidebar — subscribe to `dashboard-updated` and render cards

**Files:** `frontend/src/lib/Sidebar.svelte`, `frontend/src/lib/types.ts`

This is the main UI task. Replace the current session list with rich cards populated by the push event.

**Props changes:**
1. Remove `sessions` prop and `activeSessionId` prop.
2. Remove `onDashboard` prop.
3. Keep: `onSelect`, `onNew`, `onKill`, `onRename`, `onViewDiff`.

**State:**
1. Add `import { onDestroy } from "svelte";`
2. Add `import { EventsOn } from "../../wailsjs/runtime/runtime";`
3. Add `import type { DashboardSession } from "./types";`
4. Add reactive state: `let dashboardSessions = $state<DashboardSession[]>([]);`
5. Subscribe to `dashboard-updated` event. Store the cleanup function and call it in `onDestroy`.

**Card template** (replace the session list `{#each}` block):
Each card shows:
- Status dot (colored, with pulse animation for `waiting_for_approval` or notification)
- Session name (truncated, double-click to rename inline)
- Elapsed time (use `formatElapsed` from Dashboard.svelte — move it here)
- Work dir basename (full path in tooltip)
- Branch badge (when `worktree_enabled`)
- Last terminal line (monospace, single line, truncated)

**Card actions:**
- Click card → `onSelect(session.id)`
- Kill button (x) — visible on hover, only when status is not `stopped`/`exited`
- Three-dot overflow menu — visible on hover, contains Rename and View Diff. Use a simple `<details>` or toggle state. Rename opens inline edit (same pattern as current). View Diff calls `onViewDiff(session.id)`.

**Remove:** The Dashboard button from the template.

**Styles:** Cards should be vertically stacked in the sidebar (not a grid). Each card is a compact block — status dot + name + time on the first row, work dir + branch on the second row, last line on the third row. Hover shows kill button and overflow menu.

---

### Task 7: Sidebar resize

**Files:** `frontend/src/lib/Sidebar.svelte`, `frontend/src/App.svelte`

**Sidebar.svelte:**
1. Add a `width` prop (number, default 280).
2. Add an `onResize` callback prop `(width: number) => void`.
3. Add a 4px invisible drag handle on the right edge of the sidebar. On mousedown, start tracking mousemove to compute new width. Clamp to 180-480px range. On mouseup, call `onResize(newWidth)`. Set `cursor: col-resize` on the handle.
4. Apply `width` via inline style: `style="width: {width}px; min-width: {width}px"`.

**App.svelte:**
1. Add `let sidebarWidth = $state(280);` state.
2. On mount, load sidebar width from config (add to the existing config load block).
3. Pass `width={sidebarWidth}` and `onResize={(w) => { sidebarWidth = w; }}` to `<Sidebar>`.
4. Persist `sidebarWidth` to config. Add it to the existing layout persist `$effect` — save as `sidebar_width` alongside `layout`.

---

### Task 8: Update App.svelte Sidebar props

**Files:** `frontend/src/App.svelte`

1. Remove `{sessions}` and `activeSessionId={null}` props from the `<Sidebar>` component.
2. The Sidebar now manages its own session data via the `dashboard-updated` event.
3. Verify `onSelect`, `onNew`, `onKill`, `onRename`, `onViewDiff` are still passed.

---

### Task 9: Verify and clean up

1. Run `cd frontend && npm run check` — fix any type errors.
2. Run `cd frontend && npm run build` — ensure it compiles.
3. Run `go test ./internal/...` — ensure Go tests pass.
4. Verify `wails dev` starts without errors (manual check by implementer if possible).
