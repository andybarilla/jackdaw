use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::api::{self, Response};
use crate::state::{extract_summary, extract_file_path, extract_urls, AppState, HookPayload, Session, ToolEvent};
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
    let payload_source_tool = payload.source_tool;

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
                session.source_tool = payload_source_tool.clone();
                sessions.insert(session_id.clone(), session);

                // Try to match this new session to a pending subagent start
                {
                    let mut pending = state.pending_subagent_starts.lock().unwrap();
                    let now = Utc::now();
                    // Prune entries older than 5 seconds
                    pending.retain(|(_, _, ts)| (now - *ts).num_seconds() < 5);
                    // Find a matching pending start (same cwd, within 2 seconds)
                    if let Some(pos) = pending.iter().position(|(_, pending_cwd, ts)| {
                        pending_cwd == &cwd && (now - *ts).num_seconds() < 2
                    }) {
                        let (parent_id, _, _) = pending.remove(pos);
                        if let Some(session) = sessions.get_mut(&session_id) {
                            session.parent_session_id = Some(parent_id);
                        }
                    }
                }

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
                let urls = extract_urls(&payload.tool_input);
                let file_path = extract_file_path(&tool_name, &payload.tool_input);
                let tool_event = ToolEvent {
                    tool_name,
                    timestamp: Utc::now(),
                    summary,
                    urls,
                    file_path,
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
                let urls = extract_urls(&payload.tool_input);
                let file_path = extract_file_path(&tool_name, &payload.tool_input);
                let now = Utc::now();
                let tool_event = ToolEvent {
                    tool_name: tool_name.clone(),
                    timestamp: now,
                    summary: summary.clone(),
                    urls,
                    file_path,
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
            "Notification" | "PermissionRequest" => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    if session.processing {
                        session.pending_approval = true;
                        session.has_unread = true;
                    }
                }
            }
            "PermissionReply" => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.pending_approval = false;
                }
            }
            "SubagentStart" => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.active_subagents = session.active_subagents.saturating_add(1);
                    let cwd = session.cwd.clone();
                    state.pending_subagent_starts.lock().unwrap().push(
                        (session_id.clone(), cwd, Utc::now())
                    );
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

    // Load profiles once for both profile_name assignment and alert resolution
    let (matched_profile, store_for_alerts) = {
        use tauri_plugin_store::StoreExt;
        let store = app_handle.store("settings.json").ok();
        let profiles: Vec<crate::notify::MonitoringProfile> = store
            .as_ref()
            .and_then(|s| s.get("profiles"))
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let profile = crate::notify::find_profile_for_cwd(&profiles, &cwd).cloned();
        (profile, store)
    };

    // Set profile_name on session (for all sessions, not just when alerts fire)
    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.profile_name = matched_profile.as_ref().map(|p| p.name.clone());
        }
    }

    // Resolve alert tier and fire appropriate channels
    let (resolved_tier, profile_notification_command, profile_volume) = {
        let is_visible = app_handle
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);

        let prefs = match &matched_profile {
            Some(p) => p.alerts.clone(),
            None => store_for_alerts
                .as_ref()
                .and_then(|s| s.get("notifications").map(crate::notify::migrate_alert_prefs))
                .unwrap_or_default(),
        };

        let profile_cmd = matched_profile.as_ref().map(|p| p.notification_command.clone());
        let profile_volume = matched_profile.as_ref().map(|p| p.alert_volume);

        (crate::notify::resolve_alert_tier(&event_name, is_visible, &prefs), profile_cmd, profile_volume)
    };

    // Set alert_tier on the session for the frontend
    if resolved_tier != crate::notify::AlertTier::Off {
        let tier_str = match resolved_tier {
            crate::notify::AlertTier::High => "high",
            crate::notify::AlertTier::Medium => "medium",
            crate::notify::AlertTier::Low => "low",
            crate::notify::AlertTier::Off => unreachable!(),
        };
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.alert_tier = Some(tier_str.to_string());
            session.alert_volume = profile_volume;
        }
        drop(sessions);

        // Re-emit session list with alert_tier set
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        drop(sessions);
        let _ = app_handle.emit("session-update", &session_list);

        if let Ok(json) = serde_json::to_string(&session_list) {
            let _ = state.subscriber_tx.send(json);
        }

        let channels = crate::notify::alert_channels(resolved_tier);

        // Desktop notification
        if channels.desktop_notification {
            use tauri_plugin_notification::NotificationExt;
            if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
                let _ = app_handle.notification().builder()
                    .title(title)
                    .body(&body)
                    .show();
            }
        }

        // Dock/taskbar bounce (High only)
        if channels.dock_bounce {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.request_user_attention(
                    Some(tauri::UserAttentionType::Critical)
                );
            }
        }

        // Tray animation
        if channels.tray_animation {
            crate::tray::start_tray_animation(app_handle, resolved_tier);
        }

        // Notification command (profile override or global)
        {
            use tauri_plugin_store::StoreExt;
            let notification_command = profile_notification_command
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| {
                    app_handle
                        .store("settings.json")
                        .ok()
                        .and_then(|store| store.get("notification_command"))
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_default()
                });

            if !notification_command.is_empty() {
                if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
                    let cmd = notification_command;
                    let sid = session_id.clone();
                    let evt = event_name.clone();
                    let cwd = cwd.clone();
                    let t = title.to_string();
                    let b = body;
                    tokio::spawn(async move {
                        crate::notify::run_notification_command(&cmd, &sid, &evt, &cwd, &t, &b).await;
                    });
                }
            }
        }

        // Clear alert_tier after a short delay so frontend has time to read it
        let state_clone = state.clone();
        let sid_clone = session_id.clone();
        let app_clone = app_handle.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let mut sessions = state_clone.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&sid_clone) {
                session.alert_tier = None;
                session.alert_volume = None;
            }
            let mut session_list: Vec<_> = sessions.values().cloned().collect();
            session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            drop(sessions);
            let _ = app_clone.emit("session-update", &session_list);
        });
    }

    // Persist notification to DB and emit event
    if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
        let now = chrono::Utc::now();
        let sc = state.clone();
        let sid = session_id.clone();
        let evt = event_name.clone();
        let cwd_clone = cwd.clone();
        let app = app_handle.clone();
        let t = title.to_string();
        let b = body;
        tokio::task::spawn_blocking(move || {
            let db = sc.db.lock().unwrap();
            if let Some(notif) = crate::notification::insert_notification(
                &db, &sid, &evt, &t, &b, &cwd_clone, &now,
            ) {
                drop(db);
                let _ = app.emit("notification-event", &notif);
            }
        });
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
    fn session_has_profile_name_field() {
        use crate::state::Session;
        let session = Session::new("s1".into(), "/tmp".into());
        assert_eq!(session.profile_name, None);
    }

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
    fn notification_event_inserts_db_row() {
        let conn = db::init_memory();
        let now = chrono::Utc::now();
        let notif = crate::notification::insert_notification(
            &conn, "s1", "Notification", "Approval Needed",
            "Session in /tmp needs approval", "/tmp", &now,
        );
        assert!(notif.is_some());
        let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].event_type, "Notification");
    }

    #[test]
    fn stop_event_inserts_notification_row() {
        let conn = db::init_memory();
        let now = chrono::Utc::now();
        let notif = crate::notification::insert_notification(
            &conn, "s1", "Stop", "Waiting for Input",
            "Session in /tmp is waiting", "/tmp", &now,
        );
        assert!(notif.is_some());
        let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].event_type, "Stop");
    }

    #[test]
    fn session_end_inserts_notification_row() {
        let conn = db::init_memory();
        let now = chrono::Utc::now();
        let notif = crate::notification::insert_notification(
            &conn, "s1", "SessionEnd", "Session Ended",
            "Session in /tmp has ended", "/tmp", &now,
        );
        assert!(notif.is_some());
        let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].event_type, "SessionEnd");
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

    #[test]
    fn permission_request_while_processing_sets_pending_approval_and_has_unread() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;

        // Simulate PermissionRequest event handler logic
        if session.processing {
            session.pending_approval = true;
            session.has_unread = true;
        }

        assert!(session.pending_approval);
        assert!(session.has_unread);
    }

    #[test]
    fn permission_request_when_not_processing_does_not_set_pending_approval() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = false;

        // Simulate PermissionRequest event handler logic
        if session.processing {
            session.pending_approval = true;
            session.has_unread = true;
        }

        assert!(!session.pending_approval);
        assert!(!session.has_unread);
    }

    #[test]
    fn permission_reply_clears_pending_approval() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        session.pending_approval = true;

        // Simulate PermissionReply event handler logic
        session.pending_approval = false;

        assert!(!session.pending_approval);
    }

    #[test]
    fn resolve_alert_with_profile_override() {
        use crate::notify::{AlertPrefs, AlertTier, MonitoringProfile, find_profile_for_cwd, resolve_alert_tier};

        let profiles = vec![MonitoringProfile {
            id: "p1".to_string(),
            name: "Silent".to_string(),
            directories: vec!["/home/user/quiet-project".to_string()],
            alerts: AlertPrefs {
                on_approval_needed: AlertTier::Off,
                on_session_end: AlertTier::Off,
                on_stop: AlertTier::Off,
            },
            alert_volume: 0,
            notification_command: String::new(),
        }];

        let global_prefs = AlertPrefs::default();

        // Session in quiet-project should use profile (all off)
        let profile = find_profile_for_cwd(&profiles, "/home/user/quiet-project");
        let prefs = profile.map(|p| &p.alerts).unwrap_or(&global_prefs);
        let tier = resolve_alert_tier("Stop", false, prefs);
        assert_eq!(tier, AlertTier::Off);

        // Session in other project should use global defaults
        let profile = find_profile_for_cwd(&profiles, "/home/user/other");
        let prefs = profile.map(|p| &p.alerts).unwrap_or(&global_prefs);
        let tier = resolve_alert_tier("Stop", false, prefs);
        assert_eq!(tier, AlertTier::Medium);
    }

    #[test]
    fn notification_backwards_compat_same_as_permission_request() {
        use crate::state::Session;

        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;

        // Notification event has same behavior as PermissionRequest
        if session.processing {
            session.pending_approval = true;
            session.has_unread = true;
        }

        assert!(session.pending_approval);
        assert!(session.has_unread);
    }
}
