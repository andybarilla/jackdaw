use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::state::{extract_summary, AppState, HookPayload, Session, ToolEvent};
use chrono::Utc;

use interprocess::local_socket::{
    traits::tokio::Listener as _, GenericFilePath, ListenerOptions, ToFsName,
};
#[cfg(windows)]
use interprocess::local_socket::{GenericNamespaced, ToNsName};

pub async fn start_server(app_handle: AppHandle, state: Arc<AppState>) {
    crate::ipc::ensure_socket_dir();
    crate::ipc::remove_stale_socket();

    let name = crate::ipc::socket_path();

    let listener = {
        #[cfg(unix)]
        {
            let name = name.to_fs_name::<GenericFilePath>().expect("invalid socket path");
            ListenerOptions::new().name(name).create_tokio()
        }
        #[cfg(windows)]
        {
            let name = name.to_ns_name::<GenericNamespaced>().expect("invalid pipe name");
            ListenerOptions::new().name(name).create_tokio()
        }
    };

    let listener = match listener {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Jackdaw: failed to create IPC listener: {}", e);
            return;
        }
    };

    eprintln!("Jackdaw: IPC listening on {}", crate::ipc::socket_path());

    loop {
        match listener.accept().await {
            Ok(conn) => {
                let app_handle = app_handle.clone();
                let state = state.clone();
                tokio::spawn(async move {
                    let reader = tokio::io::BufReader::new(conn);
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        handle_event(&app_handle, &state, &line).await;
                    }
                });
            }
            Err(e) => {
                eprintln!("Jackdaw: IPC accept error: {}", e);
            }
        }
    }
}

async fn handle_event(app_handle: &AppHandle, state: &Arc<AppState>, json_line: &str) {
    let payload: HookPayload = match serde_json::from_str(json_line) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Jackdaw: bad JSON payload: {}", e);
            return;
        }
    };

    let session_id = payload.session_id;
    let cwd = payload.cwd;
    let event_name = payload.hook_event_name;

    let mut sessions = state.sessions.lock().unwrap();

    // Ensure session exists for any event (except SessionEnd which removes it).
    if event_name != "SessionEnd" {
        sessions
            .entry(session_id.clone())
            .or_insert_with(|| Session::new(session_id.clone(), cwd.clone()));
    }

    let session_started_at = sessions.get(&session_id).map(|s| s.started_at.to_rfc3339());

    // Option variables for PostToolUse DB persistence; set inside the arm below.
    let mut db_tool_name: Option<String> = None;
    let mut db_tool_summary: Option<String> = None;
    let mut db_tool_timestamp: Option<String> = None;

    match event_name.as_str() {
        "SessionStart" => {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.processing = true;
            }
        }
        "Stop" => {
            // End of Claude's response turn — session goes idle, waiting for user input
            if let Some(session) = sessions.get_mut(&session_id) {
                session.processing = false;
                session.pending_approval = false;
                session.clear_current_tool();
            }
        }
        "SessionEnd" => {
            // Session actually exiting — remove it
            sessions.remove(&session_id);
        }
        "PreToolUse" => {
            let tool_name = match payload.tool_name {
                Some(name) => name,
                None => {
                    eprintln!("Jackdaw: PreToolUse missing tool_name");
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
                    eprintln!("Jackdaw: PostToolUse missing tool_name");
                    return;
                }
            };
            let summary = extract_summary(&tool_name, &payload.tool_input);
            let now = Utc::now();
            let tool_event = ToolEvent {
                tool_name: tool_name.clone(),
                timestamp: now,
                summary: summary.clone(),
                tool_use_id: payload.tool_use_id.clone(),
            };

            db_tool_name = Some(tool_name);
            db_tool_summary = summary;
            db_tool_timestamp = Some(now.to_rfc3339());

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

    // Emit updated session list to frontend, sorted newest first
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app_handle.emit("session-update", &session_list);
    crate::tray::update_tray(app_handle, &session_list);

    // DB persistence (best-effort, non-blocking)

    if let (Some(tn), Some(ts)) = (db_tool_name, db_tool_timestamp) {
        // PostToolUse: save session + tool event in one blocking call to avoid FK race
        if let Some(started_at) = session_started_at {
            let sc = state.clone();
            let sid = session_id.clone();
            let cwd_clone = cwd.clone();
            let sum = db_tool_summary;
            tokio::task::spawn_blocking(move || {
                let db = sc.db.lock().unwrap();
                crate::db::save_session(&db, &sid, &cwd_clone, &started_at);
                crate::db::save_tool_event(&db, &sid, &tn, sum.as_deref(), &ts);
            });
        }
    } else if event_name != "SessionEnd" {
        // Non-PostToolUse, non-SessionEnd: ensure session row exists
        if let Some(started_at) = session_started_at {
            let sc = state.clone();
            let sid = session_id.clone();
            let cwd_clone = cwd.clone();
            tokio::task::spawn_blocking(move || {
                let db = sc.db.lock().unwrap();
                crate::db::save_session(&db, &sid, &cwd_clone, &started_at);
            });
        }
    }

    // 3. End session in DB
    if event_name == "SessionEnd" {
        let sc = state.clone();
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || {
            let db = sc.db.lock().unwrap();
            crate::db::end_session(&db, &sid, &chrono::Utc::now().to_rfc3339());
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::db;

    #[test]
    fn db_persistence_roundtrip() {
        let conn = db::init_memory();
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
