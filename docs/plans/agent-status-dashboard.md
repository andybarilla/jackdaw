# Agent Status Dashboard — Implementation Plan

**Spec:** This plan implements the Agent Status Dashboard as designed in the approved spec. Opens as a pane tab (type `"dashboard"`) showing all sessions as cards with status, working dir, elapsed time, and last terminal output line.

**Branch:** `feature/agent-status-dashboard`

## File Structure

| Action | Path |
|--------|------|
| Modify | `internal/session/statustracker.go` — add `lastLine` field and `LastLine()` method |
| Modify | `internal/session/statustracker_test.go` — tests for `lastLine` extraction |
| Modify | `internal/session/manager.go` — add `DashboardSession` type and `DashboardData()` method |
| Modify | `app.go` — add `GetDashboardData()` binding |
| Modify | `frontend/src/lib/layout.ts` — add `dashboard` PaneContent variant, `findLeafByDashboard`, `collectDashboardPanes` |
| Modify | `frontend/src/lib/layout.test.ts` — tests for new layout helpers |
| Modify | `frontend/src/lib/types.ts` — add `DashboardSession` interface |
| Create | `frontend/src/lib/Dashboard.svelte` — dashboard grid component |
| Modify | `frontend/src/lib/PaneContainer.svelte` — route `dashboard` content type |
| Modify | `frontend/src/lib/TabBar.svelte` — label for dashboard tabs |
| Modify | `frontend/src/lib/QuickPicker.svelte` — add "Dashboard" option |
| Modify | `frontend/src/lib/Sidebar.svelte` — add dashboard button |
| Modify | `frontend/src/lib/keybindings.ts` — add `session.dashboard` action and default binding |
| Modify | `frontend/src/App.svelte` — wire dashboard action, keyboard shortcut, cleanup on restart |

## Tasks

### Task 1: Backend — lastLine tracking in StatusTracker

**Files:** `internal/session/statustracker.go`, `internal/session/statustracker_test.go`

**Changes to `statustracker.go`:**

1. Add `lastLine string` field to `StatusTracker` struct.
2. Add `LastLine() string` method (lock, return, unlock — same pattern as `Status()`).
3. In `HandleOutput`, after the existing ANSI stripping (`cleaned := ansiPattern.ReplaceAll(data, nil)`), add lastLine extraction logic:
   - Split `cleaned` on `\n`.
   - Iterate lines in reverse.
   - Skip empty lines and lines matching `promptPattern`.
   - Store the first qualifying line in `st.lastLine` (truncate to 200 chars).
   - This goes inside the existing mutex lock, before the `isTerminal()` check (we want lastLine even for terminal-state sessions, but after ANSI strip).

**Changes to `statustracker_test.go`:**

4. `TestLastLineBasic` — send output with multiple lines, verify `LastLine()` returns the last non-empty, non-prompt line.
5. `TestLastLineSkipsPrompt` — send output ending with `❯ `, verify lastLine is the line before it.
6. `TestLastLineWithANSI` — send ANSI-wrapped output, verify lastLine has ANSI stripped.
7. `TestLastLineTruncation` — send a line > 200 chars, verify it's truncated to 200.
8. `TestLastLineEmptyOutput` — send empty/whitespace-only output, verify lastLine stays unchanged (empty string initially).

**Acceptance criteria:**
- `LastLine()` returns the last meaningful output line, ANSI-stripped, truncated to 200 chars.
- All new tests pass. Existing tests still pass.

---

### Task 2: Backend — DashboardData binding

**Files:** `internal/session/manager.go`, `app.go`

**Changes to `manager.go`:**

1. Add `DashboardSession` struct:
   ```go
   type DashboardSession struct {
       ID              string    `json:"id"`
       Name            string    `json:"name"`
       WorkDir         string    `json:"work_dir"`
       Status          Status    `json:"status"`
       StartedAt       time.Time `json:"started_at"`
       LastLine        string    `json:"last_line"`
       WorktreeEnabled bool      `json:"worktree_enabled,omitempty"`
       BranchName      string    `json:"branch_name,omitempty"`
   }
   ```

2. Add `DashboardData() []DashboardSession` method on `Manager`:
   - Acquire read lock.
   - Iterate `m.sessionInfo`. For each session, look up `m.statusTrackers[id]` to get `LastLine()`.
   - If no tracker exists (exited/stopped sessions), `last_line` is `""`.
   - Build and return `[]DashboardSession`.

**Changes to `app.go`:**

3. Add `GetDashboardData()` method on `App`:
   ```go
   func (a *App) GetDashboardData() []session.DashboardSession {
       return a.manager.DashboardData()
   }
   ```
4. After adding this, run `wails generate module` to regenerate JS bindings.

**Acceptance criteria:**
- `GetDashboardData` returns all sessions with their current status and last output line.
- Wails JS bindings are regenerated and include the new method.

---

### Task 3: Frontend — Layout and type extensions

**Files:** `frontend/src/lib/layout.ts`, `frontend/src/lib/layout.test.ts`, `frontend/src/lib/types.ts`

**Changes to `layout.ts`:**

1. Extend `PaneContent` union:
   ```typescript
   export type PaneContent =
     | { type: "session"; sessionId: string }
     | { type: "terminal"; id: string; workDir: string }
     | { type: "diff"; sessionId: string }
     | { type: "dashboard" };
   ```

2. Add `findLeafByDashboard(node: LayoutNode): FindResult | null` — same pattern as `findLeafByDiffSessionId` but matches `content.type === "dashboard"`. No ID needed since dashboard is a singleton concept.

3. Add `collectDashboardPanes(node: LayoutNode): number` — returns count of dashboard panes (used for deduplication). Follow same pattern as `collectDiffSessionIds` but return a count instead of IDs.

**Changes to `layout.test.ts`:**

4. Add tests for `findLeafByDashboard` — finds dashboard in leaf, returns null when absent, finds in nested split.
5. Add tests for `collectDashboardPanes` — counts 0 when none, counts correctly with multiple.

**Changes to `types.ts`:**

6. Add `DashboardSession` interface:
   ```typescript
   export interface DashboardSession {
     id: string;
     name: string;
     work_dir: string;
     status: SessionInfo["status"];
     started_at: string;
     last_line: string;
     worktree_enabled?: boolean;
     branch_name?: string;
   }
   ```

**Acceptance criteria:**
- TypeScript compiles with no errors (`npm run check`).
- New layout tests pass.
- `PaneContent` includes dashboard variant.

---

### Task 4: Frontend — Dashboard.svelte component

**Files:** `frontend/src/lib/Dashboard.svelte` (create)

**Component design:**

1. **Props:**
   ```typescript
   interface Props {
     onSelectSession: (id: string) => void;
   }
   ```

2. **Data fetching:** Import `GetDashboardData` from wailsjs bindings. Use `$effect` to poll every 2 seconds:
   ```typescript
   let dashboardSessions = $state<DashboardSession[]>([]);
   let error = $state<string | null>(null);

   $effect(() => {
     let active = true;
     async function poll() {
       try {
         dashboardSessions = await GetDashboardData();
         error = null;
       } catch (e) {
         error = e instanceof Error ? e.message : String(e);
       }
       if (active) setTimeout(poll, 2000);
     }
     poll();
     return () => { active = false; };
   });
   ```

3. **Elapsed time helper:** `formatElapsed(startedAt: string): string` — compute from `started_at` to now. Return `"Xm"`, `"Xh Ym"`, or `"Xd"`.

4. **Status color:** Reuse the same mapping as `Sidebar.svelte`:
   - `idle` → `var(--text-muted)`
   - `working` → `var(--accent)`
   - `waiting_for_approval` → `var(--warning)`
   - `error` → `var(--error)`
   - `stopped`/`exited` → `var(--text-muted)`

5. **Card layout per session:**
   - Status dot (8px circle, same as sidebar)
   - Session name (bold, `var(--text-primary)`)
   - Elapsed time (right-aligned, `var(--text-muted)`)
   - Working dir basename (`var(--text-secondary)`, full path as `title` tooltip)
   - Branch badge if `worktree_enabled` (same branch icon as sidebar `&#9741;`)
   - Last activity line (monospace, single-line, `text-overflow: ellipsis`, `var(--text-secondary)`)
   - If `last_line` is empty: show "No activity yet" in muted italic

6. **Grid layout:**
   ```css
   .dashboard-grid {
     display: grid;
     grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
     gap: 12px;
     padding: 16px;
     overflow-y: auto;
     height: 100%;
   }
   ```

7. **Card styling:**
   ```css
   .session-card {
     background: var(--bg-secondary);
     border: 1px solid var(--border);
     border-radius: 8px;
     padding: 12px;
     cursor: pointer;
   }
   .session-card:hover {
     border-color: var(--accent);
   }
   ```

8. **Click handler:** `onclick={() => onSelectSession(session.id)` on each card.

9. **Empty state:** When `dashboardSessions.length === 0` and no error, show centered "No sessions" text.

10. **Error state:** When `error` is set, show error message with muted text. Continue polling.

**Acceptance criteria:**
- Component renders a grid of cards from `GetDashboardData()`.
- Cards show status, name, dir, elapsed time, last line, branch badge.
- Click navigates to the session.
- Empty and error states handled.
- Polls every 2s, cleans up on destroy.

---

### Task 5: Frontend — Wire dashboard into panes, tabs, QuickPicker, sidebar, and keybindings

**Files:** `frontend/src/lib/PaneContainer.svelte`, `frontend/src/lib/TabBar.svelte`, `frontend/src/lib/QuickPicker.svelte`, `frontend/src/lib/Sidebar.svelte`, `frontend/src/lib/keybindings.ts`, `frontend/src/App.svelte`

**Changes to `PaneContainer.svelte`:**

1. Import `Dashboard` component.
2. Add dashboard case after the diff case:
   ```svelte
   {:else if content.type === "dashboard"}
     <Dashboard onSelectSession={...} />
   ```
3. Add `onSelectSession` to the Props interface, or pass it through from App.svelte. The dashboard's `onSelectSession` should trigger the same logic as sidebar select (navigate to session pane).

**Changes to `TabBar.svelte`:**

4. Add dashboard label in `getLabel`:
   ```typescript
   if (content.type === "dashboard") return "Dashboard";
   ```

**Changes to `QuickPicker.svelte`:**

5. Change `PaneChoice` type to `"terminal" | "session" | "dashboard"`.
6. Add a third button: `<button class="picker-btn dashboard" onclick={() => onSelect("dashboard")}>Dashboard</button>`.
7. Style the dashboard button with `var(--text-primary)` color and appropriate border.

**Changes to `Sidebar.svelte`:**

8. Add `onDashboard` prop to the Props interface.
9. Add a "Dashboard" button below the "+ New Session" button (or next to it):
   ```svelte
   <button class="dashboard-btn" onclick={onDashboard}>Dashboard</button>
   ```
10. Style: same sizing as `.new-session` button but with `background: transparent`, `border: 1px solid var(--border)`, `color: var(--text-secondary)`.

**Changes to `keybindings.ts`:**

11. Add `"session.dashboard"` to the `Action` union type.
12. Add default binding: `"session.dashboard": "Ctrl+Shift+G"` (note: `Ctrl+Shift+B` is already taken by `app.toggleSidebar`).

**Changes to `App.svelte`:**

13. Import `findLeafByDashboard` and `collectDashboardPanes` (though we mainly use `findLeafByDashboard`).
14. Add `openDashboard()` function:
    - Check if dashboard already open via `findLeafByDashboard(layoutTree)`.
    - If found, focus that pane and switch to its tab.
    - If not, add a dashboard tab to the focused pane: `addTab(layoutTree, focusedPath, { type: "dashboard" })`.
15. Add `"session.dashboard": () => openDashboard()` to the `actions` record.
16. Wire sidebar's `onDashboard={openDashboard}` prop.
17. Update `handleQuickPick` to handle `"dashboard"` choice — call `openDashboard()` but using the quick-pick path instead of focusedPath. Or simpler: add dashboard content directly to the pane at that path.
18. In the `onMount` layout cleanup section, add dashboard pane cleanup (same pattern as terminals/diffs — dashboard panes don't survive restart):
    ```typescript
    const dashFound = findLeafByDashboard(cleaned);
    if (dashFound) {
      cleaned = removeTab(cleaned, dashFound.path, dashFound.tabIndex);
    }
    ```
19. Pass `onSelectSession` through `SplitPane` → `PaneContainer` → `Dashboard`. This should call the same `handleSidebarSelect` logic.

**Acceptance criteria:**
- Dashboard opens as a pane tab via sidebar button, keyboard shortcut (`Ctrl+Shift+G`), or QuickPicker.
- Only one dashboard pane at a time (deduplication via `findLeafByDashboard`).
- Dashboard tab shows "Dashboard" label in tab bar.
- Clicking a card in the dashboard navigates to that session.
- Dashboard panes are cleaned up on app restart.
- `npm run check` passes.
- `npm run build` succeeds.

## Task Dependencies

```
Task 1 (StatusTracker lastLine) ──→ Task 2 (DashboardData binding) ──→ Task 4 (Dashboard.svelte)
                                                                              ↓
Task 3 (Layout + types) ─────────────────────────────────────────────→ Task 5 (Wire everything)
```

- Tasks 1 and 3 can run in parallel (backend and frontend type changes are independent).
- Task 2 depends on Task 1 (needs `LastLine()` method).
- Task 4 depends on Task 2 (needs `GetDashboardData` binding) and Task 3 (needs `DashboardSession` type).
- Task 5 depends on Tasks 3 and 4 (needs Dashboard component and layout types).

## Testing Strategy

- **Go unit tests:** `go test ./internal/session/...` after Tasks 1 and 2.
- **Frontend type check:** `cd frontend && npm run check` after Tasks 3, 4, 5.
- **Frontend build:** `cd frontend && npm run build` after Task 5.
- **Layout tests:** `cd frontend && npx vitest run` after Task 3.
- **Manual:** Open dashboard, verify cards render, click navigates, polling updates, empty state works.

## Notes

- The keyboard shortcut uses `Ctrl+Shift+G` instead of `Ctrl+Shift+B` (spec said `Ctrl+Shift+B` but that's already bound to `app.toggleSidebar`).
- Dashboard polling interval is 2 seconds as specified. This is a simple setTimeout loop rather than setInterval to avoid overlapping requests.
- `DashboardSession` is a separate type from `SessionInfo` to keep the dashboard payload minimal (no PID, exit_code, etc.).
