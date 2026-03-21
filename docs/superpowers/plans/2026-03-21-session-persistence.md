# Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist session history to SQLite so sessions survive restarts, with a separate History tab in the UI.

**Architecture:** SQLite via `rusqlite` (bundled) stores completed sessions and tool events. In-memory `HashMap` remains the source of truth for live sessions. `db.rs` module owns all DB operations. Frontend adds Active/History tabs to Dashboard.

**Tech Stack:** Rust/rusqlite (backend), Svelte 5 with runes (frontend), Vitest (frontend tests), cargo test (backend tests)

**Spec:** `docs/superpowers/specs/2026-03-21-session-persistence-design.md`

---

## File Structure

### Backend (src-tauri/src/)

| File | Action | Responsibility |
|------|--------|---------------|
| `db.rs` | Create | All SQLite operations: init, save, load, prune, config |
| `state.rs` | Modify | Add `db: Mutex<Connection>` to `AppState` |
| `server.rs` | Modify | Add DB writes after state updates |
| `lib.rs` | Modify | Add `get_session_history`, `get_retention_days`, `set_retention_days` commands; init DB on startup; update `dismiss_session` |
| `Cargo.toml` | Modify | Add `rusqlite` dependency |

### Frontend (src/lib/)

| File | Action | Responsibility |
|------|--------|---------------|
| `types.ts` | Modify | Add `HistorySession` interface |
| `components/Dashboard.svelte` | Modify | Add Active/History tabs |
| `components/SessionCard.svelte` | Modify | Support history mode (hide dismiss, show ended_at) |
| `components/Header.svelte` | Modify | Support tab switching |

---

## Task 1: Add rusqlite dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add rusqlite to dependencies**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles successfully (first build of bundled SQLite will take a moment)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add rusqlite dependency"
```

---

## Task 2: Create db.rs — schema init and DB path

**Files:**
- Create: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests for init**

Create `src-tauri/src/db.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_tables() {
        let conn = init_memory();
        // sessions table exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn init_creates_tool_events_table() {
        let conn = init_memory();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tool_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn init_creates_config_with_default_retention() {
        let conn = init_memory();
        let days: String = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'retention_days'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(days, "30");
    }

    #[test]
    fn init_enforces_foreign_keys() {
        let conn = init_memory();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }
}
```

Also add `mod db;` to `lib.rs` so the module is compiled.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests`
Expected: FAIL — `init_memory` function not found

- [ ] **Step 3: Implement init and init_memory**

Add above the test module in `db.rs`:

```rust
use rusqlite::Connection;
use std::path::Path;

/// Open or create the SQLite database at the given path.
/// Creates parent directories, sets FK pragma, creates tables.
pub fn init(db_path: &Path) -> Connection {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("failed to create DB directory");
    }
    let conn = Connection::open(db_path).expect("failed to open database");
    setup_connection(&conn);
    conn
}

/// In-memory database for testing.
#[cfg(test)]
pub fn init_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    setup_connection(&conn);
    conn
}

fn setup_connection(conn: &Connection) {
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            cwd TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tool_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            tool_name TEXT NOT NULL,
            summary TEXT,
            timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO config (key, value) VALUES ('retention_days', '30');",
    )
    .unwrap();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: add db.rs with schema init"
```

---

## Task 3: db.rs — save_session and save_tool_event

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests**

Add to the `tests` module in `db.rs`:

```rust
    #[test]
    fn save_session_inserts_row() {
        let conn = init_memory();
        save_session(&conn, "s1", "/home/test", "2026-03-21T00:00:00Z");
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
        save_session(&conn, "s1", "/home/a", "2026-03-21T00:00:00Z");
        save_session(&conn, "s1", "/home/b", "2026-03-21T01:00:00Z");
        let cwd: String = conn
            .query_row("SELECT cwd FROM sessions WHERE session_id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(cwd, "/home/a"); // first insert wins
    }

    #[test]
    fn save_tool_event_inserts_row() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        save_tool_event(&conn, "s1", "Bash", Some("ls -la"), "2026-03-21T00:01:00Z");
        let tool: String = conn
            .query_row("SELECT tool_name FROM tool_events WHERE session_id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tool, "Bash");
    }

    #[test]
    fn save_tool_event_with_no_summary() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        save_tool_event(&conn, "s1", "Bash", None, "2026-03-21T00:01:00Z");
        let summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM tool_events WHERE session_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(summary.is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests`
Expected: FAIL — `save_session` and `save_tool_event` not found

- [ ] **Step 3: Implement save_session and save_tool_event**

Add to `db.rs` (above the test module):

```rust
/// Insert a new session. Idempotent — ignores if session_id already exists.
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

/// Append a completed tool event for a session.
pub fn save_tool_event(
    conn: &Connection,
    session_id: &str,
    tool_name: &str,
    summary: Option<&str>,
    timestamp: &str,
) {
    conn.execute(
        "INSERT INTO tool_events (session_id, tool_name, summary, timestamp) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, tool_name, summary, timestamp],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to save tool event: {}", e);
        0
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add save_session and save_tool_event to db.rs"
```

---

## Task 4: db.rs — end_session

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests**

Add to the `tests` module:

```rust
    #[test]
    fn end_session_sets_ended_at() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        end_session(&conn, "s1", "2026-03-21T01:00:00Z");
        let ended: String = conn
            .query_row(
                "SELECT ended_at FROM sessions WHERE session_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ended, "2026-03-21T01:00:00Z");
    }

    #[test]
    fn end_session_noop_for_unknown_id() {
        let conn = init_memory();
        // Should not panic
        end_session(&conn, "nonexistent", "2026-03-21T01:00:00Z");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests::end_session`
Expected: FAIL — `end_session` not found

- [ ] **Step 3: Implement end_session**

```rust
/// Set ended_at for a session. No-op if session_id doesn't exist.
pub fn end_session(conn: &Connection, session_id: &str, ended_at: &str) {
    conn.execute(
        "UPDATE sessions SET ended_at = ?1 WHERE session_id = ?2",
        rusqlite::params![ended_at, session_id],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to end session: {}", e);
        0
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests::end_session`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add end_session to db.rs"
```

---

## Task 5: db.rs — load_history

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests**

Add the `HistorySession` and `HistoryToolEvent` structs and tests:

```rust
    #[test]
    fn load_history_returns_only_ended_sessions() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        end_session(&conn, "s1", "2026-03-21T01:00:00Z");
        save_session(&conn, "s2", "/tmp", "2026-03-21T02:00:00Z");
        // s2 has no ended_at — should not appear in history
        let history = load_history(&conn, 50, 0);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].session_id, "s1");
    }

    #[test]
    fn load_history_newest_first() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        end_session(&conn, "s1", "2026-03-21T01:00:00Z");
        save_session(&conn, "s2", "/tmp", "2026-03-21T02:00:00Z");
        end_session(&conn, "s2", "2026-03-21T03:00:00Z");
        let history = load_history(&conn, 50, 0);
        assert_eq!(history[0].session_id, "s2");
        assert_eq!(history[1].session_id, "s1");
    }

    #[test]
    fn load_history_includes_tool_events_oldest_first() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-21T00:01:00Z");
        save_tool_event(&conn, "s1", "Read", Some("/f"), "2026-03-21T00:02:00Z");
        end_session(&conn, "s1", "2026-03-21T01:00:00Z");
        let history = load_history(&conn, 50, 0);
        assert_eq!(history[0].tool_history.len(), 2);
        assert_eq!(history[0].tool_history[0].tool_name, "Bash"); // oldest first
        assert_eq!(history[0].tool_history[1].tool_name, "Read");
    }

    #[test]
    fn load_history_caps_tool_events_at_50() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        for i in 0..60 {
            save_tool_event(
                &conn,
                "s1",
                &format!("Tool{}", i),
                None,
                &format!("2026-03-21T{:02}:{:02}:00Z", i / 60, i % 60),
            );
        }
        end_session(&conn, "s1", "2026-03-21T02:00:00Z");
        let history = load_history(&conn, 50, 0);
        assert_eq!(history[0].tool_history.len(), 50);
    }

    #[test]
    fn load_history_pagination() {
        let conn = init_memory();
        for i in 0..5 {
            let id = format!("s{}", i);
            save_session(&conn, &id, "/tmp", &format!("2026-03-21T0{}:00:00Z", i));
            end_session(&conn, &id, &format!("2026-03-21T0{}:30:00Z", i));
        }
        let page1 = load_history(&conn, 2, 0);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].session_id, "s4");

        let page2 = load_history(&conn, 2, 2);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].session_id, "s2");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests::load_history`
Expected: FAIL — `load_history` not found

- [ ] **Step 3: Implement HistorySession and load_history**

Add structs and function to `db.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HistorySession {
    pub session_id: String,
    pub cwd: String,
    pub started_at: String,
    pub ended_at: String,
    pub tool_history: Vec<HistoryToolEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryToolEvent {
    pub tool_name: String,
    pub summary: Option<String>,
    pub timestamp: String,
}

/// Load ended sessions from DB, newest first, with tool events (oldest first, capped at 50).
pub fn load_history(conn: &Connection, limit: u32, offset: u32) -> Vec<HistorySession> {
    let mut stmt = conn
        .prepare(
            "SELECT session_id, cwd, started_at, ended_at FROM sessions
             WHERE ended_at IS NOT NULL
             ORDER BY ended_at DESC
             LIMIT ?1 OFFSET ?2",
        )
        .unwrap();

    let sessions: Vec<(String, String, String, String)> = stmt
        .query_map(rusqlite::params![limit, offset], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut tool_stmt = conn
        .prepare(
            "SELECT tool_name, summary, timestamp FROM tool_events
             WHERE session_id = ?1
             ORDER BY timestamp ASC
             LIMIT 50",
        )
        .unwrap();

    sessions
        .into_iter()
        .map(|(session_id, cwd, started_at, ended_at)| {
            let tool_history: Vec<HistoryToolEvent> = tool_stmt
                .query_map(rusqlite::params![&session_id], |row| {
                    Ok(HistoryToolEvent {
                        tool_name: row.get(0)?,
                        summary: row.get(1)?,
                        timestamp: row.get(2)?,
                    })
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            HistorySession {
                session_id,
                cwd,
                started_at,
                ended_at,
                tool_history,
            }
        })
        .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add load_history to db.rs"
```

---

## Task 6: db.rs — prune_old_sessions

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn prune_deletes_expired_sessions() {
        let conn = init_memory();
        save_session(&conn, "old", "/tmp", "2026-01-01T00:00:00Z");
        end_session(&conn, "old", "2026-01-01T01:00:00Z");
        save_session(&conn, "new", "/tmp", "2026-03-20T00:00:00Z");
        end_session(&conn, "new", "2026-03-20T01:00:00Z");
        prune_old_sessions(&conn, 30);
        let history = load_history(&conn, 50, 0);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].session_id, "new");
    }

    #[test]
    fn prune_cascades_to_tool_events() {
        let conn = init_memory();
        save_session(&conn, "old", "/tmp", "2026-01-01T00:00:00Z");
        save_tool_event(&conn, "old", "Bash", Some("ls"), "2026-01-01T00:01:00Z");
        end_session(&conn, "old", "2026-01-01T01:00:00Z");
        prune_old_sessions(&conn, 30);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tool_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn prune_does_not_delete_sessions_without_ended_at() {
        let conn = init_memory();
        save_session(&conn, "active", "/tmp", "2026-01-01T00:00:00Z");
        // No end_session call — ended_at is NULL
        prune_old_sessions(&conn, 30);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests::prune`
Expected: FAIL — `prune_old_sessions` not found

- [ ] **Step 3: Implement prune_old_sessions**

```rust
/// Delete sessions (and their tool events via CASCADE) where ended_at is older than retention_days.
/// Sessions with ended_at IS NULL are never pruned.
pub fn prune_old_sessions(conn: &Connection, retention_days: u32) {
    conn.execute(
        "DELETE FROM sessions WHERE ended_at IS NOT NULL
         AND ended_at < datetime('now', ?1)",
        rusqlite::params![format!("-{} days", retention_days)],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to prune sessions: {}", e);
        0
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests::prune`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add prune_old_sessions to db.rs"
```

---

## Task 7: db.rs — retention config accessors

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn get_retention_days_default() {
        let conn = init_memory();
        assert_eq!(get_retention_days(&conn), 30);
    }

    #[test]
    fn set_and_get_retention_days() {
        let conn = init_memory();
        set_retention_days(&conn, 90);
        assert_eq!(get_retention_days(&conn), 90);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test db::tests::retention`
Expected: FAIL

- [ ] **Step 3: Implement get/set_retention_days**

```rust
pub fn get_retention_days(conn: &Connection) -> u32 {
    conn.query_row(
        "SELECT value FROM config WHERE key = 'retention_days'",
        [],
        |r| {
            let v: String = r.get(0)?;
            Ok(v.parse::<u32>().unwrap_or(30))
        },
    )
    .unwrap_or(30)
}

pub fn set_retention_days(conn: &Connection, days: u32) {
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('retention_days', ?1)",
        rusqlite::params![days.to_string()],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to set retention days: {}", e);
        0
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test db::tests::retention`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add retention config accessors to db.rs"
```

---

## Task 8: Wire DB into AppState and startup

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add db field to AppState**

In `state.rs`, add the import and field:

```rust
use rusqlite::Connection;
```

Change `AppState`:

```rust
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    pub db: Mutex<Connection>,
}
```

Update `AppState::new()` to take a `Connection`:

```rust
impl AppState {
    pub fn new(db: Connection) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            db: Mutex::new(db),
        }
    }
}
```

- [ ] **Step 2: Update lib.rs to init DB on startup**

In `lib.rs`, add `mod db;` (if not already added in Task 2) and update `run()`:

```rust
pub fn run() {
    let db_path = {
        let home = dirs::home_dir().expect("could not determine home directory");
        home.join(".jackdaw").join("jackdaw.db")
    };
    let db_conn = db::init(&db_path);

    {
        let retention = db::get_retention_days(&db_conn);
        db::prune_old_sessions(&db_conn, retention);
    }

    let app_state = Arc::new(AppState::new(db_conn));
    // ... rest unchanged
}
```

- [ ] **Step 3: Fix any compilation errors**

`AppState::new()` is only called in `lib.rs` (already updated in Step 2). The `state.rs` tests only test `Session` and `extract_summary` — they don't use `AppState`, so no test changes needed.

Run: `cd src-tauri && cargo test`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: wire SQLite into AppState and startup"
```

---

## Task 9: Add DB writes to server.rs

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Write failing integration test**

Add a test to verify DB writes happen when events are processed. Since `handle_event` requires a Tauri `AppHandle`, test indirectly by verifying the DB functions are called correctly in a unit-test-style integration:

Add to `server.rs` test module (or create one):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::state::AppState;

    #[test]
    fn db_persistence_roundtrip() {
        let conn = db::init_memory();
        // Simulate what handle_event does for SessionStart + PostToolUse + SessionEnd
        db::save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        db::save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-21T00:01:00Z");
        db::end_session(&conn, "s1", "2026-03-21T01:00:00Z");

        let history = db::load_history(&conn, 50, 0);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].session_id, "s1");
        assert_eq!(history[0].tool_history.len(), 1);
        assert_eq!(history[0].tool_history[0].tool_name, "Bash");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test server::tests`
Expected: FAIL — test module doesn't exist yet or `init_memory` not accessible

- [ ] **Step 3: Make test pass and add DB writes to handle_event**

After the `or_insert_with` call that creates sessions, capture `started_at` from the session struct. Add DB writes after state update and event emission. Three `spawn_blocking` blocks, each for a distinct concern:

For session creation (on any non-SessionEnd event), capture `started_at` from the in-memory session:

```rust
// After the or_insert_with block, before the match:
let session_started_at = sessions.get(&session_id).map(|s| s.started_at.to_rfc3339());
```

After the match block and event emission, add persistence:

```rust
// DB persistence (best-effort, non-blocking)
// 1. Ensure session row exists
if let Some(started_at) = session_started_at {
    let sc = state.clone();
    let sid = session_id.clone();
    let cwd_clone = cwd.clone();
    tokio::task::spawn_blocking(move || {
        let db = sc.db.lock().unwrap();
        crate::db::save_session(&db, &sid, &cwd_clone, &started_at);
    });
}

// 2. Save completed tool event (PostToolUse only)
if event_name == "PostToolUse" {
    if let (Some(tn), Some(ts)) = (tool_name_for_db, tool_timestamp_for_db) {
        let sc = state.clone();
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || {
            let db = sc.db.lock().unwrap();
            crate::db::save_tool_event(&db, &sid, &tn, summary_for_db.as_deref(), &ts);
        });
    }
}

// 3. End session
if event_name == "SessionEnd" {
    let sc = state.clone();
    let sid = session_id.clone();
    tokio::task::spawn_blocking(move || {
        let db = sc.db.lock().unwrap();
        crate::db::end_session(&db, &sid, &chrono::Utc::now().to_rfc3339());
    });
}
```

Capture `tool_name_for_db`, `summary_for_db`, and `tool_timestamp_for_db` inside the `PostToolUse` match arm before the state lock is dropped.

- [ ] **Step 4: Verify compilation and tests**

Run: `cd src-tauri && cargo check && cargo test`
Expected: compiles and all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: add DB persistence writes to event handlers"
```

---

## Task 10: Add Tauri commands for history and config

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add get_session_history command**

```rust
#[tauri::command]
fn get_session_history(
    limit: u32,
    offset: u32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Vec<db::HistorySession> {
    let db = state.db.lock().unwrap();
    db::load_history(&db, limit, offset)
}
```

- [ ] **Step 2: Add retention config commands**

```rust
#[tauri::command]
fn get_retention_days(state: tauri::State<'_, Arc<AppState>>) -> u32 {
    let db = state.db.lock().unwrap();
    db::get_retention_days(&db)
}

#[tauri::command]
fn set_retention_days(days: u32, state: tauri::State<'_, Arc<AppState>>) {
    let db = state.db.lock().unwrap();
    db::set_retention_days(&db, days);
}
```

- [ ] **Step 3: Update dismiss_session to persist ended_at**

```rust
#[tauri::command]
fn dismiss_session(session_id: String, state: tauri::State<'_, Arc<AppState>>, app: AppHandle) {
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    // Persist end time to DB
    let db = state.db.lock().unwrap();
    db::end_session(&db, &session_id, &chrono::Utc::now().to_rfc3339());
}
```

- [ ] **Step 4: Register new commands in invoke_handler**

Update the `.invoke_handler()` line:

```rust
.invoke_handler(tauri::generate_handler![
    dismiss_session,
    check_hooks_status,
    install_hooks,
    uninstall_hooks,
    get_session_history,
    get_retention_days,
    set_retention_days,
])
```

- [ ] **Step 5: Verify compilation and tests**

Run: `cd src-tauri && cargo check && cargo test`
Expected: compiles and all tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add history and config Tauri commands"
```

---

## Task 11: Frontend — add HistorySession type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add HistorySession interface**

```typescript
export interface HistorySession {
  session_id: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  tool_history: HistoryToolEvent[];
}

export interface HistoryToolEvent {
  tool_name: string;
  summary: string | null;
  timestamp: string;
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add HistorySession type"
```

---

## Task 12: Frontend — add formatEndedAt to utils with tests

**Files:**
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/lib/utils.test.ts`:

```typescript
import { formatEndedAt } from './utils';

describe('formatEndedAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 1 hour ago', () => {
    expect(formatEndedAt('2026-03-21T11:30:00Z')).toBe('just now');
  });

  it('returns hours ago', () => {
    expect(formatEndedAt('2026-03-21T09:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    expect(formatEndedAt('2026-03-19T12:00:00Z')).toBe('2d ago');
  });

  it('returns date for older than a week', () => {
    const result = formatEndedAt('2026-03-01T12:00:00Z');
    expect(result).toMatch(/3\/1\/2026|1\/3\/2026|2026/); // locale-dependent
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run utils.test`
Expected: FAIL — `formatEndedAt` not exported

- [ ] **Step 3: Implement formatEndedAt**

Add to `src/lib/utils.ts`:

```typescript
export function formatEndedAt(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run utils.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: add formatEndedAt utility"
```

---

## Task 13: Frontend — SessionCard history mode

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add historyMode and endedAt props**

Update the Props interface and derived values:

```typescript
  import { getUptime, getProjectName, shortenSessionId, formatEndedAt } from '$lib/utils';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    historyMode?: boolean;
    endedAt?: string;
  }

  let { session, onDismiss, historyMode = false, endedAt }: Props = $props();
```

- [ ] **Step 2: Update uptime display for history mode**

Change the uptime derived:

```typescript
  let uptime = $derived(historyMode && endedAt
    ? formatEndedAt(endedAt)
    : getUptime(session.started_at));
```

- [ ] **Step 3: Hide dismiss button in history mode**

In the expanded section, wrap the dismiss button:

```svelte
{#if !historyMode}
  <button class="dismiss" onclick={() => onDismiss(session.session_id)}>Dismiss</button>
{/if}
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add history mode to SessionCard"
```

---

## Task 14: Frontend — Dashboard tabs (Active/History)

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add tab state and history fetching**

Update the `<script>` section:

```typescript
<script lang="ts">
  import Header from './Header.svelte';
  import SessionCard from './SessionCard.svelte';
  import HookSetup from './HookSetup.svelte';
  import { sessionStore, initSessionListener } from '$lib/stores/sessions.svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { HistorySession } from '$lib/types';

  let activeTab = $state<'active' | 'history'>('active');
  let historySessions = $state<HistorySession[]>([]);
  let historyLoading = $state(false);

  onMount(() => {
    const cleanup = initSessionListener();
    return () => cleanup();
  });

  function handleDismiss(sessionId: string) {
    invoke('dismiss_session', { sessionId });
  }

  async function switchTab(tab: 'active' | 'history') {
    activeTab = tab;
    if (tab === 'history' && historySessions.length === 0) {
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
</script>
```

- [ ] **Step 2: Update the template**

```svelte
<div class="dashboard">
  <Header sessionCount={sessionStore.count} runningCount={sessionStore.runningCount} />

  <div class="tabs">
    <button class="tab" class:active={activeTab === 'active'} onclick={() => switchTab('active')}>
      Active{#if sessionStore.count > 0} ({sessionStore.count}){/if}
    </button>
    <button class="tab" class:active={activeTab === 'history'} onclick={() => switchTab('history')}>
      History
    </button>
  </div>

  <div class="session-list">
    {#if activeTab === 'active'}
      {#if sessionStore.sessions.length === 0}
        <div class="empty">
          <HookSetup />
        </div>
      {:else}
        {#each sessionStore.sessions as session (session.session_id)}
          <SessionCard {session} onDismiss={handleDismiss} />
        {/each}
      {/if}
    {:else}
      {#if historyLoading}
        <div class="empty"><span class="loading-text">Loading history...</span></div>
      {:else if historySessions.length === 0}
        <div class="empty"><span class="empty-text">No session history yet</span></div>
      {:else}
        {#each historySessions as session (session.session_id)}
          <SessionCard session={{
            session_id: session.session_id,
            cwd: session.cwd,
            started_at: session.started_at,
            current_tool: null,
            tool_history: session.tool_history.map(t => ({
              tool_name: t.tool_name,
              summary: t.summary,
              timestamp: t.timestamp,
            })),
            active_subagents: 0,
            pending_approval: false,
            processing: false,
          }} onDismiss={handleDismiss} historyMode={true} endedAt={session.ended_at} />
        {/each}
      {/if}
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Add tab styles**

```css
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
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
    padding: 8px 16px;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--blue);
  }

  .loading-text,
  .empty-text {
    color: var(--text-muted);
    font-size: 13px;
  }
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: no errors (SessionCard already accepts `historyMode`/`endedAt` from Task 13)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add Active/History tabs to Dashboard"
```

---

## Task 15: Integration test and final verification

**Files:**
- No new files

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `npm test -- --run`
Expected: all tests PASS

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`

Verify:
1. App starts without errors
2. Dashboard shows "Active" and "History" tabs
3. Active tab shows live sessions as before
4. Hook events create DB entries (check `~/.jackdaw/jackdaw.db` exists)
5. After a session ends, switching to History tab shows it
6. Dismissing a session moves it to history

- [ ] **Step 5: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: address issues from smoke test"
```
