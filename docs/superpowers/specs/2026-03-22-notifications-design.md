# Desktop Notifications

## Overview

Add OS-native desktop notifications to Jackdaw so users are alerted when Claude Code sessions need attention, even when the Jackdaw window is hidden.

## Dependencies

- `tauri-plugin-notification` — OS-native notifications
- `tauri-plugin-store` — persistent key-value preferences (JSON file in platform app data dir)

Both registered in `lib.rs`, permissions added to `capabilities/default.json`.

### Permissions

Add to `capabilities/default.json`:

```json
"notification:default",
"notification:allow-notify",
"notification:allow-request-permission",
"notification:allow-is-permission-granted",
"store:allow-get",
"store:allow-set",
"store:allow-save",
"core:window:allow-is-focused",
"core:window:allow-show",
"core:window:allow-set-focus"
```

## Notification Events

Three hook events trigger notifications:

| Event | Title | When |
|-------|-------|------|
| `Notification` | "Approval Needed" | Claude needs user permission |
| `Stop` | "Waiting for Input" | Claude's turn ended, waiting for user |
| `SessionEnd` | "Session Ended" | Session exited |

Notification body includes CWD for context. For `SessionEnd`, use `HookPayload.cwd` directly since the session is removed from state before notification logic runs.

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

In `server.rs` `handle_event()`, **after dropping the session mutex lock** and after emitting the Tauri event:

1. Get the window via `app_handle.get_webview_window("main")` — if `None`, skip
2. Check `window.is_focused()` (returns `Result<bool>`) — if focused or error, skip
3. Read preference for this event type from store — if disabled, skip
4. Fire OS notification with title + CWD body (use `HookPayload.cwd` for all events)

Extract decision logic into a `should_notify(event_type, is_focused, prefs) -> bool` function for testability.

### Click Handler

Register via `tauri_plugin_notification::NotificationExt::on_notification_event()` during plugin setup in `lib.rs`. On click, call `window.show()` + `window.set_focus()` to bring Jackdaw forward.

### Permission Request

On startup (in `lib.rs`), check `is_permission_granted()`. If not granted, call `request_permission()`. This is required on macOS; other platforms grant by default.

## Frontend Settings UI

Gear icon in the header opens a settings view with three toggles:

- "Notify when approval needed"
- "Notify when waiting for input"
- "Notify when session ends"

Reads/writes directly to `tauri-plugin-store`. Settings is a new tab alongside Active/History in the Dashboard.

## Testing

- **Rust:** Unit tests for `should_notify` — all combinations of event type, preference state, and window focus
- **Frontend:** Vitest tests for settings component toggle behavior
