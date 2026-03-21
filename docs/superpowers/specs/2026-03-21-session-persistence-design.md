# Session Persistence Design

## Problem

Sessions are in-memory only and reset on restart. Users lose all session history and can't review past work.

## Goals

1. Persist session history to survive restarts
2. Reconnect to still-running Claude Code sessions passively (via next hook event)
3. Configurable retention with 30-day default
4. Separate "Active" and "History" views in the frontend

## Storage

SQLite database via the `rusqlite` crate with the `bundled` feature (statically links SQLite — no system dependency required).

DB path: `~/.jackdaw/jackdaw.db` on all platforms, matching the existing `ipc.rs` pattern which uses `dirs::home_dir()` uniformly. Panics if `home_dir()` returns `None` (consistent with existing `ipc.rs` behavior). `db::init()` calls `create_dir_all` on the parent directory before opening the connection, ensuring `~/.jackdaw/` exists on all platforms (needed on Windows where `ensure_socket_dir()` is a no-op).

### Schema

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
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

-- Default retention
INSERT OR IGNORE INTO config (key, value) VALUES ('retention_days', '30');
```

`PRAGMA foreign_keys = ON` is set on every connection open so `ON DELETE CASCADE` works for `prune_old_sessions`.

Only completed state is persisted. Transient fields (`current_tool`, `processing`, `pending_approval`, `active_subagents`) are runtime-only and stay in the in-memory `HashMap`.

Future schema changes: `init()` uses `CREATE TABLE IF NOT EXISTS` for initial creation. If the schema needs to evolve later, we'll add a `schema_version` key to the `config` table and versioned migration logic at that point. Not needed for v1.

## Backend Architecture

### New module: `db.rs`

Functions:
- `init(db_path) -> Connection` — create/open DB, set `PRAGMA foreign_keys = ON`, create tables, return connection
- `save_session(conn, session_id, cwd, started_at)` — INSERT OR IGNORE new session
- `save_tool_event(conn, session_id, tool_name, summary, timestamp)` — append tool event
- `end_session(conn, session_id, ended_at)` — `UPDATE sessions SET ended_at = ? WHERE session_id = ?`. No-op if session_id doesn't exist in DB (e.g. SessionEnd arrives after restart with no prior SessionStart).
- `load_history(conn, limit, offset) -> Vec<HistorySession>` — ended sessions newest first. Tool events loaded per-session with `ORDER BY timestamp ASC LIMIT 50` (matching `MAX_TOOL_HISTORY`, oldest-first like the in-memory `tool_history` Vec so `SessionCard` renders consistently). Two queries: one for paginated sessions, then one per session for its tool events.
- `prune_old_sessions(conn, retention_days)` — delete sessions where `ended_at` is older than retention period; `ON DELETE CASCADE` removes associated tool events. Sessions with `ended_at IS NULL` are never pruned (they represent sessions that weren't cleanly ended).
- `get_retention_days(conn) -> u32` — read from config table
- `set_retention_days(conn, days)` — write to config table

### Dependencies

Add to `Cargo.toml`:
```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

### AppState changes

Add `db: Mutex<Connection>` alongside the existing `sessions: Mutex<HashMap<String, Session>>`.

`rusqlite::Connection` is `Send` so `Mutex<Connection>` is `Send + Sync`. DB writes acquire the lock inside a `spawn_blocking` closure (the `Arc<AppState>` is cloned and moved in; the `MutexGuard` is never held across an await point).

### Write path (server.rs)

Event handlers write to both in-memory state and SQLite:
- `SessionStart` / `or_insert_with` — `save_session()`
- `PostToolUse` — `save_tool_event()` (the canonical persistence point for completed tools)
- `SessionEnd` — `end_session()` (only writes `ended_at`; depends on `save_session` having been called on a prior `SessionStart`. If no prior row exists, the UPDATE is a no-op.)

`Stop` does NOT persist tool events — `PostToolUse` already handles completed tools. `Stop` only clears in-memory `current_tool`. If a tool was rejected (PreToolUse with no PostToolUse), it was never completed and should not be persisted.

DB writes happen after state update and event emission via `tokio::task::spawn_blocking` to avoid blocking the async runtime. Pattern:

```rust
let state = state.clone(); // Arc<AppState>
tokio::task::spawn_blocking(move || {
    let db = state.db.lock().unwrap();
    // ... db operation ...
});
```

Failures are logged but never block the UI.

### Startup

1. `db::init()` creates/opens the database, sets FK pragma
2. `prune_old_sessions()` cleans up expired sessions (cascade deletes their tool events)
3. In-memory `HashMap` starts empty — live sessions reappear when their next hook event arrives

### dismiss_session behavior

`dismiss_session` currently only removes from in-memory state. With persistence, it also writes `ended_at = now` to SQLite so the session appears in history rather than becoming an orphaned record. If the session has no DB row (pre-persistence sessions), the UPDATE is a no-op.

### New Tauri commands

- `get_session_history(limit, offset) -> Vec<HistorySession>` — paginated ended sessions from SQLite
- `get_retention_days() -> u32` / `set_retention_days(days)` — typed accessors for retention config

## Frontend Architecture

### New types

```typescript
interface HistorySession {
  session_id: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  tool_history: ToolEvent[]; // capped at 50 per session from DB query
}
```

### Dashboard changes

- Two tabs: "Active" (existing behavior) and "History"
- Active tab: unchanged, driven by `session-update` events
- History tab: fetches from `get_session_history` on tab switch, paginated (50 per page)

### SessionCard reuse

The existing `SessionCard` component renders history sessions naturally — they have no `current_tool`, `processing` is false, so they show as idle/ended. The dismiss button is hidden for history entries. An `ended_at` timestamp replaces the uptime display.

## What stays the same

- In-memory `HashMap<String, Session>` remains source of truth for live sessions
- `session-update` event flow unchanged
- Tray icon logic unchanged
- `jackdaw-send` binary unchanged

## Testing

All `db.rs` functions tested using in-memory SQLite (`:memory:`). Key test cases:
- Schema creation and FK pragma enforcement
- `save_session` + `save_tool_event` roundtrip
- `save_session` is idempotent (INSERT OR IGNORE)
- `end_session` sets `ended_at`
- `end_session` is a no-op for unknown session_id
- `load_history` returns only ended sessions, newest first, tool events capped at 50
- `prune_old_sessions` deletes expired sessions and cascades to tool events
- `prune_old_sessions` does not delete sessions with `ended_at IS NULL`
- `get_retention_days` / `set_retention_days` roundtrip
