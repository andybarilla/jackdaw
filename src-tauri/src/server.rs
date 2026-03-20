use axum::{extract::State as AxumState, http::StatusCode, routing::post, Json, Router};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::state::{extract_summary, AppState, HookPayload, Session, ToolEvent};
use chrono::Utc;

pub async fn start_server(app_handle: AppHandle, state: Arc<AppState>) {
    let app = Router::new()
        .route("/events", post(handle_event))
        .with_state((app_handle, state.clone()));

    let addr = format!("127.0.0.1:{}", state.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Jackdaw: failed to bind port {}: {}", state.port, e);
            return;
        }
    };

    eprintln!("Jackdaw: listening on {}", addr);

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Jackdaw: server error: {}", e);
    }
}

async fn handle_event(
    AxumState((app_handle, state)): AxumState<(AppHandle, Arc<AppState>)>,
    Json(payload): Json<HookPayload>,
) -> StatusCode {
    let session_id = payload.session_id;
    let cwd = payload.cwd;
    let event_name = payload.hook_event_name;

    let mut sessions = state.sessions.lock().unwrap();

    // Ensure session exists for any event (except Stop).
    // This makes sessions visible even if we missed SessionStart.
    // Mark as processing since any event means the session is active.
    if event_name != "Stop" {
        let session = sessions
            .entry(session_id.clone())
            .or_insert_with(|| Session::new(session_id.clone(), cwd.clone()));
        session.processing = true;
    }

    match event_name.as_str() {
        "SessionStart" => {
            // Session already created above via entry().or_insert_with()
        }
        "Stop" => {
            // Clear processing before removing so tray counts are correct
            if let Some(session) = sessions.get_mut(&session_id) {
                session.processing = false;
            }
            sessions.remove(&session_id);
        }
        "PreToolUse" => {
            let tool_name = match payload.tool_name {
                Some(name) => name,
                None => return StatusCode::BAD_REQUEST,
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
                session.set_current_tool(tool_event);
            }
        }
        "PostToolUse" => {
            let tool_name = match payload.tool_name {
                Some(name) => name,
                None => return StatusCode::BAD_REQUEST,
            };
            let summary = extract_summary(&tool_name, &payload.tool_input);
            let tool_event = ToolEvent {
                tool_name,
                timestamp: Utc::now(),
                summary,
                tool_use_id: payload.tool_use_id.clone(),
            };

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
            // permission_prompt notification means session is waiting for user approval
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
        _ => {
            // Unknown event — still emit update since session was ensured above
        }
    }

    // Emit updated session list to frontend, sorted newest first
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app_handle.emit("session-update", &session_list);
    crate::tray::update_tray(&app_handle, &session_list);

    StatusCode::OK
}
