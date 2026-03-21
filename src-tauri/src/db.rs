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
}
