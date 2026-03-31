# Quick Terminal Launch

Open an embedded shell terminal pre-cd'd to a session's working directory. One-click access to run tests, check logs, and run commands alongside an active Claude instance.

## Approach

The shell is a child of a session, not a standalone entity. Each session can have at most one shell terminal. A `shell_pty_id` field on `Session` tracks whether a shell is open. The frontend shows a tab toggle (Detail / Terminal) in the main area when a shell exists. Dismissing the session kills the shell. The shell uses the same `PtyManager` infrastructure as embedded Claude terminals.

## Backend Changes

### Data model

Add to `Session` in `state.rs`:

```rust
pub shell_pty_id: Option<String>,
```

Serialized as `shell_pty_id: string | null` in JSON. Not persisted to the database — shells are ephemeral and don't survive restart.

Initialize as `None` in `Session::new()`.

### Shell detection

```rust
fn detect_shell() -> (String, String) {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sh".to_string());
        (shell, name)
    }
    #[cfg(windows)]
    {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let name = "cmd".to_string();
        (shell, name)
    }
}
```

Returns `(path, display_name)` — e.g. `("/bin/zsh", "zsh")`.

### `open_session_shell` command

```rust
#[tauri::command]
async fn open_session_shell(
    session_id: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String>
```

1. Lock sessions, find session by `session_id`. Error if not found.
2. If `shell_pty_id` is already `Some(id)`, return that id (idempotent).
3. Read `cwd` from the session. Drop lock.
4. Generate a new UUID for the PTY id.
5. Detect shell via `detect_shell()`.
6. Spawn via `PtyManager::spawn()` with the shell path as program, empty args, cwd from session.
7. Lock sessions, set `session.shell_pty_id = Some(pty_id)`. Drop lock.
8. Emit `session-update`.
9. Spawn background thread to read PTY output, emitting `terminal-output` events with `session_id` set to the PTY id. On exit, emit `terminal-exited` and clear `shell_pty_id` on the session.
10. Return the PTY id.

### `close_session_shell` command

```rust
#[tauri::command]
async fn close_session_shell(
    session_id: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<(), String>
```

1. Lock sessions, find session. Read and clear `shell_pty_id`. Drop lock.
2. If a PTY id was present, call `pty_mgr.close()` on it.
3. Emit `session-update`.

### Dismiss cleanup

In `dismiss_session`, before removing the session from state, check `shell_pty_id`. If set, call `pty_mgr.close()` on it.

### Command registration

Add `open_session_shell` and `close_session_shell` to the `invoke_handler` list in `lib.rs`.

## Frontend Changes

### types.ts

Add to `Session`:

```typescript
shell_pty_id: string | null;
```

### SessionCard: terminal button

Add a terminal icon button to the header row, right side, before the chevron. Visible on card hover in both compact and expanded modes.

New prop:

```typescript
onOpenShell: (sessionId: string) => void;
```

Button uses `stopPropagation` to prevent triggering card expand.

### Dashboard: tab toggle

When a non-spawned session is selected in the main area, render a tab bar above the content with "Detail" and "Terminal" tabs.

- "Detail" shows the existing `<SessionCard>` detail view.
- "Terminal" renders a `<Terminal>` component. Only enabled when `session.shell_pty_id` is non-null.

Tab state stored as `Record<string, 'detail' | 'terminal'>` in Dashboard, keyed by session_id, defaulting to `'detail'`. Preserved when switching between sessions.

Clicking the terminal button on a SessionCard:
1. Calls `open_session_shell` (spawns shell if needed, no-op if already open).
2. Selects that session.
3. Sets that session's active tab to `'terminal'`.

### Dashboard: terminal rendering

Render shell terminal panes using the same visibility pattern as spawned terminals:

```svelte
{#each sessionStore.sessions as session (session.session_id)}
  {#if session.shell_pty_id}
    <div class="terminal-pane" class:active={selectedSessionId === session.session_id && tabState[session.session_id] === 'terminal'}>
      <Terminal ptyId={session.shell_pty_id} />
    </div>
  {/if}
{/each}
```

### Terminal.svelte

Rename the `sessionId` prop to `ptyId`. This is the identifier used for:
- Filtering `terminal-output` events (match `event.payload.session_id` against `ptyId`)
- Filtering `terminal-exited` events
- Calling `write_terminal` and `resize_terminal` commands

The existing spawned terminal usage in Dashboard passes `session.session_id` as `ptyId`, which is correct — `spawn_terminal` uses the session_id as the PTY key.

## Socket API

Add two action commands in `api.rs`:

**`open_session_shell`:**
```json
{"command": "open_session_shell", "session_id": "abc-123"}
```
Returns `{"ok": true, "pty_id": "def-456"}`.

**`close_session_shell`:**
```json
{"command": "close_session_shell", "session_id": "abc-123"}
```
Returns `{"ok": true}`.

## Testing

### Rust unit tests

- `open_session_shell` creates a PTY and sets `shell_pty_id` on the session.
- Calling `open_session_shell` twice on the same session returns the same PTY id.
- `close_session_shell` clears `shell_pty_id` and closes the PTY.
- `dismiss_session` cleans up shell PTY if present.
- `detect_shell()` returns a non-empty path and name.

### Frontend tests (Vitest)

- SessionCard renders terminal button, calls `onOpenShell` on click.
- Terminal button click does not propagate to card expand.
- Tab toggle renders Detail/Terminal tabs when session has `shell_pty_id`.
- Terminal tab disabled when `shell_pty_id` is null.
- Tab state preserved per session when switching between sessions.
