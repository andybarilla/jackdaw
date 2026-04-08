# Session Status Redesign - Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-08-session-status-redesign.md`

## File Structure

```
internal/session/
  manager.go           -- modify: new status constants, StatusTracker wiring
  statustracker.go     -- new: per-session status state machine
  statustracker_test.go -- new: unit tests
app.go                 -- modify: feed signals to StatusTracker
frontend/src/lib/
  types.ts             -- modify: expand status union
  Sidebar.svelte       -- modify: statusColor(), conditional UI logic
```

## Tasks

### Task 1: Define new status constants and StatusTracker skeleton

**Files:** `internal/session/manager.go`, `internal/session/statustracker.go`

1. In `manager.go`, replace the three `Status` constants with six:
   - Remove: `StatusRunning`
   - Add: `StatusIdle`, `StatusWorking`, `StatusWaitingForApproval`, `StatusError`
   - Keep: `StatusStopped`, `StatusExited`

2. Create `statustracker.go` with a `StatusTracker` struct:
   - Fields: `mu sync.Mutex`, `status Status`, `onChange func(Status)`, `idleTimer *time.Timer`, `idleDelay time.Duration` (default 500ms)
   - Constructor: `NewStatusTracker(onChange func(Status)) *StatusTracker` -- initial status is `StatusWorking`
   - Methods:
     - `Status() Status` -- returns current status (lock-free read is fine, but use mutex for consistency)
     - `HandleOutput(data []byte)` -- strips ANSI, checks for idle prompt (`❯` / U+276F at line start after whitespace), resets idle debounce timer. If debounce fires, set status to `idle`.
     - `HandleInput()` -- if current status is `idle` or `waiting_for_approval`, transition to `working`
     - `HandlePermissionPrompt()` -- set status to `waiting_for_approval`
     - `HandleError()` -- set status to `error`
     - `HandleExit(exitCode int)` -- set status to `exited` (terminal)
     - `HandleStop()` -- set status to `stopped` (terminal)
     - `setStatus(s Status)` -- internal: if different from current and not in terminal state, call `onChange`

3. Update all references to `StatusRunning` in `manager.go`:
   - `Create()`: set initial status to `StatusWorking` instead of `StatusRunning`
   - `Recover()`: set recovered session status to `StatusWorking`
   - `Kill()`: use `StatusStopped` (already correct)
   - `OnExit` callback: use `StatusExited` (already correct)

**Acceptance criteria:** Code compiles. Status constants are the new six values. StatusTracker has all methods with correct state machine logic. No tests yet (Task 2).

### Task 2: StatusTracker unit tests

**Files:** `internal/session/statustracker_test.go`

Test cases:
1. Initial status is `working`
2. `HandleOutput` with prompt character triggers `idle` after debounce delay
3. `HandleOutput` with non-prompt content does not trigger `idle`
4. `HandleInput` from `idle` transitions to `working`
5. `HandleInput` from `waiting_for_approval` transitions to `working`
6. `HandlePermissionPrompt` transitions to `waiting_for_approval`
7. `HandleError` transitions to `error`
8. `HandleOutput` with prompt after `error` transitions to `idle` (error is not terminal)
9. Activity after `error` transitions to... `idle` (via prompt) -- error clears on next observed state
10. `HandleExit` is terminal -- subsequent calls to HandleInput/HandleOutput/etc. do not change status
11. `HandleStop` is terminal -- same as above
12. Debounce: rapid output resets the timer, idle only fires after output settles
13. `onChange` callback fires on every transition, does not fire when status unchanged

Use a short debounce (e.g., 10ms) in tests to avoid slow tests. Use `time.Sleep` or test the timer reset logic directly.

**Acceptance criteria:** All tests pass. `go test ./internal/session/...` succeeds.

### Task 3: Wire StatusTracker into Manager and App

**Files:** `internal/session/manager.go`, `app.go`

1. In `Manager`, add a `statusTrackers map[string]*StatusTracker` field, initialize in `NewManager`.

2. In `Manager.Create()`:
   - Create a `StatusTracker` for the session with an `onChange` callback that updates `SessionInfo.Status` and calls `notifyUpdate()`.
   - Store in `statusTrackers` map.

3. In `Manager.Recover()`:
   - Create a `StatusTracker` for recovered sessions (initial status `working`).

4. Add `Manager.StatusTracker(id string) *StatusTracker` method to expose the tracker for a session.

5. In `Manager.Kill()`:
   - Call `tracker.HandleStop()` instead of directly setting `si.Status = StatusStopped`.
   - Clean up tracker from map.

6. In `Manager.Create()` OnExit callback:
   - Call `tracker.HandleExit(exitCode)` instead of directly setting `si.Status = StatusExited`.
   - Clean up tracker from map.

7. In `app.go` `CreateSession()`:
   - After creating the session, get the StatusTracker via `a.manager.StatusTracker(info.ID)`.
   - In the `onOutput` callback (the closure passed to `manager.Create`), add: `tracker.HandleOutput(data)`.
   - Wire hook listener: modify `handleNotify` to also call `tracker.HandlePermissionPrompt()` when a notification comes in. Add an `OnHook` callback to `HookListener` or add a new method to Manager that App calls.
   - Wire error detector: modify error detector to call `tracker.HandleError()` when an error is detected. Add an `OnError` callback to `ErrorDetector` or handle in the Feed path.

8. In `app.go` `terminal-input` event handler:
   - After writing to session, call `tracker.HandleInput()`.

9. In `app.go` `CreateSession()` for pattern matcher:
   - When pattern matcher fires (fallback for permission prompt), also call `tracker.HandlePermissionPrompt()`.

**Integration approach for hook listener / pattern matcher / error detector signals:**

Rather than modifying the notification types themselves (which serve a different purpose), add callback hooks:
- `PatternMatcher.OnMatch func()` -- called when a pattern fires, App sets this to `tracker.HandlePermissionPrompt()`
- `ErrorDetector.OnError func()` -- called when an error fires, App sets this to `tracker.HandleError()`
- `HookListener`: add `OnNotification func(sessionID string)` -- called on any notification, App sets this to look up and call `tracker.HandlePermissionPrompt()`

**Acceptance criteria:** Status transitions work end-to-end. Creating a session starts as `working`. Output containing the prompt character transitions to `idle` after debounce. Hook notifications set `waiting_for_approval`. Error detection sets `error`. Input transitions back to `working`. Kill/exit work as terminal states. `sessions-updated` events fire on every transition.

### Task 4: Frontend status types and sidebar colors

**Files:** `frontend/src/lib/types.ts`, `frontend/src/lib/Sidebar.svelte`

1. In `types.ts`, update the `status` union type:
   ```typescript
   status: "idle" | "working" | "waiting_for_approval" | "error" | "stopped" | "exited";
   ```

2. In `Sidebar.svelte`, update `statusColor()`:
   ```typescript
   function statusColor(status: SessionInfo["status"]): string {
     switch (status) {
       case "idle":
         return "var(--text-muted)";
       case "working":
         return "var(--accent)";
       case "waiting_for_approval":
         return "var(--warning)";
       case "error":
         return "var(--error)";
       case "stopped":
       case "exited":
         return "var(--text-muted)";
     }
   }
   ```

3. Update conditional UI logic in `Sidebar.svelte`:
   - The diff button currently shows for `status !== "stopped"` -- keep this (works with new statuses).
   - The kill button currently shows for `status === "running"` -- change to show for all non-terminal statuses: `status !== "stopped" && status !== "exited"`.
   - Add pulse animation for `waiting_for_approval` status (in addition to existing notification pulse): add `class:pulse={session.status === 'waiting_for_approval'}` to the status dot.

4. In `app.go`, update the exit detection in `SetOnUpdate`:
   - Change `prev == session.StatusRunning` to check for any non-terminal status (since `StatusRunning` no longer exists). Use a helper or check `prev != StatusStopped && prev != StatusExited`.

**Acceptance criteria:** Frontend compiles (`npm run check` and `npm run build` pass). Sidebar shows correct colors for all six statuses. Kill button visible for all active statuses. `waiting_for_approval` status dot pulses.

## Task Dependencies

```
Task 1 (status constants + StatusTracker) 
  → Task 2 (unit tests)
  → Task 3 (wiring into Manager/App)
    → Task 4 (frontend)
```

Tasks 1-3 are backend, Task 4 is frontend. Task 2 and Task 3 both depend on Task 1 but are independent of each other -- however running them sequentially is safer since Task 3 may reveal issues in the StatusTracker API that would require test updates.

## Testing Strategy

- **Unit tests:** Task 2 covers StatusTracker state machine exhaustively
- **Integration:** Task 3 acceptance criteria verify end-to-end signal flow
- **Manual:** Launch app, create a session, observe sidebar dot color changes through idle/working/waiting/error states
- **Build verification:** `go test ./internal/...`, `cd frontend && npm run check && npm run build`
