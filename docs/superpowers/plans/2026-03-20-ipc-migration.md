# IPC Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jackdaw's Axum HTTP server with Unix socket / Windows named pipe IPC and a `jackdaw-send` CLI binary.

**Architecture:** The Tauri daemon listens on a platform-native IPC socket. A thin CLI binary reads JSON from stdin and forwards it to the socket. Claude Code hooks switch from `http` to `command` type. Several files must change together since removing the port parameter touches state.rs, hooks.rs, lib.rs, tray.rs, and server.rs simultaneously.

**Tech Stack:** `interprocess` crate (cross-platform local sockets), `tokio` (async IO), `serde_json` (NDJSON protocol)

---

### Task 1: Add `interprocess` dependency and create `ipc.rs`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod ipc;` declaration)

- [ ] **Step 1: Add interprocess to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
interprocess = { version = "2", features = ["tokio"] }
```

- [ ] **Step 2: Create `src-tauri/src/ipc.rs`**

```rust
use std::path::PathBuf;

/// Returns the platform-specific IPC socket/pipe name.
///
/// - Linux/macOS: `~/.jackdaw/jackdaw.sock` (Unix domain socket)
/// - Windows: `jackdaw` (mapped to `\\.\pipe\jackdaw` by interprocess)
pub fn socket_path() -> String {
    if cfg!(windows) {
        "jackdaw".to_string()
    } else {
        let home = dirs::home_dir().expect("could not determine home directory");
        home.join(".jackdaw")
            .join("jackdaw.sock")
            .to_string_lossy()
            .into_owned()
    }
}

/// Returns the parent directory of the socket file (Unix only).
/// Creates it if it doesn't exist.
pub fn ensure_socket_dir() {
    if !cfg!(windows) {
        let home = dirs::home_dir().expect("could not determine home directory");
        let dir = home.join(".jackdaw");
        if !dir.exists() {
            std::fs::create_dir_all(&dir).expect("failed to create ~/.jackdaw/");
        }
    }
}

/// Remove stale socket file if it exists (Unix only).
pub fn remove_stale_socket() {
    if !cfg!(windows) {
        let home = dirs::home_dir().expect("could not determine home directory");
        let path = home.join(".jackdaw").join("jackdaw.sock");
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}
```

- [ ] **Step 3: Add `mod ipc;` to lib.rs**

Add `mod ipc;` alongside the existing module declarations at the top of `src-tauri/src/lib.rs` (after `mod hooks;`). Also make it `pub mod ipc;` so the binary can use it.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (axum still present, ipc module added but unused)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/ipc.rs src-tauri/src/lib.rs
git commit -m "feat: add interprocess dependency and ipc module"
```

---

### Task 2: Create `jackdaw-send` CLI binary

**Files:**
- Create: `src-tauri/src/bin/jackdaw-send.rs`
- Modify: `src-tauri/Cargo.toml` (add `[[bin]]` section)

- [ ] **Step 1: Add binary target to Cargo.toml**

Add to `src-tauri/Cargo.toml`:

```toml
[[bin]]
name = "jackdaw-send"
path = "src/bin/jackdaw-send.rs"
```

- [ ] **Step 2: Create the binary**

Create `src-tauri/src/bin/jackdaw-send.rs`:

```rust
use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, GenericNamespaced, ToFsName, ToNsName,
};
use std::io::{self, Read};
use tokio::io::AsyncWriteExt;

fn connect_name() -> io::Result<interprocess::local_socket::Name<'static>> {
    if cfg!(windows) {
        "jackdaw".to_ns_name::<GenericNamespaced>()
    } else {
        let home = dirs::home_dir().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "could not determine home directory")
        })?;
        let path = home.join(".jackdaw").join("jackdaw.sock");
        path.to_string_lossy().to_string().to_fs_name::<GenericFilePath>()
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut payload = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut payload) {
        eprintln!("jackdaw-send: failed to read stdin: {}", e);
        std::process::exit(1);
    }

    let payload = payload.trim().to_string();
    if payload.is_empty() {
        eprintln!("jackdaw-send: empty payload");
        std::process::exit(1);
    }

    let name = match connect_name() {
        Ok(n) => n,
        Err(e) => {
            eprintln!("jackdaw-send: invalid socket name: {}", e);
            std::process::exit(1);
        }
    };

    let mut stream = match interprocess::local_socket::tokio::Stream::connect(name).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("jackdaw-send: failed to connect (is Jackdaw running?): {}", e);
            std::process::exit(1);
        }
    };

    let message = format!("{}\n", payload);
    if let Err(e) = stream.write_all(message.as_bytes()).await {
        eprintln!("jackdaw-send: failed to send: {}", e);
        std::process::exit(1);
    }
}
```

- [ ] **Step 3: Verify binary compiles**

Run: `cd src-tauri && cargo build --bin jackdaw-send`
Expected: compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/bin/jackdaw-send.rs
git commit -m "feat: add jackdaw-send CLI binary"
```

---

### Task 3: Swap transport — rewrite server, hooks, state, lib, tray

This is the core migration task. Multiple files must change together since they share the `port` parameter. The project will not compile between sub-steps — commit only at the end.

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/server.rs`
- Modify: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/Cargo.toml` (remove axum)

- [ ] **Step 1: Remove port from `state.rs`**

Replace the `AppState` struct and impl (lines 44-57):

```rust
/// Shared app state wrapped in Mutex for thread safety
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}
```

- [ ] **Step 2: Rewrite `server.rs` with IPC listener**

Replace the entire contents of `src-tauri/src/server.rs`:

```rust
use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, GenericNamespaced, ListenerOptions, ToFsName, ToNsName,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncBufReadExt;

use crate::state::{extract_summary, AppState, HookPayload, Session, ToolEvent};
use chrono::Utc;

pub async fn start_server(app_handle: AppHandle, state: Arc<AppState>) {
    crate::ipc::ensure_socket_dir();
    crate::ipc::remove_stale_socket();

    let name = if cfg!(windows) {
        "jackdaw".to_ns_name::<GenericNamespaced>()
    } else {
        crate::ipc::socket_path().to_fs_name::<GenericFilePath>()
    };

    let name = match name {
        Ok(n) => n,
        Err(e) => {
            eprintln!("Jackdaw: invalid socket name: {}", e);
            return;
        }
    };

    let listener = match ListenerOptions::new().name(name).create_tokio() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Jackdaw: failed to bind IPC socket: {}", e);
            return;
        }
    };

    eprintln!("Jackdaw: listening on {}", crate::ipc::socket_path());

    loop {
        let stream = match listener.accept().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Jackdaw: accept error: {}", e);
                continue;
            }
        };

        let app = app_handle.clone();
        let state = state.clone();

        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stream);
            let mut lines = reader.lines();

            if let Ok(Some(line)) = lines.next_line().await {
                handle_event(&app, &state, &line);
            }
        });
    }
}

fn handle_event(app_handle: &AppHandle, state: &Arc<AppState>, line: &str) {
    let payload: HookPayload = match serde_json::from_str(line) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Jackdaw: invalid JSON payload: {}", e);
            return;
        }
    };

    let session_id = payload.session_id;
    let cwd = payload.cwd;
    let event_name = payload.hook_event_name;

    let mut sessions = state.sessions.lock().unwrap();

    if event_name != "SessionEnd" {
        sessions
            .entry(session_id.clone())
            .or_insert_with(|| Session::new(session_id.clone(), cwd.clone()));
    }

    match event_name.as_str() {
        "SessionStart" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.processing = true;
            }
        }
        "Stop" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.processing = false;
                session.pending_approval = false;
            }
        }
        "SessionEnd" => {
            sessions.remove(&session_id);
        }
        "PreToolUse" => {
            let tool_name = match payload.tool_name {
                Some(name) => name,
                None => {
                    eprintln!("Jackdaw: PreToolUse missing tool_name, dropping");
                    return;
                }
            };
            let summary = extract_summary(&tool_name, &payload.tool_input);
            let tool_event = ToolEvent {
                tool_name,
                timestamp: Utc::now(),
                summary,
                tool_use_id: payload.tool_use_id,
            };

            if let Some(session) = sessions.get_mut(&session_id) {
                session.pending_approval = false;
                session.processing = true;
                session.set_current_tool(tool_event);
            }
        }
        "PostToolUse" => {
            let tool_name = match payload.tool_name {
                Some(name) => name,
                None => {
                    eprintln!("Jackdaw: PostToolUse missing tool_name, dropping");
                    return;
                }
            };
            let summary = extract_summary(&tool_name, &payload.tool_input);
            let tool_event = ToolEvent {
                tool_name,
                timestamp: Utc::now(),
                summary,
                tool_use_id: payload.tool_use_id.clone(),
            };

            if let Some(session) = sessions.get_mut(&session_id) {
                session.pending_approval = false;
                session.complete_tool(payload.tool_use_id.as_deref(), tool_event);
            }
        }
        "UserPromptSubmit" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.pending_approval = false;
                session.processing = true;
            }
        }
        "Notification" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.pending_approval = true;
            }
        }
        "SubagentStart" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.active_subagents = session.active_subagents.saturating_add(1);
            }
        }
        "SubagentStop" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.active_subagents = session.active_subagents.saturating_sub(1);
            }
        }
        _ => {}
    }

    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app_handle.emit("session-update", &session_list);
    crate::tray::update_tray(app_handle, &session_list);
}
```

- [ ] **Step 3: Rewrite `hooks.rs`**

Replace the following functions. Keep `HookScope`, `HookStatus`, `HOOK_EVENTS`, `get_settings_path`, `read_settings`, `write_settings` unchanged.

Replace `jackdaw_hook_url` (lines 22-25) with:

```rust
/// Resolve the path to the jackdaw-send binary.
/// Uses the binary next to the current executable, or falls back to PATH.
pub fn jackdaw_send_command() -> String {
    // Try to find jackdaw-send next to the current executable
    if let Ok(exe) = std::env::current_exe() {
        let sibling = exe.parent().map(|p| p.join("jackdaw-send"));
        if let Some(path) = sibling {
            if path.exists() {
                return path.to_string_lossy().into_owned();
            }
        }
    }
    // Fall back to bare command name (must be on PATH)
    "jackdaw-send".to_string()
}
```

Replace `jackdaw_matcher_group` (lines 135-143) with:

```rust
/// Build the Jackdaw hook entry for a single event
fn jackdaw_matcher_group() -> Value {
    serde_json::json!({
        "hooks": [{
            "type": "command",
            "command": jackdaw_send_command(),
            "timeout": 5
        }]
    })
}
```

Replace `is_jackdaw_matcher_group` (lines 145-156) with:

```rust
/// Returns true if a matcher group contains a Jackdaw hook.
/// Detects both new command-type hooks (jackdaw-send) and old HTTP-type hooks (localhost:*/events).
fn is_jackdaw_matcher_group(mg: &Value) -> bool {
    mg.get("hooks")
        .and_then(|v| v.as_array())
        .map(|hooks| hooks.iter().any(|h| {
            let hook_type = h.get("type").and_then(|t| t.as_str());
            match hook_type {
                // New format: command type containing jackdaw-send
                Some("command") => {
                    h.get("command").and_then(|c| c.as_str())
                        .map(|cmd| cmd.contains("jackdaw-send"))
                        .unwrap_or(false)
                }
                // Old format: HTTP type with localhost:*/events URL
                Some("http") => {
                    h.get("url").and_then(|u| u.as_str())
                        .map(|url| url.contains("localhost") && url.ends_with("/events"))
                        .unwrap_or(false)
                }
                _ => false,
            }
        }))
        .unwrap_or(false)
}
```

Replace `check_status` (lines 77-132) with:

```rust
/// Check whether Jackdaw hooks are installed in the given settings
pub fn check_status(settings: &Value) -> HookStatus {
    let hooks = match settings.get("hooks") {
        Some(h) if h.is_object() => h,
        _ => return HookStatus::NotInstalled,
    };

    let expected_cmd = jackdaw_send_command();
    let mut found_count = 0;

    for event_name in HOOK_EVENTS {
        if let Some(event_array) = hooks.get(event_name).and_then(|v| v.as_array()) {
            let has_jackdaw_hook = event_array.iter().any(|matcher_group| {
                if let Some(hook_list) = matcher_group.get("hooks").and_then(|v| v.as_array()) {
                    hook_list.iter().any(|hook| {
                        hook.get("type").and_then(|t| t.as_str()) == Some("command")
                            && hook.get("command").and_then(|c| c.as_str())
                                .map(|cmd| cmd == expected_cmd)
                                .unwrap_or(false)
                    })
                } else {
                    false
                }
            });
            if has_jackdaw_hook {
                found_count += 1;
            }
        }
    }

    if found_count == HOOK_EVENTS.len() {
        HookStatus::Installed
    } else if found_count > 0 {
        HookStatus::Outdated
    } else {
        // Check for old-format hooks (HTTP localhost:*/events) or different jackdaw-send path
        let has_old_jackdaw = HOOK_EVENTS.iter().any(|event_name| {
            hooks.get(event_name)
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().any(|mg| is_jackdaw_matcher_group(mg)))
                .unwrap_or(false)
        });
        if has_old_jackdaw {
            HookStatus::Outdated
        } else {
            HookStatus::NotInstalled
        }
    }
}
```

Replace `install` signature and body (lines 160-188) — remove `port` parameter:

```rust
/// Install or update Jackdaw hooks in a settings Value.
/// Preserves all existing non-Jackdaw hooks.
pub fn install(settings: &mut Value) -> Result<(), String> {
    let settings_obj = settings
        .as_object_mut()
        .ok_or("Settings file root is not a JSON object")?;

    let hooks = settings_obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));

    let hooks_obj = hooks.as_object_mut()
        .ok_or("'hooks' field is not a JSON object")?;

    for event_name in HOOK_EVENTS {
        let event_array = hooks_obj
            .entry(*event_name)
            .or_insert_with(|| serde_json::json!([]));

        let arr = event_array.as_array_mut()
            .ok_or_else(|| format!("'{}' hook event is not an array", event_name))?;

        arr.retain(|mg| !is_jackdaw_matcher_group(mg));
        arr.push(jackdaw_matcher_group());
    }

    Ok(())
}
```

`uninstall` is unchanged (already doesn't take port).

- [ ] **Step 4: Update `lib.rs`**

Replace the entire contents of `src-tauri/src/lib.rs`:

```rust
mod hooks;
pub mod ipc;
mod server;
mod state;
mod tray;

use state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn dismiss_session(session_id: String, state: tauri::State<'_, Arc<AppState>>, app: AppHandle) {
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);
}

#[tauri::command]
fn check_hooks_status(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<hooks::HookStatus, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let settings = hooks::read_settings(&path)?;
    Ok(hooks::check_status(&settings))
}

#[tauri::command]
fn install_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::install(&mut settings)?;
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks installed to {}", path.display()))
}

#[tauri::command]
fn uninstall_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::uninstall(&mut settings);
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks removed from {}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .manage(app_state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(handle, state).await;
            });
            tray::create_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![dismiss_session, check_hooks_status, install_hooks, uninstall_hooks])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Update `tray.rs` — remove port usage**

Replace the `"install_hooks_user"` match arm (lines 46-70) with:

```rust
            "install_hooks_user" => {
                match crate::hooks::get_settings_path(&crate::hooks::HookScope::User, None) {
                    Ok(path) => {
                        match crate::hooks::read_settings(&path) {
                            Ok(mut settings) => {
                                if let Err(e) = crate::hooks::install(&mut settings) {
                                    eprintln!("Jackdaw: failed to install hooks: {}", e);
                                    return;
                                }
                                match crate::hooks::write_settings(&path, &settings) {
                                    Ok(_) => {
                                        if let Some(tray) = app.tray_by_id(TRAY_ID) {
                                            let _ = tray.set_tooltip(Some("Jackdaw — hooks installed"));
                                        }
                                    }
                                    Err(e) => eprintln!("Jackdaw: failed to install hooks: {}", e),
                                }
                            }
                            Err(e) => eprintln!("Jackdaw: failed to read settings: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Jackdaw: failed to resolve settings path: {}", e),
                }
            }
```

- [ ] **Step 6: Remove `axum` from Cargo.toml**

Remove this line from `[dependencies]`:
```toml
axum = "0.8"
```

- [ ] **Step 7: Verify everything compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 8: Commit**

```bash
git add src-tauri/
git commit -m "feat: replace HTTP server with IPC socket transport"
```

---

### Task 4: Update hooks.rs tests for command-type format

**Files:**
- Modify: `src-tauri/src/hooks.rs` (test module)

- [ ] **Step 1: Replace the entire `#[cfg(test)] mod tests` block**

Replace the test module in `src-tauri/src/hooks.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_jackdaw_matcher_group_command_type() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "/usr/bin/jackdaw-send", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_bare_command() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "jackdaw-send", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_old_http_format() {
        let mg = json!({
            "hooks": [{"type": "http", "url": "http://localhost:9876/events", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_non_jackdaw_command() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "other-tool"}]
        });
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_non_jackdaw_url() {
        let mg = json!({
            "hooks": [{"type": "http", "url": "http://example.com/webhook"}]
        });
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_missing_hooks_field() {
        let mg = json!({"matcher": "something"});
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_empty_hooks_array() {
        let mg = json!({"hooks": []});
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    fn full_installed_settings() -> Value {
        let cmd = jackdaw_send_command();
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop",
                       "SessionEnd", "UserPromptSubmit", "SubagentStart",
                       "SubagentStop", "Notification"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "command", "command": cmd, "timeout": 5}]
            }]));
        }
        json!({"hooks": hooks})
    }

    #[test]
    fn check_status_empty_settings() {
        let settings = json!({});
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_no_hooks_key() {
        let settings = json!({"other": "stuff"});
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_all_installed() {
        let settings = full_installed_settings();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
    }

    #[test]
    fn check_status_partial_install() {
        let cmd = jackdaw_send_command();
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "command", "command": cmd, "timeout": 5}]
            }]));
        }
        let settings = json!({"hooks": hooks});
        assert!(matches!(check_status(&settings), HookStatus::Outdated));
    }

    #[test]
    fn check_status_old_http_hooks_detected_as_outdated() {
        // Old HTTP format hooks should be detected as Outdated
        let url = "http://localhost:9876/events";
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop",
                       "SessionEnd", "UserPromptSubmit", "SubagentStart",
                       "SubagentStop", "Notification"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "http", "url": url, "timeout": 5}]
            }]));
        }
        let settings = json!({"hooks": hooks});
        assert!(matches!(check_status(&settings), HookStatus::Outdated));
    }

    #[test]
    fn install_empty_settings() {
        let mut settings = json!({});
        install(&mut settings).unwrap();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
    }

    #[test]
    fn install_preserves_non_jackdaw_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": {"tool_name": "Bash"},
                    "hooks": [{"type": "http", "url": "http://other-service.com/hook"}]
                }]
            }
        });
        install(&mut settings).unwrap();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 2);
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other-service.com/hook");
    }

    #[test]
    fn install_replaces_old_http_hooks() {
        // Start with old HTTP format, install should replace with command format
        let url = "http://localhost:9876/events";
        let mut hooks_map = serde_json::Map::new();
        for event in HOOK_EVENTS {
            hooks_map.insert(event.to_string(), json!([{
                "hooks": [{"type": "http", "url": url, "timeout": 5}]
            }]));
        }
        let mut settings = json!({"hooks": hooks_map});
        install(&mut settings).unwrap();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
        // Verify it's now command type, not http
        let arr = settings["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["type"], "command");
    }

    #[test]
    fn uninstall_removes_jackdaw_hooks() {
        let mut settings = json!({});
        install(&mut settings).unwrap();
        uninstall(&mut settings);
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
        assert!(settings.get("hooks").is_none());
    }

    #[test]
    fn uninstall_preserves_other_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"type": "http", "url": "http://other.com/hook"}]},
                    {"hooks": [{"type": "command", "command": "jackdaw-send", "timeout": 5}]}
                ]
            }
        });
        uninstall(&mut settings);
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other.com/hook");
    }

    #[test]
    fn uninstall_removes_old_http_hooks_too() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"type": "http", "url": "http://localhost:9876/events", "timeout": 5}]}
                ]
            }
        });
        uninstall(&mut settings);
        assert!(settings.get("hooks").is_none());
    }

    #[test]
    fn uninstall_noop_when_not_installed() {
        let mut settings = json!({"other": "data"});
        uninstall(&mut settings);
        assert_eq!(settings, json!({"other": "data"}));
    }

    #[test]
    fn read_settings_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"hooks":{}}"#).unwrap();
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({"hooks": {}}));
    }

    #[test]
    fn read_settings_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({}));
    }

    #[test]
    fn write_settings_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("dir").join("settings.json");
        let settings = json!({"hooks": {}});
        write_settings(&path, &settings).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        let parsed: Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, settings);
    }

    #[test]
    fn write_settings_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = json!({});
        install(&mut settings).unwrap();
        write_settings(&path, &settings).unwrap();
        let loaded = read_settings(&path).unwrap();
        assert!(matches!(check_status(&loaded), HookStatus::Installed));
    }

    #[test]
    fn write_settings_atomic_no_temp_file_left() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = json!({"test": true});
        write_settings(&path, &settings).unwrap();
        let temp_path = path.with_extension("json.tmp");
        assert!(!temp_path.exists());
        assert!(path.exists());
    }
}
```

- [ ] **Step 2: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hooks.rs
git commit -m "test: update hooks tests for command-type format"
```

---

### Task 5: IPC integration test

**Files:**
- Modify: `src-tauri/src/ipc.rs` (add configurable socket path for testing)
- Create or modify: `src-tauri/tests/ipc_integration.rs`

Note: A full integration test of `server.rs` requires a Tauri `AppHandle` which is hard to construct in tests. Instead, test the IPC round-trip at the transport level: start a listener on a temp socket, connect, send JSON, verify it's received correctly.

- [ ] **Step 1: Add a `socket_path_override` for testing**

Add to `src-tauri/src/ipc.rs`:

```rust
/// Build a socket path in a given directory (for testing).
pub fn socket_path_in(dir: &std::path::Path) -> String {
    dir.join("jackdaw.sock").to_string_lossy().into_owned()
}
```

- [ ] **Step 2: Create integration test**

Create `src-tauri/tests/ipc_integration.rs`:

```rust
use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, ListenerOptions, ToFsName,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::test]
async fn ipc_roundtrip_sends_and_receives_json() {
    let dir = tempfile::tempdir().unwrap();
    let sock_path = dir.path().join("test.sock");
    let sock_str = sock_path.to_string_lossy().to_string();

    let name = sock_str.clone().to_fs_name::<GenericFilePath>().unwrap();
    let listener = ListenerOptions::new().name(name).create_tokio().unwrap();

    let sock_str_clone = sock_str.clone();
    let sender = tokio::spawn(async move {
        let name = sock_str_clone.to_fs_name::<GenericFilePath>().unwrap();
        let mut stream = interprocess::local_socket::tokio::Stream::connect(name).await.unwrap();
        let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        stream.write_all(format!("{}\n", payload).as_bytes()).await.unwrap();
    });

    let (stream, _) = listener.accept().await.unwrap();
    let reader = BufReader::new(stream);
    let mut lines = reader.lines();
    let line = lines.next_line().await.unwrap().unwrap();

    sender.await.unwrap();

    let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(parsed["session_id"], "s1");
    assert_eq!(parsed["hook_event_name"], "SessionStart");
}
```

- [ ] **Step 3: Run integration test**

Run: `cd src-tauri && cargo test --test ipc_integration`
Expected: passes

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/tests/ipc_integration.rs
git commit -m "test: add IPC transport integration test"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture section**

Replace the architecture diagram:

```
Claude Code hooks (command type) → runs `jackdaw-send`
  → jackdaw-send reads stdin, connects to IPC socket, writes JSON + newline
  → Daemon reads from socket, updates AppState (state.rs, Arc<Mutex<HashMap>>)
  → Tauri "session-update" event emitted → Svelte frontend re-renders
  → Tray icon updated (tray.rs: green=running, yellow=waiting, gray=idle)
```

Update `server.rs` description to mention IPC instead of Axum/HTTP/port 9876.

Update `hooks.rs` description to mention `command` type instead of `http` type.

Add `ipc.rs` to the backend file list: "**ipc.rs** — Platform-specific IPC socket path resolution (Unix socket on Linux/macOS, named pipe on Windows)."

Remove "Port 9876 is hardcoded" from Key patterns.

Add to Key patterns: "**IPC socket at `~/.jackdaw/jackdaw.sock`** (Unix) or `\\.\pipe\jackdaw` (Windows). Stale socket removed on startup."

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for IPC migration"
```
