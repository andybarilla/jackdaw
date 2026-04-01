use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_updater::UpdaterExt;

use crate::state::Session;

const TRAY_ID: &str = "jackdaw-tray";

// Embed icons at compile time so they work in bundled apps
const ICON_APPROVAL: &[u8] = include_bytes!("../../static/icons/tray-approval.png");
const ICON_INPUT: &[u8] = include_bytes!("../../static/icons/tray-input.png");
const ICON_RUNNING: &[u8] = include_bytes!("../../static/icons/tray-running.png");
const ICON_IDLE: &[u8] = include_bytes!("../../static/icons/tray-idle.png");

fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{PredefinedMenuItem, SubmenuBuilder};

    let show = MenuItemBuilder::with_id("show", "Show Dashboard").build(app)?;
    let install_user = MenuItemBuilder::with_id("install_hooks_user", "User-level (global)").build(app)?;
    let uninstall = MenuItemBuilder::with_id("uninstall_hooks", "Uninstall").build(app)?;
    let hooks_submenu = SubmenuBuilder::with_id(app, "hooks_submenu", "Install Claude Hooks")
        .items(&[&install_user, &uninstall])
        .build()?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &hooks_submenu, &separator, &settings, &check_updates, &quit])
        .build()?;

    let icon = Image::from_bytes(ICON_IDLE).expect("embedded idle icon");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Jackdaw — idle")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                show_and_focus(app);
            }
            "install_hooks_user" => {
                match crate::hooks::get_settings_path(&crate::hooks::HookScope::User, None) {
                    Ok(path) => {
                        match crate::hooks::read_settings(&path) {
                            Ok(mut settings) => {
                                if let Err(e) = crate::hooks::install(&mut settings) {
                                    eprintln!("Jackdaw: failed to install hooks: {}", e);
                                    return;
                                }
                                match crate::hooks::write_settings(&path, &settings) {
                                    Ok(_) => {
                                        if let Some(tray) = app.tray_by_id(TRAY_ID) {
                                            let _ = tray.set_tooltip(Some("Jackdaw — hooks installed"));
                                        }
                                    }
                                    Err(e) => eprintln!("Jackdaw: failed to install hooks: {}", e),
                                }
                            }
                            Err(e) => eprintln!("Jackdaw: failed to read settings: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Jackdaw: failed to resolve settings path: {}", e),
                }
            }
            "uninstall_hooks" => {
                match crate::hooks::get_settings_path(&crate::hooks::HookScope::User, None) {
                    Ok(path) => {
                        match crate::hooks::read_settings(&path) {
                            Ok(mut settings) => {
                                crate::hooks::uninstall(&mut settings);
                                match crate::hooks::write_settings(&path, &settings) {
                                    Ok(_) => {
                                        if let Some(tray) = app.tray_by_id(TRAY_ID) {
                                            let _ = tray.set_tooltip(Some("Jackdaw — hooks removed"));
                                        }
                                    }
                                    Err(e) => eprintln!("Jackdaw: failed to uninstall hooks: {}", e),
                                }
                            }
                            Err(e) => eprintln!("Jackdaw: failed to read settings: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Jackdaw: failed to resolve settings path: {}", e),
                }
            }
            "settings" => {
                // TODO: open settings window (v2)
            }
            "check_updates" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let updater = match handle.updater() {
                        Ok(u) => u,
                        Err(e) => {
                            eprintln!("Jackdaw: updater error: {}", e);
                            return;
                        }
                    };
                    match updater.check().await {
                        Ok(Some(update)) => {
                            use tauri::Emitter;
                            let info = crate::updater::UpdateInfo {
                                available: true,
                                version: Some(update.version.clone()),
                                body: update.body.clone(),
                            };
                            let _ = handle.emit("update-available", &info);
                            let state = handle.state::<crate::updater::UpdateState>();
                            *state.pending.lock().await = Some(update);
                        }
                        Ok(None) => {
                            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                                let _ = tray.set_tooltip(Some("Jackdaw — up to date"));
                            }
                        }
                        Err(e) => eprintln!("Jackdaw: update check failed: {}", e),
                    }
                });
            }
            "quit" => {
                let state = app.state::<std::sync::Arc<crate::state::AppState>>();
                let busy = {
                    let sessions = state.sessions.lock().unwrap();
                    sessions.values().filter(|s| s.is_busy()).count()
                };
                if busy > 0 {
                    show_and_focus(app);
                    let _ = app.emit("confirm-close", busy);
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        show_and_focus(app);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update tray icon and tooltip based on current session state
pub fn update_tray(app: &AppHandle, sessions: &[Session]) {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(t) => t,
        None => return,
    };

    let (state, counts) = compute_tray_state(sessions);

    let icon_bytes = match state {
        TrayState::WaitingForApproval => ICON_APPROVAL,
        TrayState::WaitingForInput => ICON_INPUT,
        TrayState::Running => ICON_RUNNING,
        TrayState::Idle => ICON_IDLE,
    };

    let tooltip = if sessions.is_empty() {
        "Jackdaw — idle".to_string()
    } else {
        let mut parts = Vec::new();
        if counts.running > 0 {
            parts.push(format!("{} running", counts.running));
        }
        if counts.input > 0 {
            parts.push(format!("{} waiting for input", counts.input));
        }
        if counts.approval > 0 {
            parts.push(format!("{} waiting for approval", counts.approval));
        }
        format!("Jackdaw — {}", parts.join(", "))
    };

    if let Ok(icon) = Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
    }
    let _ = tray.set_tooltip(Some(&tooltip));
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrayState {
    WaitingForApproval,
    WaitingForInput,
    Running,
    Idle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrayStateCounts {
    pub approval: usize,
    pub input: usize,
    pub running: usize,
}

pub fn compute_tray_state(sessions: &[Session]) -> (TrayState, TrayStateCounts) {
    let mut counts = TrayStateCounts { approval: 0, input: 0, running: 0 };

    for s in sessions {
        if s.pending_approval {
            counts.approval += 1;
        } else if s.current_tool.is_none() && s.active_subagents == 0 && !s.processing {
            counts.input += 1;
        } else {
            counts.running += 1;
        }
    }

    let state = if sessions.is_empty() {
        TrayState::Idle
    } else if counts.approval > 0 {
        TrayState::WaitingForApproval
    } else if counts.input > 0 {
        TrayState::WaitingForInput
    } else {
        TrayState::Running
    };

    (state, counts)
}

/// Stub — full implementation in Task 6
pub fn start_tray_animation(_app: &AppHandle, _tier: crate::notify::AlertTier) {}

pub fn stop_tray_animation(app: &AppHandle, sessions: &[Session]) {
    update_tray(app, sessions);
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use crate::state::ToolEvent;

    fn idle_session() -> Session {
        Session::new("s1".into(), "/tmp".into())
    }

    fn running_session_with_tool() -> Session {
        let mut s = Session::new("s2".into(), "/tmp".into());
        s.set_current_tool(ToolEvent {
            tool_name: "Bash".into(),
            timestamp: Utc::now(),
            summary: None,
            tool_use_id: None,
        });
        s
    }

    fn running_session_with_subagents() -> Session {
        let mut s = Session::new("s3".into(), "/tmp".into());
        s.active_subagents = 1;
        s
    }

    fn running_session_processing() -> Session {
        let mut s = Session::new("s4".into(), "/tmp".into());
        s.processing = true;
        s
    }

    fn pending_only_session() -> Session {
        let mut s = Session::new("s5".into(), "/tmp".into());
        s.pending_approval = true;
        s
    }

    #[test]
    fn tray_state_no_sessions() {
        let (state, counts) = compute_tray_state(&[]);
        assert_eq!(state, TrayState::Idle);
        assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 0 });
    }

    #[test]
    fn tray_state_all_running() {
        let sessions = vec![running_session_with_tool(), running_session_with_subagents()];
        let (state, counts) = compute_tray_state(&sessions);
        assert_eq!(state, TrayState::Running);
        assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 2 });
    }

    #[test]
    fn tray_state_all_waiting_for_input() {
        let sessions = vec![idle_session(), idle_session()];
        let (state, counts) = compute_tray_state(&sessions);
        assert_eq!(state, TrayState::WaitingForInput);
        assert_eq!(counts, TrayStateCounts { approval: 0, input: 2, running: 0 });
    }

    #[test]
    fn tray_state_approval_wins_over_running() {
        let sessions = vec![running_session_with_tool(), pending_only_session()];
        let (state, counts) = compute_tray_state(&sessions);
        assert_eq!(state, TrayState::WaitingForApproval);
        assert_eq!(counts, TrayStateCounts { approval: 1, input: 0, running: 1 });
    }

    #[test]
    fn tray_state_input_wins_over_running() {
        let sessions = vec![running_session_with_tool(), idle_session()];
        let (state, counts) = compute_tray_state(&sessions);
        assert_eq!(state, TrayState::WaitingForInput);
        assert_eq!(counts, TrayStateCounts { approval: 0, input: 1, running: 1 });
    }

    #[test]
    fn tray_state_pending_with_tool_counts_as_approval() {
        let mut s = running_session_with_tool();
        s.pending_approval = true;
        let (state, counts) = compute_tray_state(&[s]);
        assert_eq!(state, TrayState::WaitingForApproval);
        assert_eq!(counts, TrayStateCounts { approval: 1, input: 0, running: 0 });
    }

    #[test]
    fn tray_state_processing_counts_as_running() {
        let sessions = vec![running_session_processing()];
        let (state, counts) = compute_tray_state(&sessions);
        assert_eq!(state, TrayState::Running);
        assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 1 });
    }
}
