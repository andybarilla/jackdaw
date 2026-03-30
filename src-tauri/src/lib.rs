pub mod api;
pub mod db;
mod hooks;
pub mod ipc;
mod notify;
pub mod pty;
pub mod send;
mod server;
pub mod state;
mod tray;
pub mod updater;

use base64::Engine;
use chrono::Utc;
use state::{AppState, Session, SessionSource};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn dismiss_session(
    session_id: String,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
    app: AppHandle,
) {
    pty_mgr.close(&session_id);

    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    let db = state.db.lock().unwrap();
    db::end_session(&db, &session_id, &Utc::now().to_rfc3339());
}

#[tauri::command]
fn get_session_history(
    limit: u32,
    offset: u32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Vec<db::HistorySession> {
    let db = state.db.lock().unwrap();
    db::load_history(&db, limit, offset)
}

#[tauri::command]
fn get_retention_days(state: tauri::State<'_, Arc<AppState>>) -> u32 {
    let db = state.db.lock().unwrap();
    db::get_retention_days(&db)
}

#[tauri::command]
fn set_retention_days(days: u32, state: tauri::State<'_, Arc<AppState>>) {
    let db = state.db.lock().unwrap();
    db::set_retention_days(&db, days);
}

#[tauri::command]
fn mark_session_read(session_id: String, state: tauri::State<'_, Arc<AppState>>) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.has_unread = false;
    }
}

#[tauri::command]
fn check_hooks_status(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<hooks::HookStatus, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let settings = hooks::read_settings(&path)?;
    Ok(hooks::check_status(&settings))
}

#[tauri::command]
fn install_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::install(&mut settings)?;
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks installed to {}", path.display()))
}

#[tauri::command]
fn uninstall_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::uninstall(&mut settings);
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks removed from {}", path.display()))
}

#[tauri::command]
async fn spawn_terminal(
    cwd: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let sid = session_id.clone();

    // Pre-create the session so it appears in the UI immediately
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new(sid.clone(), cwd.clone());
        session.source = SessionSource::Spawned;
        sessions.insert(sid.clone(), session);
    }

    // Emit updated session list
    {
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let _ = app.emit("session-update", &session_list);
        crate::tray::update_tray(&app, &session_list);
    }

    let pty_mgr_inner = pty_mgr.inner().clone();
    let cwd_clone = cwd.clone();
    let sid_for_env = sid.clone();
    let sid_for_spawn = sid.clone();

    let reader = tokio::task::spawn_blocking(move || {
        pty_mgr_inner.spawn(
            sid_for_spawn,
            &cwd_clone,
            80,
            24,
            "claude",
            &[],
            &[("JACKDAW_SPAWNED_SESSION", &sid_for_env)],
        )
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))??;

    // Spawn background thread to read PTY output and emit events
    let app_clone = app.clone();
    let sid_for_reader = session_id.clone();
    let pty_mgr_for_exit = pty_mgr.inner().clone();

    std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let engine = base64::engine::general_purpose::STANDARD;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded = engine.encode(&buf[..n]);
                    let _ = app_clone.emit(
                        "terminal-output",
                        serde_json::json!({
                            "session_id": sid_for_reader,
                            "data": encoded,
                        }),
                    );
                }
                Err(_) => break,
            }
        }

        let exit_code = pty_mgr_for_exit.try_wait(&sid_for_reader).ok().flatten();

        let _ = app_clone.emit(
            "terminal-exited",
            serde_json::json!({
                "session_id": sid_for_reader,
                "exit_code": exit_code,
            }),
        );
    });

    Ok(session_id)
}

#[tauri::command]
fn write_terminal(
    session_id: String,
    data: String,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("invalid base64: {}", e))?;
    pty_mgr.write(&session_id, &bytes)
}

#[tauri::command]
fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<(), String> {
    pty_mgr.resize(&session_id, cols, rows)
}

#[tauri::command]
fn close_terminal(
    session_id: String,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    pty_mgr.close(&session_id);

    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    Ok(())
}

#[tauri::command]
fn get_recent_cwds(state: tauri::State<'_, Arc<AppState>>) -> Vec<String> {
    let db = state.db.lock().unwrap();
    db::load_recent_cwds(&db, 20)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = {
        let home = dirs::home_dir().expect("could not determine home directory");
        home.join(".jackdaw").join("jackdaw.db")
    };
    let db_conn = db::init(&db_path);

    {
        let retention = db::get_retention_days(&db_conn);
        db::prune_old_sessions(&db_conn, retention);
    }

    let app_state = Arc::new(AppState::new(db_conn));
    let pty_manager = Arc::new(pty::PtyManager::new());

    tauri::Builder::default()
        .manage(app_state.clone())
        .manage(pty_manager)
        .manage(updater::UpdateState::new())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(handle, state).await;
            });
            tray::create_tray(app.handle())?;

            // Request notification permission if not already granted (required on macOS)
            {
                use tauri::plugin::PermissionState;
                use tauri_plugin_notification::NotificationExt;
                let notification = app.notification();
                if notification.permission_state().unwrap_or(PermissionState::Prompt)
                    != PermissionState::Granted
                {
                    let _ = notification.request_permission();
                }
            }

            updater::spawn_update_check_loop(app.handle().clone());

            Ok(())
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            dismiss_session,
            mark_session_read,
            check_hooks_status,
            install_hooks,
            uninstall_hooks,
            get_session_history,
            get_retention_days,
            set_retention_days,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            get_recent_cwds,
            updater::check_for_update,
            updater::install_update,
            updater::set_auto_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
