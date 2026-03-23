use crate::state::{extract_summary, HookPayload};
use chrono::Utc;
use interprocess::local_socket::{
    tokio::prelude::*,
    GenericFilePath, GenericNamespaced, ToFsName, ToNsName,
};
use rusqlite::Connection;
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
        let first = crate::db::save_session(conn, &payload.session_id, &payload.cwd, &now);
        crate::db::end_session(conn, &payload.session_id, &now);
        return first;
    }

    let first = crate::db::save_session(conn, &payload.session_id, &payload.cwd, &now);

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

pub fn run() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime");

    rt.block_on(async {
        let mut payload = String::new();
        if let Err(e) = io::stdin().read_to_string(&mut payload) {
            eprintln!("jackdaw send: failed to read stdin: {}", e);
            std::process::exit(1);
        }

        let payload = payload.trim().to_string();
        if payload.is_empty() {
            eprintln!("jackdaw send: empty payload");
            std::process::exit(1);
        }

        let name = match connect_name() {
            Ok(n) => n,
            Err(e) => {
                eprintln!("jackdaw send: invalid socket name: {}", e);
                std::process::exit(1);
            }
        };

        let mut stream = match interprocess::local_socket::tokio::Stream::connect(name).await {
            Ok(s) => s,
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
        };

        let message = format!("{}\n", payload);
        if let Err(e) = stream.write_all(message.as_bytes()).await {
            eprintln!("jackdaw send: failed to send: {}", e);
            std::process::exit(1);
        }
    });
}

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
    fn fallback_session_end_as_first_event_saves_and_ends() {
        let conn = crate::db::init_memory();
        let first = fallback_to_db(&conn, r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionEnd"}"#);
        assert!(first);
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
