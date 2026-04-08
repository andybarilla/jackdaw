# Session Status Redesign

## Problem

Jackdaw currently tracks three session statuses: `running`, `stopped`, `exited`. These don't reflect what Claude is actually doing. A "running" session could be idle, actively working, or waiting for user approval -- the user has no way to tell without switching to that terminal.

## Design

Replace the current three-value `Status` type with a six-value set that captures Claude's behavioral state:

| Status | Meaning | How detected |
|--------|---------|--------------|
| `idle` | Claude is at prompt, waiting for user to type a task | Terminal output pattern: `>` prompt with no activity |
| `working` | Claude is actively generating/executing | Default state after input; cleared when idle/waiting detected |
| `waiting_for_approval` | Claude is asking for permission (tool use, file write, etc.) | Hook listener payload (`notification_type=permission_prompt`) or pattern matcher (`[Y/n]`, allow/deny) |
| `error` | An error was detected in the session | Error detector fired |
| `stopped` | User killed the session via Jackdaw | Explicit kill action |
| `exited` | Process terminated on its own | PTY exit callback |

### Status Transitions

```
[new session] --> working --> idle (prompt detected)
                         --> waiting_for_approval (permission prompt)
                         --> error (error detected)
                         --> exited (process exit)
                         --> stopped (user kill)

idle --> working (user sends input)

waiting_for_approval --> working (user responds)

error --> working (activity resumes)
      --> idle (prompt detected)
```

`stopped` and `exited` are terminal states.

### Detection Approach

The existing notification infrastructure already detects the key signals. The status system will tap into the same data sources without duplicating detection logic:

1. **Hook listener** (`/notify/<sessionID>`): Claude Code hooks already POST here for permission prompts. Parse `notification_type` to set `waiting_for_approval`.

2. **Pattern matcher**: Already detects `[Y/n]`, allow/deny patterns. Use these as fallback for `waiting_for_approval` when hooks aren't available.

3. **Error detector**: Already detects error patterns. Use to set `error` status.

4. **Terminal output analysis**: New logic to detect Claude's idle prompt. When the prompt pattern appears after a period of working, transition to `idle`.

5. **Terminal input**: When user sends input to a session in `idle` or `waiting_for_approval`, transition to `working`.

### Idle Detection

Claude Code's idle state is detected by watching terminal output for the prompt. The specific approach:

- Watch for the `❯` prompt character (U+276F) or a line matching Claude's prompt pattern after a brief settling period (e.g., 500ms debounce after last output).
- A debounce prevents flickering during rapid output that happens to contain prompt-like characters.

### Integration Points

**Go side (`internal/session/manager.go`):**
- `Status` type changes from 3 to 6 values.
- `SessionInfo.Status` updated by a new `StatusTracker` component per session.
- `StatusTracker` receives signals from: hook listener, pattern matcher, error detector, terminal output, terminal input.
- Status changes trigger the existing `notifyUpdate()` path so the frontend gets `sessions-updated` events.

**Frontend (`Sidebar.svelte`):**
- `statusColor()` maps all six statuses to colors.
- Suggested colors: `idle` = dim/muted, `working` = blue/accent, `waiting_for_approval` = warning/amber (pulse animation), `error` = red, `stopped` = gray, `exited` = gray.
- The existing notification badge (`!`) and pulse animation for `waiting_for_approval` can remain as additional emphasis.

**Frontend (`types.ts`):**
- `SessionInfo.status` union type expands to include all six values.

### What This Does NOT Change

- The notification system continues to work as-is. Status is a parallel concern -- notifications are user-facing alerts, status is sidebar state.
- No new Wails method bindings needed. Status flows through the existing `sessions-updated` event.
- No changes to manifests or process recovery. Recovered sessions start as `working` (they're running but we can't know their exact state until we observe output).

## Files Modified

- `internal/session/manager.go` -- new status constants, StatusTracker integration
- `internal/session/statustracker.go` -- new file, per-session status state machine
- `internal/session/statustracker_test.go` -- new file
- `app.go` -- wire StatusTracker signals from hook listener, pattern matcher, error detector, terminal I/O
- `frontend/src/lib/types.ts` -- expand status union type
- `frontend/src/lib/Sidebar.svelte` -- update `statusColor()` for new statuses

## Testing

- Unit tests for `StatusTracker` state machine: verify all transitions, debounce behavior, terminal states.
- Manual testing: launch sessions, verify sidebar dot changes color as Claude moves through idle/working/waiting/error states.
