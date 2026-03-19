mod hooks;
mod server;
mod state;
mod tray;

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
}

#[tauri::command]
fn check_hooks_status(
    scope: hooks::HookScope,
    cwd: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<hooks::HookStatus, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let settings = hooks::read_settings(&path)?;
    Ok(hooks::check_status(&settings, state.port))
}

#[tauri::command]
fn install_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::install(&mut settings, state.port)?;
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
    let app_state = Arc::new(AppState::new(9876));

    tauri::Builder::default()
        .manage(app_state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(handle, state).await;
            });
            tray::create_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![dismiss_session, check_hooks_status, install_hooks, uninstall_hooks])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
