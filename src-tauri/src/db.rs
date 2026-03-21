use rusqlite::Connection;
use std::path::Path;

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
}
