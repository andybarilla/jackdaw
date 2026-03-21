# Session Persistence Design

## Problem

Sessions are in-memory only and reset on restart. Users lose all session history and can't review past work.

## Goals

1. Persist session history to survive restarts
2. Reconnect to still-running Claude Code sessions passively (via next hook event)
3. Configurable retention with 30-day default
4. Separate "Active" and "History" views in the frontend

## Storage

SQLite database at `~/.jackdaw/jackdaw.db` via the `rusqlite` crate (synchronous, `Mutex<Connection>` in `AppState`).

### Schema

```sql
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS tool_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
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

Only completed state is persisted. Transient fields (`current_tool`, `processing`, `pending_approval`, `active_subagents`) are runtime-only and stay in the in-memory `HashMap`.

## Backend Architecture

### New module: `db.rs`

Functions:
- `init(db_path) -> Connection` — create/open DB, run migrations, return connection
- `save_session(conn, session_id, cwd, started_at)` — INSERT OR IGNORE new session
- `save_tool_event(conn, session_id, tool_name, summary, timestamp)` — append tool event
- `end_session(conn, session_id, ended_at)` — set `ended_at`
- `load_history(conn, limit, offset) -> Vec<HistorySession>` — ended sessions, newest first
- `prune_old_sessions(conn, retention_days)` — delete sessions (and their tool events) older than retention period
- `get_retention_days(conn) -> u32` — read from config table
- `set_retention_days(conn, days)` — write to config table

### AppState changes

Add `db: Mutex<Connection>` alongside the existing `sessions: Mutex<HashMap<String, Session>>`.

### Write path (server.rs)

Event handlers write to both in-memory state and SQLite:
- `SessionStart` / `or_insert_with` — `save_session()`
- `PostToolUse` — `save_tool_event()` (only completed tools, not PreToolUse)
- `SessionEnd` — `end_session()`
- `Stop` — `save_tool_event()` for any cleared `current_tool`

DB writes happen after state update and event emission. Failures are logged but never block the UI.

### Startup

1. `db::init()` creates/opens the database
2. `prune_old_sessions()` cleans up expired sessions
3. In-memory `HashMap` starts empty — live sessions reappear when their next hook event arrives

### New Tauri commands

- `get_session_history(limit, offset) -> Vec<HistorySession>` — paginated ended sessions from SQLite
- `get_config() -> Config` / `set_config(key, value)` — for retention settings (settings UI deferred)

## Frontend Architecture

### New types

```typescript
interface HistorySession {
  session_id: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  tool_history: ToolEvent[];
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

## Configuration

- Retention period stored in `config` table, default 30 days
- Prune runs once on startup
- `get_config`/`set_config` commands available for future settings UI
