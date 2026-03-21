use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

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

pub fn init(db_path: &Path) -> Connection {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("failed to create DB directory");
    }
    let conn = Connection::open(db_path).expect("failed to open database");
    setup_connection(&conn);
    conn
}

#[cfg(test)]
pub fn init_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    setup_connection(&conn);
    conn
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_tables() {
        let conn = init_memory();
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
        assert_eq!(cwd, "/home/a");
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
        end_session(&conn, "nonexistent", "2026-03-21T01:00:00Z");
    }

    #[test]
    fn load_history_returns_only_ended_sessions() {
        let conn = init_memory();
        save_session(&conn, "s1", "/tmp", "2026-03-21T00:00:00Z");
        end_session(&conn, "s1", "2026-03-21T01:00:00Z");
        save_session(&conn, "s2", "/tmp", "2026-03-21T02:00:00Z");
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
        assert_eq!(history[0].tool_history[0].tool_name, "Bash");
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
        prune_old_sessions(&conn, 30);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
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
}
