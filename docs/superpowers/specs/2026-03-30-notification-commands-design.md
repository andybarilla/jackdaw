# Notification Commands

Run a user-defined shell command whenever a notification fires. The command receives context via environment variables, enabling automation like text-to-speech, sounds, logging, or webhook triggers.

## Configuration

A single `notification_command` string stored in `settings.json` alongside existing notification prefs. The command runs on any event that passes the existing `should_notify()` check — same events, same prefs, same window-focus gate. No per-event command configuration; the env vars let the script branch on event type.

```json
{
  "notifications": {
    "on_approval_needed": true,
    "on_session_end": true,
    "on_stop": true
  },
  "notification_command": "~/.config/jackdaw/on-notify.sh"
}
```

Empty string or absent key means no command runs. The desktop notification fires regardless.

## Environment Variables

| Variable | Value | Example |
|----------|-------|---------|
| `JACKDAW_SESSION_ID` | Session UUID | `abc-123-def` |
| `JACKDAW_EVENT` | Hook event name | `Notification`, `Stop`, `SessionEnd` |
| `JACKDAW_CWD` | Session working directory | `/home/user/project` |
| `JACKDAW_TITLE` | Notification title | `Approval Needed` |
| `JACKDAW_BODY` | Notification body text | `Session in /home/user/project needs approval` |

## Execution

In `server.rs`, after the existing desktop notification block:

1. Read `notification_command` from the store (same store access already open for prefs).
2. If non-empty and `should_notify()` returned true, spawn the command.
3. Shell expansion: run via `sh -c <command>` (Unix) or `cmd /C <command>` (Windows) so users can use `~`, pipes, etc.
4. Tilde expansion: replace leading `~/` with the user's home directory before passing to shell (some shells don't expand `~` in `sh -c` context).
5. Fire-and-forget: `tokio::spawn` the process. Don't block the event handler.
6. Timeout: kill after 10 seconds via `tokio::time::timeout`.
7. Errors (missing binary, non-zero exit, timeout) logged to stderr. No user-visible error UI — this is a power-user feature.

### Implementation

New function in `notify.rs`:

```rust
pub async fn run_notification_command(
    command: &str,
    session_id: &str,
    event_name: &str,
    cwd: &str,
    title: &str,
    body: &str,
) {
    let expanded = if command.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            format!("{}{}", home.display(), &command[1..])
        } else {
            command.to_string()
        }
    } else {
        command.to_string()
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("sh")
            .args(["-c", &expanded])
            .env("JACKDAW_SESSION_ID", session_id)
            .env("JACKDAW_EVENT", event_name)
            .env("JACKDAW_CWD", cwd)
            .env("JACKDAW_TITLE", title)
            .env("JACKDAW_BODY", body)
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) if !output.status.success() => {
            eprintln!(
                "notification command exited {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Ok(Err(e)) => eprintln!("notification command failed: {e}"),
        Err(_) => eprintln!("notification command timed out"),
        _ => {}
    }
}
```

In `server.rs`, inside the notification block after the desktop notification fires:

```rust
let notification_command = app_handle
    .store("settings.json")
    .ok()
    .and_then(|store| store.get("notification_command"))
    .and_then(|v| v.as_str().map(String::from))
    .unwrap_or_default();

if !notification_command.is_empty() {
    let cmd = notification_command;
    let sid = session_id.clone();
    let evt = event_name.clone();
    let cwd = cwd.clone();
    let t = title.to_string();
    let b = body.clone();
    tokio::spawn(async move {
        crate::notify::run_notification_command(&cmd, &sid, &evt, &cwd, &t, &b).await;
    });
}
```

The command spawns only when `should_notify()` is true AND `notification_content()` returns Some — same gate as the desktop notification. This keeps the two mechanisms in sync: if a user disables "Notify when session ends", the command won't fire for SessionEnd either.

## Backend Changes

- **notify.rs**: Add `run_notification_command()` async function.
- **server.rs**: Read `notification_command` from store, spawn if non-empty and notification fired.
- **Cargo.toml**: Add `dirs` crate for home directory resolution (if not already present).

## Frontend Changes

Add a text input to Settings.svelte under the notification toggles:

```svelte
<div class="command-row">
  <label class="command-label" for="notification-command">Run command on notification</label>
  <input
    id="notification-command"
    type="text"
    class="command-input"
    placeholder="e.g. ~/.config/jackdaw/on-notify.sh"
    bind:value={notificationCommand}
    onblur={saveCommand}
  />
</div>
```

- Load `notification_command` from store on mount.
- Save on blur (not on every keystroke).
- No validation — if the command is wrong, it fails silently in the backend logs.

## Testing

### Rust unit tests (`notify.rs`)

- `run_notification_command` with `echo` — verify it completes without error.
- Verify env vars are passed: command is `env | grep JACKDAW` piped to a temp file, assert contents.
- Timeout: command is `sleep 30`, verify it returns within ~10s.
- Non-zero exit: command is `exit 1`, verify no panic (just logs).
- Tilde expansion: `~/foo` expands to `$HOME/foo`.

### Frontend tests

- Settings loads and displays saved `notification_command`.
- Typing and blurring saves to store.
- Empty input clears the setting.
