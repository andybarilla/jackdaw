# Offline Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `jackdaw send` can't reach the daemon, write events directly to the SQLite DB and warn once per session; when the daemon later sees that session, rehydrate its tool history from the DB.

**Architecture:** The `send::run()` function gets a fallback path that opens the DB directly on connection failure. `db::save_session()` is changed to return `bool` (whether the row was inserted) to gate the one-time stderr warning. In `server.rs`, session creation checks the DB for prior tool history and pre-populates the in-memory `Session`.

**Tech Stack:** Rust, rusqlite, existing `db` and `send` modules

---

### Task 1: Change `db::save_session` to return `bool`

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Update existing tests and add new ones**

In `src-tauri/src/db.rs`, update existing `save_session` tests and add insertion-detection tests in `mod tests`:

```rust
#[test]
fn save_session_inserts_row() {
    let conn = init_memory();
    let inserted = save_session(&conn, "s1", "/home/test", "2026-03-21T00:00:00Z");
    assert!(inserted);
    let cwd: String = conn
        .query_row("SELECT cwd FROM sessions WHERE session_id = 's1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(cwd, "/home/test");
}

#[test]
fn save_session_is_idempotent() {
    let conn = init_memory();
    let first = save_session(&conn, "s1", "/home/a", "2026-03-21T00:00:00Z");
    let second = save_session(&conn, "s1", "/home/b", "2026-03-21T01:00:00Z");
    assert!(first);
    assert!(!second);
    let cwd: String = conn
        .query_row("SELECT cwd FROM sessions WHERE session_id = 's1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(cwd, "/home/a");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test save_session`
Expected: FAIL — type mismatch (save_session returns `()`, tests expect `bool`)

- [ ] **Step 3: Change `save_session` to return `bool`**

In `src-tauri/src/db.rs`, change:

```rust
pub fn save_session(conn: &Connection, session_id: &str, cwd: &str, started_at: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO sessions (session_id, cwd, started_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![session_id, cwd, started_at],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to save session: {}", e);
        0
    });
}
```

to:

```rust
pub fn save_session(conn: &Connection, session_id: &str, cwd: &str, started_at: &str) -> bool {
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO sessions (session_id, cwd, started_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![session_id, cwd, started_at],
        )
        .unwrap_or_else(|e| {
            eprintln!("Jackdaw: failed to save session: {}", e);
            0
        });
    changed > 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS (existing callers in `server.rs` ignore the return value, so no breakage)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: make save_session return bool indicating insertion"
```

---

### Task 2: Add `db::load_tool_events_for_session`

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/db.rs` inside `mod tests`, add:

```rust
#[test]
fn load_tool_events_empty_for_unknown_session() {
    let conn = init_memory();
    let events = load_tool_events_for_session(&conn, "unknown");
    assert!(events.is_empty());
}

#[test]
fn load_tool_events_returns_events_oldest_first() {
    let conn = init_memory();
    save_session(&conn, "s1", "/tmp", "2026-03-23T00:00:00Z");
    save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-23T00:01:00Z");
    save_tool_event(&conn, "s1", "Read", Some("/f"), "2026-03-23T00:02:00Z");
    let events = load_tool_events_for_session(&conn, "s1");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].tool_name, "Bash");
    assert_eq!(events[1].tool_name, "Read");
}

#[test]
fn load_tool_events_caps_at_50() {
    let conn = init_memory();
    save_session(&conn, "s1", "/tmp", "2026-03-23T00:00:00Z");
    for i in 0..60 {
        save_tool_event(
            &conn,
            "s1",
            &format!("Tool{}", i),
            None,
            &format!("2026-03-23T{:02}:{:02}:00Z", i / 60, i % 60),
        );
    }
    let events = load_tool_events_for_session(&conn, "s1");
    assert_eq!(events.len(), 50);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test load_tool_events`
Expected: FAIL — function not found

- [ ] **Step 3: Write minimal implementation**

In `src-tauri/src/db.rs`, add:

```rust
pub fn load_tool_events_for_session(conn: &Connection, session_id: &str) -> Vec<HistoryToolEvent> {
    let mut stmt = conn
        .prepare(
            "SELECT tool_name, summary, timestamp FROM tool_events
             WHERE session_id = ?1
             ORDER BY timestamp ASC
             LIMIT 50",
        )
        .unwrap();

    stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(HistoryToolEvent {
            tool_name: row.get(0)?,
            summary: row.get(1)?,
            timestamp: row.get(2)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test load_tool_events`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add load_tool_events_for_session to db module"
```

---

### Task 3: Make `db` module public and add offline fallback to `send::run()`

**Files:**
- Modify: `src-tauri/src/lib.rs` (make `db` public)
- Modify: `src-tauri/src/send.rs`

**Note:** Task 4 depends on this task completing Step 1 (making `db` public).

- [ ] **Step 1: Make `db` module public**

In `src-tauri/src/lib.rs`, change:
```rust
mod db;
```
to:
```rust
pub mod db;
```

- [ ] **Step 2: Write the failing tests for offline fallback**

In `src-tauri/src/send.rs`, add a `#[cfg(test)] mod tests` block:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_saves_session_start() {
        let conn = crate::db::init_memory();
        let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        let inserted = fallback_to_db(&conn, payload);
        assert!(inserted);
        let events = crate::db::load_tool_events_for_session(&conn, "s1");
        assert!(events.is_empty());
    }

    #[test]
    fn fallback_saves_post_tool_use() {
        let conn = crate::db::init_memory();
        fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#);
        let inserted = fallback_to_db(
            &conn,
            r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}"#,
        );
        assert!(!inserted);
        let events = crate::db::load_tool_events_for_session(&conn, "s1");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tool_name, "Bash");
    }

    #[test]
    fn fallback_handles_session_end() {
        let conn = crate::db::init_memory();
        fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#);
        fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionEnd"}"#);
        let history = crate::db::load_history(&conn, 50, 0);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].session_id, "s1");
    }

    #[test]
    fn fallback_returns_true_only_on_first_event_for_session() {
        let conn = crate::db::init_memory();
        assert!(fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#));
        assert!(!fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"Stop"}"#));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib send::tests`
Expected: FAIL — `fallback_to_db` not found

- [ ] **Step 4: Implement `fallback_to_db` function**

In `src-tauri/src/send.rs`, add these imports and the function:

```rust
use crate::state::{extract_summary, HookPayload};
use chrono::Utc;
use rusqlite::Connection;

/// Write a hook event directly to the DB when the daemon is unreachable.
/// Returns true if this was the first event for this session (new row inserted).
fn fallback_to_db(conn: &Connection, json_payload: &str) -> bool {
    let payload: HookPayload = match serde_json::from_str(json_payload) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("jackdaw send: bad JSON payload: {}", e);
            return false;
        }
    };

    let now = Utc::now().to_rfc3339();

    if payload.hook_event_name == "SessionEnd" {
        crate::db::end_session(conn, &payload.session_id, &now);
        return false;
    }

    let first = crate::db::save_session(
        conn,
        &payload.session_id,
        &payload.cwd,
        &now,
    );

    if payload.hook_event_name == "PostToolUse" {
        if let Some(ref tool_name) = payload.tool_name {
            let summary = extract_summary(tool_name, &payload.tool_input);
            crate::db::save_tool_event(
                conn,
                &payload.session_id,
                tool_name,
                summary.as_deref(),
                &now,
            );
        }
    }

    first
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib send::tests`
Expected: PASS

- [ ] **Step 6: Wire fallback into `run()`**

In `src-tauri/src/send.rs`, replace the connection-failure arm:

```rust
Err(e) => {
    eprintln!("jackdaw send: failed to connect (is Jackdaw running?): {}", e);
    std::process::exit(1);
}
```

with:

```rust
Err(_) => {
    let db_path = dirs::home_dir()
        .expect("could not determine home directory")
        .join(".jackdaw")
        .join("jackdaw.db");
    let conn = crate::db::init(&db_path);
    let first = fallback_to_db(&conn, &payload);
    if first {
        eprintln!(
            "Jackdaw: daemon not running \u{2014} saving to history offline"
        );
    }
    return;
}
```

This exits the async block normally (exit 0), not `std::process::exit(1)`.

- [ ] **Step 7: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/send.rs src-tauri/src/lib.rs
git commit -m "feat: offline fallback in jackdaw send writes directly to DB"
```

---

### Task 4: Session rehydration — `Session::hydrate_from_history`

**Depends on:** Task 3 Step 1 (making `db` module public, so `state.rs` tests can reference `crate::db::HistoryToolEvent`).

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/state.rs` inside `mod tests`, add:

```rust
#[test]
fn hydrate_from_history_populates_tool_history() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    let history = vec![
        crate::db::HistoryToolEvent {
            tool_name: "Bash".into(),
            summary: Some("ls".into()),
            timestamp: "2026-03-23T00:01:00Z".into(),
        },
        crate::db::HistoryToolEvent {
            tool_name: "Read".into(),
            summary: Some("/f".into()),
            timestamp: "2026-03-23T00:02:00Z".into(),
        },
    ];
    s.hydrate_from_history(&history);
    assert_eq!(s.tool_history.len(), 2);
    assert_eq!(s.tool_history[0].tool_name, "Bash");
    assert_eq!(s.tool_history[0].summary, Some("ls".into()));
    assert_eq!(s.tool_history[1].tool_name, "Read");
}

#[test]
fn hydrate_from_history_noop_when_empty() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.hydrate_from_history(&[]);
    assert!(s.tool_history.is_empty());
}

#[test]
fn hydrate_from_history_noop_when_already_has_history() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.set_current_tool(make_tool("Bash", Some("id-1")));
    s.clear_current_tool();
    let history = vec![crate::db::HistoryToolEvent {
        tool_name: "Read".into(),
        summary: None,
        timestamp: "2026-03-23T00:01:00Z".into(),
    }];
    s.hydrate_from_history(&history);
    assert_eq!(s.tool_history.len(), 1);
    assert_eq!(s.tool_history[0].tool_name, "Bash");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test hydrate_from_history`
Expected: FAIL — method not found

- [ ] **Step 3: Implement `hydrate_from_history`**

In `src-tauri/src/state.rs`, add to `impl Session`:

```rust
pub fn hydrate_from_history(&mut self, history: &[crate::db::HistoryToolEvent]) {
    if !self.tool_history.is_empty() || history.is_empty() {
        return;
    }
    for event in history {
        let ts = event
            .timestamp
            .parse::<DateTime<Utc>>()
            .unwrap_or_else(|_| Utc::now());
        self.tool_history.push(ToolEvent {
            tool_name: event.tool_name.clone(),
            timestamp: ts,
            summary: event.summary.clone(),
            tool_use_id: None,
        });
    }
    while self.tool_history.len() > MAX_TOOL_HISTORY {
        self.tool_history.remove(0);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test hydrate_from_history`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add Session::hydrate_from_history for offline rehydration"
```

---

### Task 5: Wire rehydration into `server.rs`

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Write the failing test for rehydration wiring**

In `src-tauri/src/server.rs` inside `mod tests`, add:

```rust
#[test]
fn rehydration_populates_new_session_from_db() {
    use crate::state::{AppState, Session};

    let conn = db::init_memory();
    // Simulate offline events already in DB
    db::save_session(&conn, "s1", "/tmp", "2026-03-23T00:00:00Z");
    db::save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-23T00:01:00Z");
    db::save_tool_event(&conn, "s1", "Read", Some("/f"), "2026-03-23T00:02:00Z");

    let state = std::sync::Arc::new(AppState::new(conn));
    let mut sessions = state.sessions.lock().unwrap();

    // Simulate what handle_event does for a new session
    if !sessions.contains_key("s1") {
        let db = state.db.lock().unwrap();
        let history = db::load_tool_events_for_session(&db, "s1");
        drop(db);
        let mut session = Session::new("s1".into(), "/tmp".into());
        session.hydrate_from_history(&history);
        sessions.insert("s1".into(), session);
    }

    let session = sessions.get("s1").unwrap();
    assert_eq!(session.tool_history.len(), 2);
    assert_eq!(session.tool_history[0].tool_name, "Bash");
    assert_eq!(session.tool_history[0].summary, Some("ls".into()));
    assert_eq!(session.tool_history[1].tool_name, "Read");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test rehydration_populates`
Expected: FAIL — test references `hydrate_from_history` which should exist from Task 4, but the test logic itself should compile. If Task 4 is complete, this test should pass immediately after writing, confirming the pattern works. If it fails, the wiring is wrong.

- [ ] **Step 3: Modify session creation to rehydrate (deadlock-safe)**

In `src-tauri/src/server.rs`, in `handle_event`, change:

```rust
    // Ensure session exists for any event (except SessionEnd which removes it).
    if event_name != "SessionEnd" {
        sessions
            .entry(session_id.clone())
            .or_insert_with(|| Session::new(session_id.clone(), cwd.clone()));
    }
```

to:

```rust
    // Ensure session exists for any event (except SessionEnd which removes it).
    if event_name != "SessionEnd" && !sessions.contains_key(&session_id) {
        // Drop sessions lock before acquiring db lock to avoid deadlock
        drop(sessions);
        let db = state.db.lock().unwrap();
        let history = crate::db::load_tool_events_for_session(&db, &session_id);
        drop(db);
        // Re-acquire sessions lock
        sessions = state.sessions.lock().unwrap();
        // Double-check — another thread may have inserted while we released the lock
        if !sessions.contains_key(&session_id) {
            let mut session = Session::new(session_id.clone(), cwd.clone());
            session.hydrate_from_history(&history);
            sessions.insert(session_id.clone(), session);
        }
    }
```

Note: `sessions` is rebound via `sessions = state.sessions.lock().unwrap()` so the existing code below continues to work with the re-acquired lock. The `let mut sessions` declaration at line 76 needs to become `let mut sessions`.

- [ ] **Step 4: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: rehydrate session tool history from DB on first connect"
```

---

### Task 6: Manual integration test

- [ ] **Step 1: Build and test the offline path**

```bash
cd src-tauri && cargo build
```

1. Make sure Jackdaw daemon is NOT running
2. Run: `echo '{"session_id":"test-offline","cwd":"/tmp","hook_event_name":"SessionStart"}' | cargo run -- send`
3. Verify stderr shows: `Jackdaw: daemon not running — saving to history offline`
4. Run a second event: `echo '{"session_id":"test-offline","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}' | cargo run -- send`
5. Verify NO stderr warning (second event for same session)
6. Start Jackdaw daemon
7. Send a new event for same session: `echo '{"session_id":"test-offline","cwd":"/tmp","hook_event_name":"UserPromptSubmit"}' | cargo run -- send`
8. Verify the dashboard shows the session with "Bash: ls" in its tool history (rehydrated from DB)

- [ ] **Step 2: Commit any fixes if needed**
