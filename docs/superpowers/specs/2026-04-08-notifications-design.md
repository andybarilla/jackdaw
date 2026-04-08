# Notifications Design

## Overview

Surface alerts when a background session needs attention. Two trigger types: session exit and agent waiting for input (permission prompts, questions). Notifications are delivered both in-app (sidebar badge + toast) and via OS-level desktop notifications when the app is unfocused.

## Notification Types

| Type | Trigger | Detection |
|------|---------|-----------|
| `session_exited` | Process exits | Manager's existing `OnExit` callback |
| `input_required` | Agent waiting for user input | Claude Code `Notification` hook (primary), output pattern matching (fallback) |

Each notification carries: `sessionID`, `sessionName`, `type`, `message`, `timestamp`.

## Architecture: Event Bus

New package `internal/notification/` with a central `NotificationService` that receives events from multiple sources and dispatches to multiple outputs.

### Input Channels

**Hook listener** — TCP server on `127.0.0.1:<random-port>`. When Jackdaw spawns a Claude Code session, it sets `CLAUDE_CODE_HOOKS` env var on the process, configuring the `Notification` hook to POST JSON to `http://127.0.0.1:<port>/notify/<jackdaw-session-id>`. The Jackdaw session ID is embedded in the URL path since Claude Code's internal session ID differs from Jackdaw's.

Hook payload from Claude Code:
```json
{
  "hook_event_name": "Notification",
  "session_id": "claude-internal-id",
  "notification_type": "permission_prompt",
  "message": "Allow Read tool on /home/...",
  "title": "Permission Required"
}
```

Mapped to internal notification:
```json
{
  "sessionID": "jackdaw-session-id",
  "type": "input_required",
  "message": "Permission Required: Allow Read tool on /home/...",
  "timestamp": 1712345678
}
```

**Session events** — Manager registers a callback that feeds exit events into the service.

**Pattern matcher** — fallback for sessions without hook integration. Attaches to the per-session `OnOutput` callback, accumulates recent output in a ~2KB ring buffer, and scans for known patterns:
- Claude Code permission prompts: `Allow`, `Deny`, `approve` in prompt context
- Generic input prompts: `[y/N]`, `[Y/n]`, `Press Enter`, `Continue?`
- Password prompts: `password:`, `passphrase:`

Pattern matcher activates 5 seconds after session creation if no hook message has been received for that session. Debounced: after firing, suppresses the same type for the same session for 10 seconds.

### Output Channels

**Wails event** (`notification-fired`) — sends notification payload to frontend for toast and badge rendering.

**Desktop notifier** — fires OS notification only when the app window is not focused. Cross-platform delivery:

| OS | Method |
|----|--------|
| Linux | `notify-send` via `exec.Command` |
| macOS | `osascript -e 'display notification ...'` via `exec.Command` |
| Windows | PowerShell toast notification via `exec.Command` |

Desktop notification content: title is session name, body is event message. No click-to-focus handling in v1.

If reliable window focus detection isn't available via Wails runtime, fall back to always firing desktop notifications (user can disable via config).

## Frontend

### New: ToastContainer.svelte

Positioned top-right. Listens to `notification-fired` Wails event. Each toast displays:
- Session name and notification message
- "Go to session" button — switches focused pane to that session
- "Dismiss" button — removes the toast

Auto-dismisses after configured duration (default 5 seconds). Hover pauses the dismiss timer.

### Modified: Sidebar.svelte

Sessions with active notifications show an attention indicator: pulsing status dot + `!` badge. Highlighted row background.

### State Management

A `notifications` Svelte store holds active notifications keyed by session ID. Updated by `notification-fired` Wails events. Cleared when:
- User navigates to the session (focuses a pane containing it)
- User clicks "Dismiss" on the toast

Clearing emits a `notification-dismissed` event back to Go so the service can track state and suppress further desktop notifications for that session until a new event fires.

## Configuration

New fields in `Config` struct:

```go
NotificationsEnabled  bool `json:"notifications_enabled"`   // default: true
DesktopNotifications  bool `json:"desktop_notifications"`   // default: true
ToastDurationSeconds  int  `json:"toast_duration_seconds"`  // default: 5
```

## Scope Boundaries

**In scope:**
- `session_exited` and `input_required` notification types
- Claude Code hook integration via `CLAUDE_CODE_HOOKS` env var
- Pattern matching fallback for non-hook sessions
- In-app toast with "Go to session" and "Dismiss" actions
- Sidebar badge/indicator for sessions needing attention
- OS desktop notifications when app is unfocused
- Configurable toast duration

**Out of scope (future roadmap items):**
- "Approve" action on toast for permission prompts
- Error pattern detection
- User-defined custom triggers
- Click-to-focus from desktop notifications
