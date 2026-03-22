# Desktop Notifications

## Overview

Add OS-native desktop notifications to Jackdaw so users are alerted when Claude Code sessions need attention, even when the Jackdaw window is hidden.

## Dependencies

- `tauri-plugin-notification` — OS-native notifications
- `tauri-plugin-store` — persistent key-value preferences

Both registered in `lib.rs`, permissions added to `capabilities/default.json`.

## Notification Events

Three hook events trigger notifications:

| Event | Title | When |
|-------|-------|------|
| `Notification` | "Approval Needed" | Claude needs user permission |
| `Stop` | "Waiting for Input" | Claude's turn ended, waiting for user |
| `SessionEnd` | "Session Ended" | Session exited |

Notification body includes the session's CWD for context.

## Preferences

Stored via `tauri-plugin-store` in a `settings.json` file (platform app data directory).

```json
{
  "notifications": {
    "on_approval_needed": true,
    "on_session_end": true,
    "on_stop": true
  }
}
```

All default to `true`. Frontend reads/writes directly via store plugin API.

## Notification Logic

In `server.rs` `handle_event()`, after state update and before emitting the Tauri event:

1. Check `window.is_focused()` — if focused, skip
2. Read preference for this event type from store — if disabled, skip
3. Fire OS notification with title + CWD body
4. On notification click — `window.show()` + `window.set_focus()`

Extract decision logic into a `should_notify(event_type, is_focused, prefs) -> bool` function for testability.

## Frontend Settings UI

Gear icon in the header opens a settings view with three toggles:

- "Notify when approval needed"
- "Notify when waiting for input"
- "Notify when session ends"

Reads/writes directly to `tauri-plugin-store`.

## Testing

- **Rust:** Unit tests for `should_notify` — all combinations of event type, preference state, and window focus
- **Frontend:** Vitest tests for settings component toggle behavior
