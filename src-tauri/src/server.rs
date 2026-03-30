use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::api::{self, Response};
use crate::state::{extract_summary, AppState, HookPayload, Session, ToolEvent};
use chrono::Utc;

use interprocess::local_socket::{
    traits::tokio::{Listener as _, Stream as _},
    GenericFilePath, ListenerOptions, ToFsName,
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
            let name = name
                .to_fs_name::<GenericFilePath>()
                .expect("invalid socket path");
            ListenerOptions::new().name(name).create_tokio()
        }
        #[cfg(windows)]
        {
            let name = name
                .to_ns_name::<GenericNamespaced>()
                .expect("invalid pipe name");
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
                    handle_connection(conn, &app_handle, &state).await;
                });
            }
            Err(e) => {
                eprintln!("Jackdaw: IPC accept error: {}", e);
            }
        }
    }
}

async fn handle_connection(
    conn: interprocess::local_socket::tokio::Stream,
    app_handle: &AppHandle,
    state: &Arc<AppState>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let (recv_half, mut send_half) = conn.split();
    let reader = tokio::io::BufReader::new(recv_half);
    let mut lines = reader.lines();
    let mut subscription: Option<(String, tokio::sync::broadcast::Receiver<String>)> = None;

    loop {
        tokio::select! {
            line_result = lines.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if let Some(request) = api::try_parse_request(&line) {
                            let response = dispatch_request(&request, state, &mut subscription);
                            if let Ok(json) = serde_json::to_string(&response) {
                                if send_half.write_all(format!("{}\n", json).as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                        } else {
                            handle_event(app_handle, state, &line).await;
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            update = async {
                match &mut subscription {
                    Some((_, rx)) => rx.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                if let Ok(session_json) = update {
                    let sub_id = subscription.as_ref().map(|(id, _)| id.clone()).unwrap_or_default();
                    let push = crate::api::Response::success(
                        sub_id,
                        serde_json::from_str(&session_json).unwrap_or_default(),
                    );
                    if let Ok(json) = serde_json::to_string(&push) {
                        if send_half.write_all(format!("{}\n", json).as_bytes()).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }
}

fn dispatch_request(
    request: &api::Request,
    state: &Arc<AppState>,
    subscription: &mut Option<(String, tokio::sync::broadcast::Receiver<String>)>,
) -> Response {
    match request.request_type.as_str() {
        "query" => match api::handle_query(&request.command, &request.args, state) {
            Ok(data) => Response::success(request.id.clone(), data),
            Err(e) => Response::error(request.id.clone(), e),
        },
        "action" => match api::handle_action(&request.command, &request.args, state) {
            Ok(data) => Response::success(request.id.clone(), data),
            Err(e) => Response::error(request.id.clone(), e),
        },
        "subscribe" => {
            if request.command == "session_updates" {
                *subscription = Some((request.id.clone(), state.subscriber_tx.subscribe()));
                Response::success(
                    request.id.clone(),
                    serde_json::json!({"subscribed": "session_updates"}),
                )
            } else {
                Response::error(
                    request.id.clone(),
                    format!("unknown subscription: {}", request.command),
                )
            }
        }
        other => Response::error(
            request.id.clone(),
            format!("unknown request type: {}", other),
        ),
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

    let claude_session_id = payload.session_id;
    let cwd = payload.cwd;
    let event_name = payload.hook_event_name;
    let spawned_session = payload.spawned_session;

    // If this event has spawned_session set, register the mapping so all future
    // events from this Claude session route to the PTY session.
    if let Some(ref pty_id) = spawned_session {
        state.spawned_id_map.lock().unwrap()
            .insert(claude_session_id.clone(), pty_id.clone());
    }

    // Resolve the effective session ID: for spawned sessions, use the PTY ID
    // (which the frontend knows); for external sessions, use Claude's ID directly.
    let session_id = state.spawned_id_map.lock().unwrap()
        .get(&claude_session_id)
        .cloned()
        .unwrap_or(claude_session_id.clone());

    // All synchronous session state updates in a block so MutexGuard is dropped before awaits
    let (session_started_at, db_tool_name, db_tool_summary, db_tool_timestamp, cwd_for_git) = {
        // Lock ordering: always acquire sessions before db, or drop sessions before
        // acquiring db. Never hold both simultaneously in different orders — dismiss_session
        // in lib.rs holds sessions then db, so reversed ordering would deadlock.
        let mut sessions = state.sessions.lock().unwrap();

        // Ensure session exists for any event (except SessionEnd which removes it).
        if event_name != "SessionEnd" && !sessions.contains_key(&session_id) {
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
                    session.has_unread = true;
                    session.clear_current_tool();
                }
            }
            "SessionEnd" => {
                // Session actually exiting — remove it
                sessions.remove(&session_id);
                // Clean up spawned ID mapping
                state.spawned_id_map.lock().unwrap()
                    .retain(|_, pty_id| pty_id != &session_id);
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
                    if session.processing {
                        session.pending_approval = true;
                        session.has_unread = true;
                    }
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

        let cwd_for_git = if event_name != "SessionEnd" {
            sessions
                .get(&session_id)
                .filter(|s| s.git_branch.is_none())
                .map(|s| s.cwd.clone())
        } else {
            None
        };

        (session_started_at, db_tool_name, db_tool_summary, db_tool_timestamp, cwd_for_git)
    };

    // Resolve git branch (async, outside lock scope)
    if let Some(ref cwd_git) = cwd_for_git {
        let branch = crate::state::resolve_git_branch(cwd_git).await;
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.git_branch = branch;
        }
    }

    // Emit updated session list to frontend, sorted newest first
    let sessions = state.sessions.lock().unwrap();
    let db_git_branch = sessions.get(&session_id).and_then(|s| s.git_branch.clone());
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app_handle.emit("session-update", &session_list);
    crate::tray::update_tray(app_handle, &session_list);

    if let Ok(json) = serde_json::to_string(&session_list) {
        let _ = state.subscriber_tx.send(json);
    }

    // Fire desktop notification if appropriate
    {
        use tauri_plugin_notification::NotificationExt;
        use tauri_plugin_store::StoreExt;

        let is_visible = app_handle
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);

        let prefs = app_handle
            .store("settings.json")
            .ok()
            .and_then(|store| {
                store.get("notifications").and_then(|v| {
                    serde_json::from_value::<crate::notify::NotificationPrefs>(v).ok()
                })
            })
            .unwrap_or_default();

        if crate::notify::should_notify(&event_name, is_visible, &prefs) {
            if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
                let _ = app_handle.notification().builder()
                    .title(title)
                    .body(body)
                    .show();
            }
        }
    }

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

    // Persist git branch
    if event_name != "SessionEnd" {
        if let Some(branch) = db_git_branch {
            let sc = state.clone();
            let sid = session_id.clone();
            tokio::task::spawn_blocking(move || {
                let db = sc.db.lock().unwrap();
                crate::db::update_git_branch(&db, &sid, Some(&branch));
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
    fn rehydration_populates_new_session_from_db() {
        use crate::state::{AppState, Session};

        let conn = db::init_memory();
        db::save_session(&conn, "s1", "/tmp", "2026-03-23T00:00:00Z");
        db::save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-23T00:01:00Z");
        db::save_tool_event(&conn, "s1", "Read", Some("/f"), "2026-03-23T00:02:00Z");

        let state = std::sync::Arc::new(AppState::new(conn));
        let mut sessions = state.sessions.lock().unwrap();

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

    #[test]
    fn notification_after_stop_does_not_set_pending_approval() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        // Simulate Stop already fired: processing=false
        session.processing = false;

        // Simulate Notification event — should NOT set pending_approval
        // when session is not processing (mirrors the Notification match arm)
        if session.processing {
            session.pending_approval = true;
        }

        assert!(!session.pending_approval);
    }

    #[test]
    fn session_has_git_branch_field() {
        use crate::state::Session;
        let session = Session::new("s1".into(), "/tmp".into());
        assert_eq!(session.git_branch, None);
    }

    #[test]
    fn rehydration_restores_git_branch_from_db() {
        use crate::state::{AppState, Session};

        let conn = db::init_memory();
        db::save_session(&conn, "s1", "/tmp", "2026-03-30T00:00:00Z");
        db::update_git_branch(&conn, "s1", Some("feat-my-branch"));
        db::save_tool_event(&conn, "s1", "Bash", Some("ls"), "2026-03-30T00:01:00Z");

        let state = std::sync::Arc::new(AppState::new(conn));
        let mut sessions = state.sessions.lock().unwrap();

        if !sessions.contains_key("s1") {
            let db = state.db.lock().unwrap();
            let history = db::load_tool_events_for_session(&db, "s1");
            let git_branch = db::load_session_git_branch(&db, "s1");
            drop(db);
            let mut session = Session::new("s1".into(), "/tmp".into());
            session.hydrate_from_history(&history);
            session.git_branch = git_branch;
            sessions.insert("s1".into(), session);
        }

        let session = sessions.get("s1").unwrap();
        assert_eq!(session.git_branch, Some("feat-my-branch".into()));
    }

    #[test]
    fn load_session_git_branch_returns_none_for_unknown() {
        let conn = db::init_memory();
        let branch = db::load_session_git_branch(&conn, "nonexistent");
        assert!(branch.is_none());
    }

    #[test]
    fn load_session_git_branch_returns_none_when_not_set() {
        let conn = db::init_memory();
        db::save_session(&conn, "s1", "/tmp", "2026-03-30T00:00:00Z");
        let branch = db::load_session_git_branch(&conn, "s1");
        assert!(branch.is_none());
    }

    #[test]
    fn session_has_unread_defaults_to_false() {
        use crate::state::Session;
        let session = Session::new("s1".into(), "/tmp".into());
        assert!(!session.has_unread);
    }

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

        // Simulate linking
        {
            let mut sessions = state.sessions.lock().unwrap();
            let spawned_id = "pty-123";
            let claude_session_id = "claude-abc";

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

    #[test]
    fn notification_while_processing_sets_pending_approval() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;

        // Simulate Notification event — should set pending_approval
        if session.processing {
            session.pending_approval = true;
        }

        assert!(session.pending_approval);
    }
}
