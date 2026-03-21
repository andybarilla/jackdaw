# IPC Migration: HTTP Server to Unix Socket / Named Pipe

## Goal

Replace Jackdaw's Axum HTTP server with a platform-native IPC listener (Unix domain socket on Linux/macOS, named pipe on Windows) and a thin CLI binary (`jackdaw-send`) that acts as the client. Claude Code hooks switch from `http` type to `command` type, invoking `jackdaw-send` which reads the payload from stdin and forwards it to the daemon over IPC.

## Motivation

- Simpler architecture — no HTTP server, no port allocation, no port conflicts
- CLI-based interface is easier for other tools to integrate with
- Platform-native IPC is faster and avoids network stack overhead

## Architecture

```
Claude Code hook (command type)
    -> runs `jackdaw-send`
    -> stdin: JSON payload
    -> jackdaw-send connects to socket/pipe, writes JSON + newline, exits
    -> Daemon (Tauri app) reads from socket, updates AppState, emits Tauri events
    -> Frontend re-renders, tray icon updates
```

Other tools can call `jackdaw-send` directly or connect to the socket themselves.

## IPC Transport

- **Linux/macOS**: Unix domain socket at `~/.jackdaw/jackdaw.sock`
- **Windows**: Named pipe at `\\.\pipe\jackdaw`
- **Crate**: `interprocess` — provides cross-platform abstraction over both

## Protocol

Newline-delimited JSON (NDJSON). Each connection:
1. Client connects
2. Client writes one JSON object + `\n`
3. Daemon reads the line, processes it, closes connection

Stateless per-connection (same model as current HTTP POST). The `HookPayload` JSON format is unchanged.

## CLI Binary: `jackdaw-send`

New binary target: `src-tauri/src/bin/jackdaw-send.rs`

Behavior:
1. Read stdin to EOF
2. Connect to the IPC socket/pipe
3. Write payload + `\n`
4. Exit 0 on success, exit 1 on connection failure (daemon not running)

The binary must be on `$PATH` or referenced by absolute path in hook config. The hook installer writes the full path to the binary (derived from the Tauri app's bundle location or build output).

## Hook Format Change

Old (HTTP):
```json
{
  "type": "http",
  "url": "http://localhost:9876/events",
  "timeout": 5
}
```

New (command):
```json
{
  "type": "command",
  "command": "/path/to/jackdaw-send",
  "timeout": 5
}
```

## Changes by File

### Removed
- `axum` dependency from `Cargo.toml`
- HTTP server logic from `server.rs`
- `port` field from `AppState`

### New
- `interprocess` dependency in `Cargo.toml`
- `src-tauri/src/bin/jackdaw-send.rs` — CLI binary
- Socket/pipe path resolution: `socket_path()` function returning platform-specific path

### Modified

**`server.rs`** — Replace Axum HTTP listener with IPC listener:
- `start_server(app_handle)` spawns a tokio task that:
  - Creates parent dir for socket if needed
  - Removes stale socket file on startup (Unix only)
  - Attempts to bind the IPC listener; logs and returns on bind failure (e.g., another instance already running)
  - Accepts connections in a loop
  - Reads one NDJSON line per connection
  - Deserializes as `HookPayload`
  - Runs same state mutation + event emission logic as today
  - Malformed payloads (e.g., missing `tool_name` on `PreToolUse`): log warning via `eprintln!` and drop the message (no HTTP status codes to return over IPC)

**`hooks.rs`** — Switch to `command` type hooks:
- `jackdaw_hook_url()` removed, replaced with `jackdaw_send_path()` returning path to CLI binary
- `jackdaw_matcher_group()` produces `{"type": "command", "command": "<path>", "timeout": 5}`
- `is_jackdaw_matcher_group()` detects by `type == "command"` and command containing `jackdaw-send`
- `is_jackdaw_matcher_group()` also detects old HTTP-style hooks (`type == "http"` with `localhost:*/events` URL) so that `check_status` returns `Outdated` for existing users with old hooks — prompting them to re-install
- `check_status()` / `install()` / `uninstall()` use new detection logic; `install()` and `uninstall()` no longer take a `port` parameter
- `HookScope` and file read/write logic unchanged

**`state.rs`** — Remove `port` from `AppState`:
- `AppState::new()` takes no arguments (or just has `sessions` mutex)
- Remove `port` field

**`lib.rs`** — Spawn IPC listener instead of HTTP server:
- Remove `9876` literal from `AppState::new()` call
- `start_server()` called with just the app handle
- Tauri commands `install_hooks` / `check_hooks_status`: remove `state: tauri::State<'_, Arc<AppState>>` parameter entirely (it was only used for `state.port`) and remove port pass-through to hooks functions

**`tray.rs`** — Tray menu hook install adapted:
- Remove `let state = app.state::<...>()` and `let port = state.port` block (dead code after port removal)
- Calls updated `hooks::install()` without port parameter

### Unchanged
- Frontend (`src/`) — no changes at all
- `HookPayload` struct fields
- Session state management (`Session` methods, `extract_summary`)
- `compute_tray_state` and tray icon logic
- Tauri event emission pattern

## Testing

### Existing tests updated
- `hooks.rs` tests: update JSON assertions from `http`/`url` to `command`/`command`
- `state.rs` tests: remove port from `AppState::new()` calls if any

### New tests
- `server.rs`: integration test connecting to IPC socket, sending JSON, verifying state update (using `tempdir` for socket path)
- `jackdaw-send`: test that it writes stdin to socket correctly
- `hooks.rs`: new detection tests for `command` type matcher groups

## Out of Scope
- Multi-message streaming over a single connection (one message per connection is sufficient)
- Authentication on the socket (local-only, same trust model as current localhost HTTP)
- Graceful migration from HTTP to IPC for existing users (they re-run install hooks)
