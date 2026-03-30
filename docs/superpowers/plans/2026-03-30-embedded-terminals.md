# Embedded Terminal Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch Claude Code sessions from within Jackdaw with embedded xterm.js terminals, while continuing to monitor external sessions via hooks.

**Architecture:** Jackdaw becomes both a monitor and a launcher. Spawned sessions run `claude` in a PTY via `portable-pty`, with terminal output streamed to xterm.js through Tauri events. The spawned Claude Code process also sends hook events through the normal `jackdaw send` path, linked to the PTY session via a `JACKDAW_SPAWNED_SESSION` env var. The app switches from a narrow tray popup to a full window with sidebar (session list) + main area (terminal or card detail).

**Tech Stack:** Rust (portable-pty, uuid, base64), xterm.js (@xterm/xterm, @xterm/addon-fit), Tauri v2, Svelte 5

---

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add portable-pty, uuid, and base64 crates**

```toml
portable-pty = "0.8"
uuid = { version = "1", features = ["v4"] }
base64 = "0.22"
```

Add these three lines to the `[dependencies]` section of `src-tauri/Cargo.toml`, after the existing `interprocess` line.

- [ ] **Step 2: Remove jackdaw-send binary entry**

Remove the `[[bin]]` section at the bottom of `src-tauri/Cargo.toml`:

```toml
[[bin]]
name = "jackdaw-send"
path = "src/bin/jackdaw-send.rs"
```

- [ ] **Step 3: Delete the jackdaw-send binary source**

```bash
rm src-tauri/src/bin/jackdaw-send.rs
```

If `src-tauri/src/bin/` is now empty, remove that directory too:

```bash
rmdir src-tauri/src/bin/
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles with no errors (warnings about unused imports from new crates are fine).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml
git rm src-tauri/src/bin/jackdaw-send.rs
git commit -m "chore: add pty/uuid/base64 deps, remove jackdaw-send binary"
```

---

### Task 2: Add `SessionSource` to State

**Files:**
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/state.rs` (inline `#[cfg(test)]` module)

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/state.rs`:

```rust
#[test]
fn session_source_defaults_to_external() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert_eq!(s.source, SessionSource::External);
}

#[test]
fn session_source_serializes_as_lowercase() {
    let json = serde_json::to_value(SessionSource::Spawned).unwrap();
    assert_eq!(json, serde_json::json!("spawned"));
    let json = serde_json::to_value(SessionSource::External).unwrap();
    assert_eq!(json, serde_json::json!("external"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test session_source
```

Expected: compilation error — `SessionSource` doesn't exist yet.

- [ ] **Step 3: Implement SessionSource enum and add field to Session**

Add this enum above the `Session` struct in `src-tauri/src/state.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionSource {
    External,
    Spawned,
}
```

Add the `source` field to the `Session` struct:

```rust
pub source: SessionSource,
```

Update `Session::new()` to set `source: SessionSource::External`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add SessionSource enum (external vs spawned)"
```

---

### Task 3: Add `spawned_session` Field to HookPayload

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/server.rs`

This field is how a spawned Claude Code process tells the daemon "link me to PTY session X."

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/state.rs`:

```rust
#[test]
fn hook_payload_deserializes_spawned_session() {
    let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart","spawned_session":"pty-123"}"#;
    let payload: HookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.spawned_session, Some("pty-123".into()));
}

#[test]
fn hook_payload_spawned_session_defaults_to_none() {
    let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
    let payload: HookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.spawned_session, None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test hook_payload_
```

Expected: compilation error — `spawned_session` field doesn't exist.

- [ ] **Step 3: Add field to HookPayload**

Add to the `HookPayload` struct in `src-tauri/src/state.rs`:

```rust
#[serde(default)]
pub spawned_session: Option<String>,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add spawned_session field to HookPayload"
```

---

### Task 4: Link Spawned Sessions in server.rs

**Files:**
- Modify: `src-tauri/src/server.rs`

When a `SessionStart` event arrives with `spawned_session` set, instead of creating a new session entry, update the existing spawned session entry (which was pre-created by `spawn_terminal`). This links Claude Code's `session_id` with the PTY's `session_id`.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/server.rs`:

```rust
#[test]
fn spawned_session_linking_merges_into_existing() {
    use crate::state::{AppState, Session, SessionSource};

    let conn = db::init_memory();
    let state = std::sync::Arc::new(AppState::new(conn));

    // Pre-create a spawned session (as spawn_terminal would)
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new("pty-123".into(), "/home/test/project".into());
        session.source = SessionSource::Spawned;
        sessions.insert("pty-123".into(), session);
    }

    // Simulate a SessionStart hook event with spawned_session field
    {
        let mut sessions = state.sessions.lock().unwrap();
        let spawned_id = "pty-123";
        let claude_session_id = "claude-abc";

        // This is what server.rs should do: find the spawned session and re-key it
        if let Some(mut session) = sessions.remove(spawned_id) {
            session.session_id = claude_session_id.to_string();
            session.processing = true;
            sessions.insert(claude_session_id.to_string(), session);
        }

        let session = sessions.get(claude_session_id).unwrap();
        assert_eq!(session.source, SessionSource::Spawned);
        assert!(session.processing);
        assert!(!sessions.contains_key(spawned_id));
    }
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd src-tauri && cargo test spawned_session_linking
```

Expected: PASS (this test validates the linking logic in isolation).

- [ ] **Step 3: Modify handle_event to link spawned sessions**

In `src-tauri/src/server.rs`, inside `handle_event()`, after deserializing the payload and before the main event processing block, add the spawned session linking logic. Right after `let cwd = payload.cwd;` and `let event_name = payload.hook_event_name;`, add:

```rust
let spawned_session = payload.spawned_session;
```

Then in the block where sessions are created (around the `if event_name != "SessionEnd" && !sessions.contains_key(&session_id)` check), add a branch: if `spawned_session` is `Some(pty_id)` and the sessions map contains `pty_id`, remove the pty_id entry, update its `session_id` to `session_id`, and re-insert under the new key. This re-keying makes all subsequent hook events match the session created by `spawn_terminal`.

Specifically, replace the session-creation block with:

```rust
if event_name != "SessionEnd" && !sessions.contains_key(&session_id) {
    if let Some(pty_id) = &spawned_session {
        // Link: re-key the pre-created spawned session under Claude's session_id
        if let Some(mut session) = sessions.remove(pty_id.as_str()) {
            session.session_id = session_id.clone();
            sessions.insert(session_id.clone(), session);
        }
    }

    // If still not present (external session or linking failed), create new
    if !sessions.contains_key(&session_id) {
        drop(sessions);
        let db = state.db.lock().unwrap();
        let history = crate::db::load_tool_events_for_session(&db, &session_id);
        let git_branch = crate::db::load_session_git_branch(&db, &session_id);
        drop(db);
        sessions = state.sessions.lock().unwrap();
        if !sessions.contains_key(&session_id) {
            let mut session = Session::new(session_id.clone(), cwd.clone());
            session.hydrate_from_history(&history);
            session.git_branch = git_branch;
            sessions.insert(session_id.clone(), session);
        }
    }
}
```

- [ ] **Step 4: Run all tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: link spawned PTY sessions to Claude hook events"
```

---

### Task 5: Update send.rs to Include JACKDAW_SPAWNED_SESSION

**Files:**
- Modify: `src-tauri/src/send.rs`

When `jackdaw send` is invoked, if the `JACKDAW_SPAWNED_SESSION` env var is set, inject it into the JSON payload before sending. This is how the spawned Claude Code process communicates its PTY session ID.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/send.rs`:

```rust
#[test]
fn inject_spawned_session_adds_field() {
    let mut payload: serde_json::Value = serde_json::from_str(
        r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#
    ).unwrap();
    inject_spawned_session(&mut payload, Some("pty-123"));
    assert_eq!(payload["spawned_session"], "pty-123");
}

#[test]
fn inject_spawned_session_noop_when_none() {
    let mut payload: serde_json::Value = serde_json::from_str(
        r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#
    ).unwrap();
    inject_spawned_session(&mut payload, None);
    assert!(payload.get("spawned_session").is_none());
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test inject_spawned
```

Expected: compilation error — `inject_spawned_session` doesn't exist.

- [ ] **Step 3: Implement inject_spawned_session and wire it into run()**

Add this function in `src-tauri/src/send.rs`:

```rust
fn inject_spawned_session(payload: &mut serde_json::Value, spawned_id: Option<&str>) {
    if let (Some(obj), Some(id)) = (payload.as_object_mut(), spawned_id) {
        obj.insert("spawned_session".to_string(), serde_json::Value::String(id.to_string()));
    }
}
```

In the `run()` function, after `let payload = payload.trim().to_string();`, add:

```rust
// If launched by Jackdaw, inject the PTY session ID into the payload
let payload = match std::env::var("JACKDAW_SPAWNED_SESSION").ok() {
    Some(pty_id) => {
        match serde_json::from_str::<serde_json::Value>(&payload) {
            Ok(mut v) => {
                inject_spawned_session(&mut v, Some(&pty_id));
                serde_json::to_string(&v).unwrap_or(payload)
            }
            Err(_) => payload,
        }
    }
    None => payload,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/send.rs
git commit -m "feat: inject JACKDAW_SPAWNED_SESSION env var into hook payloads"
```

---

### Task 6: Create PTY Manager Module

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod pty;`)

This module manages PTY instances: spawning, writing, resizing, and closing.

- [ ] **Step 1: Write the tests**

Create `src-tauri/src/pty.rs` with the test module first:

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyManager {
    instances: Mutex<HashMap<String, PtyInstance>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_manager_new_is_empty() {
        let mgr = PtyManager::new();
        let instances = mgr.instances.lock().unwrap();
        assert!(instances.is_empty());
    }

    #[test]
    fn spawn_creates_instance() {
        let mgr = PtyManager::new();
        // Spawn a simple echo command instead of claude
        let (id, reader) = mgr.spawn("/tmp", 80, 24, "echo", &["hello"], &[]).unwrap();
        assert!(!id.is_empty());
        assert!(mgr.instances.lock().unwrap().contains_key(&id));
        drop(reader);
    }

    #[test]
    fn write_sends_data_to_pty() {
        let mgr = PtyManager::new();
        let (id, _reader) = mgr.spawn("/tmp", 80, 24, "cat", &[], &[]).unwrap();
        let result = mgr.write(&id, b"test\n");
        assert!(result.is_ok());
        // Close to let cat exit
        mgr.close(&id);
    }

    #[test]
    fn write_to_unknown_id_errors() {
        let mgr = PtyManager::new();
        let result = mgr.write("nonexistent", b"data");
        assert!(result.is_err());
    }

    #[test]
    fn resize_updates_pty_size() {
        let mgr = PtyManager::new();
        let (id, _reader) = mgr.spawn("/tmp", 80, 24, "cat", &[], &[]).unwrap();
        let result = mgr.resize(&id, 120, 40);
        assert!(result.is_ok());
        mgr.close(&id);
    }

    #[test]
    fn close_removes_instance() {
        let mgr = PtyManager::new();
        let (id, _reader) = mgr.spawn("/tmp", 80, 24, "echo", &["hi"], &[]).unwrap();
        mgr.close(&id);
        assert!(!mgr.instances.lock().unwrap().contains_key(&id));
    }

    #[test]
    fn close_unknown_id_is_noop() {
        let mgr = PtyManager::new();
        mgr.close("nonexistent"); // should not panic
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Add `pub mod pty;` to `src-tauri/src/lib.rs` (at the top with other module declarations), then:

```bash
cd src-tauri && cargo test pty
```

Expected: compilation error — methods not implemented yet.

- [ ] **Step 3: Implement PtyManager**

Replace the struct definitions and add implementations in `src-tauri/src/pty.rs`:

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyManager {
    instances: Mutex<HashMap<String, PtyInstance>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a command in a new PTY. Returns (session_id, reader).
    /// The reader provides raw PTY output — caller should consume it on a background thread.
    /// `env` is a slice of (key, value) pairs to set on the child process.
    pub fn spawn(
        &self,
        cwd: &str,
        cols: u16,
        rows: u16,
        program: &str,
        args: &[&str],
        env: &[(&str, &str)],
    ) -> Result<(String, Box<dyn Read + Send>), String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);
        for (k, v) in env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn command: {}", e))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take PTY writer: {}", e))?;

        let id = uuid::Uuid::new_v4().to_string();

        let instance = PtyInstance {
            writer,
            master: pair.master,
            child,
        };

        self.instances.lock().unwrap().insert(id.clone(), instance);

        Ok((id, reader))
    }

    /// Write raw bytes to a PTY's stdin.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut instances = self.instances.lock().unwrap();
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        instance
            .writer
            .write_all(data)
            .map_err(|e| format!("failed to write to PTY: {}", e))?;
        instance
            .writer
            .flush()
            .map_err(|e| format!("failed to flush PTY: {}", e))?;
        Ok(())
    }

    /// Resize a PTY.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let instances = self.instances.lock().unwrap();
        let instance = instances
            .get(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to resize PTY: {}", e))?;
        Ok(())
    }

    /// Close a PTY and kill its child process.
    pub fn close(&self, id: &str) {
        let mut instances = self.instances.lock().unwrap();
        if let Some(mut instance) = instances.remove(id) {
            let _ = instance.child.kill();
        }
    }

    /// Check if a child process has exited. Returns Some(exit_code) or None if still running.
    pub fn try_wait(&self, id: &str) -> Result<Option<u32>, String> {
        let mut instances = self.instances.lock().unwrap();
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        match instance.child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(format!("failed to check PTY status: {}", e)),
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test pty
```

Expected: all 7 PTY tests pass.

- [ ] **Step 5: Run full test suite**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat: add PtyManager for spawning/managing PTY instances"
```

---

### Task 7: Add DB Query for Recent Working Directories

**Files:**
- Modify: `src-tauri/src/db.rs`

The "New Session" button needs a list of recent cwds.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db.rs`:

```rust
#[test]
fn load_recent_cwds_returns_distinct_paths() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/project-a", "2026-03-21T00:00:00Z");
    end_session(&conn, "s1", "2026-03-21T01:00:00Z");
    save_session(&conn, "s2", "/home/user/project-b", "2026-03-21T02:00:00Z");
    end_session(&conn, "s2", "2026-03-21T03:00:00Z");
    save_session(&conn, "s3", "/home/user/project-a", "2026-03-21T04:00:00Z");
    end_session(&conn, "s3", "2026-03-21T05:00:00Z");

    let cwds = load_recent_cwds(&conn, 10);
    assert_eq!(cwds.len(), 2);
    // Most recent first — project-a was used most recently (s3)
    assert_eq!(cwds[0], "/home/user/project-a");
    assert_eq!(cwds[1], "/home/user/project-b");
}

#[test]
fn load_recent_cwds_respects_limit() {
    let conn = init_memory();
    for i in 0..5 {
        let id = format!("s{}", i);
        let cwd = format!("/home/user/project-{}", i);
        save_session(&conn, &id, &cwd, &format!("2026-03-21T0{}:00:00Z", i));
        end_session(&conn, &id, &format!("2026-03-21T0{}:30:00Z", i));
    }
    let cwds = load_recent_cwds(&conn, 3);
    assert_eq!(cwds.len(), 3);
}

#[test]
fn load_recent_cwds_includes_active_sessions() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/active-project", "2026-03-21T00:00:00Z");
    // Not ended — still active
    let cwds = load_recent_cwds(&conn, 10);
    assert_eq!(cwds.len(), 1);
    assert_eq!(cwds[0], "/home/user/active-project");
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test load_recent_cwds
```

Expected: compilation error — `load_recent_cwds` doesn't exist.

- [ ] **Step 3: Implement load_recent_cwds**

Add to `src-tauri/src/db.rs`:

```rust
pub fn load_recent_cwds(conn: &Connection, limit: u32) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT cwd FROM sessions
             GROUP BY cwd
             ORDER BY MAX(started_at) DESC
             LIMIT ?1",
        )
        .unwrap();

    stmt.query_map(rusqlite::params![limit], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add load_recent_cwds query for new session UI"
```

---

### Task 8: Add Tauri Commands for Terminal Management

**Files:**
- Modify: `src-tauri/src/lib.rs`

Four new commands: `spawn_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`, plus `get_recent_cwds`.

- [ ] **Step 1: Add PtyManager to managed state**

In `src-tauri/src/lib.rs`, in the `run()` function, after `let app_state = Arc::new(AppState::new(db_conn));`, add:

```rust
let pty_manager = Arc::new(pty::PtyManager::new());
```

Add `.manage(pty_manager)` to the Tauri builder chain, after `.manage(app_state.clone())`.

- [ ] **Step 2: Add the spawn_terminal command**

Add to `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn spawn_terminal(
    cwd: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
    use base64::Engine;
    use crate::state::{Session, SessionSource};

    let pty_mgr_inner = pty_mgr.inner().clone();

    // Spawn in a blocking thread since portable-pty is sync
    let (session_id, reader) = tokio::task::spawn_blocking(move || {
        pty_mgr_inner.spawn(
            &cwd,
            80,
            24,
            "claude",
            &[],
            &[("JACKDAW_SPAWNED_SESSION", "")], // placeholder, set below
        )
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))??;

    // Re-spawn with the correct env var now that we have the session_id
    // Actually, we need to close the first one and respawn. Better approach:
    // spawn with a two-step: generate ID first, then spawn with it.
    // Let's restructure: the PtyManager.spawn should accept an optional pre-generated ID.

    // Simpler: close what we just spawned and re-do with correct env
    pty_mgr.close(&session_id);

    let session_id_for_env = uuid::Uuid::new_v4().to_string();
    let sid_clone = session_id_for_env.clone();
    let cwd_clone = cwd.clone();
    let pty_mgr_inner = pty_mgr.inner().clone();

    // Pre-create the session in AppState so it appears in the UI immediately
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new(sid_clone.clone(), cwd.clone());
        session.source = SessionSource::Spawned;
        sessions.insert(sid_clone.clone(), session);
    }

    // Emit initial session list so frontend sees the new session
    {
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let _ = app.emit("session-update", &session_list);
        crate::tray::update_tray(&app, &session_list);
    }

    // This is awkward. Let's fix the approach.
    // We should generate the ID first, then pass it to spawn.
    // Revising: PtyManager.spawn doesn't generate IDs — caller does.
    todo!("See revised Task 6 approach below")
}
```

**Wait** — the above reveals a design issue. The `PtyManager::spawn` generates the UUID internally, but we need the UUID *before* spawning so we can pass it as the `JACKDAW_SPAWNED_SESSION` env var. Let me revise.

**Revised approach:** `PtyManager::spawn` should accept an `id: String` parameter instead of generating one internally. This way the caller generates the UUID, sets it as the env var, and passes it to spawn.

Go back to Task 6 and change `PtyManager::spawn` signature:

```rust
pub fn spawn(
    &self,
    id: String,
    cwd: &str,
    cols: u16,
    rows: u16,
    program: &str,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<Box<dyn Read + Send>, String> {
```

Remove the `let id = uuid::Uuid::new_v4().to_string();` line from spawn, use the passed-in `id` directly. Return just the reader (not the tuple). Update all Task 6 tests to pass an ID string.

Now the spawn_terminal command becomes clean:

```rust
#[tauri::command]
async fn spawn_terminal(
    cwd: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
    use base64::Engine;
    use crate::state::{Session, SessionSource};

    let session_id = uuid::Uuid::new_v4().to_string();
    let sid = session_id.clone();

    // Pre-create the session so it appears in the UI immediately
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new(sid.clone(), cwd.clone());
        session.source = SessionSource::Spawned;
        sessions.insert(sid.clone(), session);
    }

    // Emit updated session list
    {
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let _ = app.emit("session-update", &session_list);
        crate::tray::update_tray(&app, &session_list);
    }

    let pty_mgr_inner = pty_mgr.inner().clone();
    let cwd_clone = cwd.clone();
    let sid_for_spawn = sid.clone();

    let reader = tokio::task::spawn_blocking(move || {
        pty_mgr_inner.spawn(
            sid_for_spawn,
            &cwd_clone,
            80,
            24,
            "claude",
            &[],
            &[("JACKDAW_SPAWNED_SESSION", &sid)],
        )
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))??;

    // Spawn background thread to read PTY output and emit events
    let app_clone = app.clone();
    let sid_for_reader = session_id.clone();
    let pty_mgr_for_exit = pty_mgr.inner().clone();
    let state_for_exit = state.inner().clone();

    std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let engine = base64::engine::general_purpose::STANDARD;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let encoded = engine.encode(&buf[..n]);
                    let _ = app_clone.emit("terminal-output", serde_json::json!({
                        "session_id": sid_for_reader,
                        "data": encoded,
                    }));
                }
                Err(_) => break,
            }
        }

        // Child exited — check exit code
        let exit_code = pty_mgr_for_exit
            .try_wait(&sid_for_reader)
            .ok()
            .flatten();

        let _ = app_clone.emit("terminal-exited", serde_json::json!({
            "session_id": sid_for_reader,
            "exit_code": exit_code,
        }));
    });

    Ok(session_id)
}
```

- [ ] **Step 3: Add write_terminal, resize_terminal, close_terminal commands**

```rust
#[tauri::command]
fn write_terminal(
    session_id: String,
    data: String,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("invalid base64: {}", e))?;
    pty_mgr.write(&session_id, &bytes)
}

#[tauri::command]
fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<(), String> {
    pty_mgr.resize(&session_id, cols, rows)
}

#[tauri::command]
fn close_terminal(
    session_id: String,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    pty_mgr.close(&session_id);

    // Remove from session state
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    Ok(())
}
```

- [ ] **Step 4: Add get_recent_cwds command**

```rust
#[tauri::command]
fn get_recent_cwds(state: tauri::State<'_, Arc<AppState>>) -> Vec<String> {
    let db = state.db.lock().unwrap();
    db::load_recent_cwds(&db, 20)
}
```

- [ ] **Step 5: Register all new commands in invoke_handler**

Add to the `tauri::generate_handler![]` macro:

```rust
spawn_terminal,
write_terminal,
resize_terminal,
close_terminal,
get_recent_cwds,
```

- [ ] **Step 6: Update dismiss_session to also close PTY**

In the existing `dismiss_session` command, after removing from sessions, add:

```rust
pty_mgr.close(&session_id);
```

This requires adding `pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>` to the `dismiss_session` function signature.

- [ ] **Step 7: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles with no errors.

- [ ] **Step 8: Run all tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for terminal spawn/write/resize/close"
```

---

### Task 9: Update Window Configuration for Full App

**Files:**
- Modify: `src-tauri/tauri.conf.json`

Change from narrow tray popup to a full-sized window.

- [ ] **Step 1: Update window config**

In `src-tauri/tauri.conf.json`, change the window settings:

```json
{
  "title": "Jackdaw",
  "width": 1200,
  "height": 800,
  "minWidth": 800,
  "minHeight": 500,
  "visible": false,
  "resizable": true,
  "decorations": false
}
```

- [ ] **Step 2: Verify dev server launches**

```bash
npm run tauri dev
```

Expected: window appears at 1200x800 when activated from tray.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: resize window to full app layout (1200x800)"
```

---

### Task 10: Add Frontend Types and Session Source

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add source field and terminal event types**

In `src/lib/types.ts`, add `source` to the `Session` interface:

```typescript
export interface Session {
  session_id: string;
  cwd: string;
  started_at: string;
  git_branch: string | null;
  current_tool: ToolEvent | null;
  tool_history: ToolEvent[];
  active_subagents: number;
  pending_approval: boolean;
  processing: boolean;
  has_unread: boolean;
  source: 'external' | 'spawned';
}
```

Add terminal event payload types:

```typescript
export interface TerminalOutputPayload {
  session_id: string;
  data: string; // base64-encoded
}

export interface TerminalExitedPayload {
  session_id: string;
  exit_code: number | null;
}
```

- [ ] **Step 2: Update Dashboard.svelte history mapping**

In `src/lib/components/Dashboard.svelte`, in the history session mapping (around line 89-104), add `source: 'external'` to the mapped Session object:

```typescript
session={{
  session_id: session.session_id,
  cwd: session.cwd,
  started_at: session.started_at,
  git_branch: session.git_branch,
  current_tool: null,
  tool_history: session.tool_history.map(t => ({
    tool_name: t.tool_name,
    summary: t.summary,
    timestamp: t.timestamp,
  })),
  active_subagents: 0,
  pending_approval: false,
  processing: false,
  has_unread: false,
  source: 'external',
}}
```

- [ ] **Step 3: Verify type checking passes**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/components/Dashboard.svelte
git commit -m "feat: add source field and terminal event types to frontend"
```

---

### Task 11: Install xterm.js Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install xterm.js packages**

```bash
npm install @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: Verify installation**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @xterm/xterm and @xterm/addon-fit"
```

---

### Task 12: Create Terminal Component

**Files:**
- Create: `src/lib/components/Terminal.svelte`

This wraps xterm.js and connects it to the PTY backend via Tauri events/commands.

- [ ] **Step 1: Create the Terminal component**

Create `src/lib/components/Terminal.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import type { TerminalOutputPayload, TerminalExitedPayload } from '$lib/types';

  interface Props {
    sessionId: string;
  }

  let { sessionId }: Props = $props();

  let containerEl: HTMLDivElement;
  let exited = $state(false);
  let exitCode = $state<number | null>(null);

  onMount(() => {
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#ff2d7840',
      },
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);

    // Initial fit after rendering
    requestAnimationFrame(() => {
      fitAddon.fit();
      invoke('resize_terminal', {
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    });

    // Forward keystrokes to PTY
    const dataDisposable = term.onData((data: string) => {
      const encoded = btoa(data);
      invoke('write_terminal', { sessionId, data: encoded });
    });

    // Listen for PTY output
    let unlistenOutput: (() => void) | undefined;
    listen<TerminalOutputPayload>('terminal-output', (event) => {
      if (event.payload.session_id !== sessionId) return;
      const bytes = Uint8Array.from(atob(event.payload.data), c => c.charCodeAt(0));
      term.write(bytes);
    }).then((fn) => { unlistenOutput = fn; });

    // Listen for PTY exit
    let unlistenExit: (() => void) | undefined;
    listen<TerminalExitedPayload>('terminal-exited', (event) => {
      if (event.payload.session_id !== sessionId) return;
      exited = true;
      exitCode = event.payload.exit_code;
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    }).then((fn) => { unlistenExit = fn; });

    // Resize on container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (!exited) {
        invoke('resize_terminal', {
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(containerEl);

    return () => {
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      term.dispose();
    };
  });
</script>

<div class="terminal-container" bind:this={containerEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* xterm.js needs explicit dimensions */
  .terminal-container :global(.xterm) {
    height: 100%;
    padding: 8px;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
```

- [ ] **Step 2: Add xterm.css import**

xterm.js requires its CSS. In `src/app.css`, add at the top (before the `@font-face` declarations):

```css
@import '@xterm/xterm/css/xterm.css';
```

If SvelteKit/Vite doesn't support `@import` from node_modules in app.css, alternatively import it in the Terminal component's `<script>`:

```typescript
import '@xterm/xterm/css/xterm.css';
```

Try the `@import` approach first. If it causes build errors, switch to the script import.

- [ ] **Step 3: Verify build**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Terminal.svelte src/app.css
git commit -m "feat: add Terminal component wrapping xterm.js"
```

---

### Task 13: Redesign Dashboard with Sidebar Layout

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`
- Modify: `src/app.css`

Convert from vertical tab layout to sidebar (session list) + main area (terminal or detail).

- [ ] **Step 1: Restructure Dashboard layout**

Replace the contents of `src/lib/components/Dashboard.svelte`:

```svelte
<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import Settings from './Settings.svelte';
  import Terminal from './Terminal.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { initUpdaterListener } from '$lib/stores/updater.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { shortenPath, getProjectName } from '$lib/utils';
  import type { HistorySession } from '$lib/types';

  let activeTab = $state<'active' | 'history' | 'settings'>('active');
  let selectedSessionId = $state<string | null>(null);
  let historySessions = $state<HistorySession[]>([]);
  let historyLoading = $state(false);
  let showNewSessionMenu = $state(false);
  let recentCwds = $state<string[]>([]);

  let selectedSession = $derived(
    sessionStore.sessions.find(s => s.session_id === selectedSessionId) ?? null
  );

  onMount(() => {
    const cleanupSessions = initSessionListener();
    const cleanupUpdater = initUpdaterListener();
    return () => {
      cleanupSessions();
      cleanupUpdater();
    };
  });

  function handleDismiss(sessionId: string) {
    invoke('dismiss_session', { sessionId });
    if (selectedSessionId === sessionId) {
      selectedSessionId = null;
    }
  }

  function selectSession(sessionId: string) {
    selectedSessionId = sessionId;
    // Mark as read when selecting
    invoke('mark_session_read', { sessionId });
  }

  async function switchTab(tab: 'active' | 'history' | 'settings') {
    activeTab = tab;
    if (tab === 'history') {
      await loadHistory();
    }
  }

  async function loadHistory() {
    historyLoading = true;
    try {
      historySessions = await invoke<HistorySession[]>('get_session_history', {
        limit: 50,
        offset: 0,
      });
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      historyLoading = false;
    }
  }

  async function openNewSessionMenu() {
    try {
      recentCwds = await invoke<string[]>('get_recent_cwds');
    } catch (e) {
      console.error('Failed to load recent cwds:', e);
    }
    showNewSessionMenu = true;
  }

  async function spawnSession(cwd: string) {
    showNewSessionMenu = false;
    try {
      const sessionId = await invoke<string>('spawn_terminal', { cwd });
      selectedSessionId = sessionId;
    } catch (e) {
      console.error('Failed to spawn terminal:', e);
    }
  }

  function closeNewSessionMenu() {
    showNewSessionMenu = false;
  }
</script>

<div class="app-layout">
  <Header sessionCount={sessionStore.count} globalState={sessionStore.globalState} />

  <div class="main-content">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="tabs">
          <button class="tab" class:active={activeTab === 'active'} onclick={() => switchTab('active')}>
            Active{#if sessionStore.count > 0} ({sessionStore.count}){/if}
          </button>
          <button class="tab" class:active={activeTab === 'history'} onclick={() => switchTab('history')}>
            History
          </button>
          <button class="tab" class:active={activeTab === 'settings'} onclick={() => switchTab('settings')}>
            Settings
          </button>
        </div>
        {#if activeTab === 'active'}
          <button class="new-session-btn" onclick={openNewSessionMenu} title="New session">+</button>
        {/if}
      </div>

      <div class="update-banner-wrapper">
        <UpdateBanner />
      </div>

      <div class="session-list">
        {#if activeTab === 'active'}
          {#if sessionStore.sessions.length === 0}
            <div class="empty">
              <HookSetup />
            </div>
          {:else}
            {#each sessionStore.sessions as session (session.session_id)}
              <div
                class="sidebar-session"
                class:selected={selectedSessionId === session.session_id}
                onclick={() => selectSession(session.session_id)}
                role="button"
                tabindex="0"
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(session.session_id)}
              >
                <SessionCard {session} onDismiss={handleDismiss} compact />
              </div>
            {/each}
          {/if}
        {:else if activeTab === 'history'}
          {#if historyLoading}
            <div class="empty"><span class="loading-text">Loading...</span></div>
          {:else if historySessions.length === 0}
            <div class="empty"><span class="empty-text">No history</span></div>
          {:else}
            {#each historySessions as session (session.session_id)}
              <SessionCard session={{
                session_id: session.session_id,
                cwd: session.cwd,
                started_at: session.started_at,
                git_branch: session.git_branch,
                current_tool: null,
                tool_history: session.tool_history.map(t => ({
                  tool_name: t.tool_name,
                  summary: t.summary,
                  timestamp: t.timestamp,
                })),
                active_subagents: 0,
                pending_approval: false,
                processing: false,
                has_unread: false,
                source: 'external',
              }} onDismiss={handleDismiss} historyMode={true} endedAt={session.ended_at} />
            {/each}
          {/if}
        {:else if activeTab === 'settings'}
          <Settings />
        {/if}
      </div>
    </div>

    <!-- Main area -->
    <div class="main-area">
      {#if selectedSession?.source === 'spawned'}
        <Terminal sessionId={selectedSession.session_id} />
      {:else if selectedSession}
        <div class="detail-view">
          <SessionCard session={selectedSession} onDismiss={handleDismiss} />
        </div>
      {:else}
        <div class="no-selection">
          <span class="no-selection-text">Select a session</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- New Session Modal -->
  {#if showNewSessionMenu}
    <div class="modal-backdrop" onclick={closeNewSessionMenu} role="presentation">
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
        <div class="modal-header">
          <span class="modal-title">New Session</span>
          <button class="modal-close" onclick={closeNewSessionMenu}>x</button>
        </div>
        <div class="modal-body">
          {#if recentCwds.length > 0}
            <div class="recent-label">Recent directories</div>
            {#each recentCwds as cwd}
              <button class="cwd-option" onclick={() => spawnSession(cwd)}>
                <span class="cwd-project">{getProjectName(cwd)}</span>
                <span class="cwd-path">{shortenPath(cwd)}</span>
              </button>
            {/each}
          {:else}
            <div class="empty-text">No recent sessions</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Sidebar */
  .sidebar {
    width: 320px;
    min-width: 280px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-right: 8px;
  }

  .tabs {
    display: flex;
    flex: 1;
    padding: 0 12px;
    gap: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 8px 12px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--active);
  }

  .new-session-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }

  .new-session-btn:hover {
    background: var(--border);
    color: var(--text-primary);
  }

  .update-banner-wrapper {
    padding: 8px 12px 0;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-session {
    cursor: pointer;
    transition: background 0.1s;
  }

  .sidebar-session:hover {
    background: var(--card-bg);
  }

  .sidebar-session.selected {
    background: var(--card-bg);
    outline: 1px solid var(--border);
  }

  /* Main area */
  .main-area {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .detail-view {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .no-selection-text {
    color: var(--text-muted);
    font-size: 14px;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--card-bg);
    border: 1px solid var(--border);
    width: 400px;
    max-height: 500px;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
  }

  .modal-body {
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .recent-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 8px;
  }

  .cwd-option {
    background: none;
    border: 1px solid transparent;
    color: var(--text-primary);
    cursor: pointer;
    padding: 8px 12px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: background 0.1s;
  }

  .cwd-option:hover {
    background: var(--tool-bg);
    border-color: var(--border);
  }

  .cwd-project {
    font-size: 13px;
    font-weight: 600;
  }

  .cwd-path {
    font-size: 11px;
    color: var(--text-muted);
  }

  .loading-text,
  .empty-text {
    color: var(--text-muted);
    font-size: 13px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    padding: 40px;
  }
</style>
```

- [ ] **Step 2: Add `compact` prop to SessionCard**

In `src/lib/components/SessionCard.svelte`, add `compact` to the Props interface:

```typescript
interface Props {
  session: Session;
  onDismiss: (sessionId: string) => void;
  historyMode?: boolean;
  endedAt?: string;
  compact?: boolean;
}

let { session, onDismiss, historyMode = false, endedAt, compact = false }: Props = $props();
```

When `compact` is true, don't render the expanded section (tool history, dismiss button). The card header and tool row should still show. Add this conditional around the existing expanded section:

```svelte
{#if !compact && expanded}
  <!-- existing expanded-section content -->
{/if}
```

And disable the click-to-expand behavior when compact:

```svelte
<div class="row-header" onclick={() => !compact && toggleExpand()} ...>
```

- [ ] **Step 3: Verify build**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Dashboard.svelte src/lib/components/SessionCard.svelte
git commit -m "feat: sidebar + main area layout with new session modal"
```

---

### Task 14: Integration Testing

**Files:**
- No new files — verify the full data flow works.

- [ ] **Step 1: Run backend tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend type checks**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 3: Run frontend tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Manual smoke test**

```bash
npm run tauri dev
```

Test the following:
1. App opens as a full window (1200x800)
2. Sidebar shows tabs (Active, History, Settings) and "+" button
3. External sessions still appear as cards in the sidebar
4. Clicking a session selects it and shows detail in the main area
5. Click "+" → modal shows recent working directories
6. Selecting a directory spawns a terminal with `claude` running
7. Terminal accepts input and displays output
8. Hook events from the spawned session update the session card in the sidebar
9. Closing the terminal tab cleans up the PTY
10. Tray icon still works (click to show/hide, icon state updates)

- [ ] **Step 5: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix: integration fixes from smoke testing"
```

---

### Task 15: Revise PtyManager::spawn to Accept Caller-Provided ID

This task should be done as part of Task 6, but is listed separately for clarity. If Task 6 was already implemented with the internal UUID generation, update it here.

**Files:**
- Modify: `src-tauri/src/pty.rs`

- [ ] **Step 1: Change spawn signature**

Change `PtyManager::spawn` to accept `id: String` as the first parameter. Remove the internal `uuid::Uuid::new_v4()` call. Return `Result<Box<dyn Read + Send>, String>` (just the reader, not a tuple).

```rust
pub fn spawn(
    &self,
    id: String,
    cwd: &str,
    cols: u16,
    rows: u16,
    program: &str,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<Box<dyn Read + Send>, String> {
    // ... same implementation but use `id` directly instead of generating one
    // ... return Ok(reader) instead of Ok((id, reader))
}
```

- [ ] **Step 2: Update tests to pass ID**

Update all tests in `pty.rs` that call `spawn` to pass a string ID:

```rust
let reader = mgr.spawn("test-1".into(), "/tmp", 80, 24, "echo", &["hello"], &[]).unwrap();
```

And update assertions accordingly (no tuple destructuring needed).

- [ ] **Step 3: Run tests**

```bash
cd src-tauri && cargo test pty
```

Expected: all PTY tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "refactor: PtyManager::spawn accepts caller-provided ID"
```
