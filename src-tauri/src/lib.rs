pub mod db;
mod hooks;
pub mod ipc;
mod notify;
pub mod send;
mod server;
mod state;
mod tray;

use chrono::Utc;
use state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn dismiss_session(session_id: String, state: tauri::State<'_, Arc<AppState>>, app: AppHandle) {
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

    tauri::Builder::default()
        .manage(app_state.clone())
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

            Ok(())
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            dismiss_session,
            check_hooks_status,
            install_hooks,
            uninstall_hooks,
            get_session_history,
            get_retention_days,
            set_retention_days,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
