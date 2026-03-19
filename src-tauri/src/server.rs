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
            // TODO: emit error to frontend / show notification
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
    // Clone fields upfront to avoid ownership issues with HashMap::entry()
    let session_id = payload.session_id;
    let cwd = payload.cwd;
    let event_name = payload.hook_event_name;

    let mut sessions = state.sessions.lock().unwrap();

    match event_name.as_str() {
        "SessionStart" => {
            let session = Session::new(session_id.clone(), cwd);
            sessions.insert(session_id, session);
        }
        "SessionStop" => {
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
            };

            // Create session implicitly if SessionStart was missed
            let session = sessions
                .entry(session_id.clone())
                .or_insert_with(|| Session::new(session_id, cwd));
            session.set_current_tool(tool_event);
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
            };

            let session = sessions
                .entry(session_id.clone())
                .or_insert_with(|| Session::new(session_id, cwd));
            session.complete_current_tool(tool_event);
        }
        _ => {
            return StatusCode::BAD_REQUEST;
        }
    }

    // Emit updated session list to frontend, sorted newest first
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions); // release lock before emitting

    let _ = app_handle.emit("session-update", &session_list);
    // TODO: crate::tray::update_tray(&app_handle, &session_list); (Task 4)

    StatusCode::OK
}
