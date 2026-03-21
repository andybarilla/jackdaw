use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::state::Session;

const TRAY_ID: &str = "jackdaw-tray";

// Embed icons at compile time so they work in bundled apps
const ICON_GREEN: &[u8] = include_bytes!("../../static/icons/tray-green.png");
const ICON_YELLOW: &[u8] = include_bytes!("../../static/icons/tray-yellow.png");
const ICON_GRAY: &[u8] = include_bytes!("../../static/icons/tray-gray.png");

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
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &hooks_submenu, &separator, &settings, &quit])
        .build()?;

    let icon = Image::from_bytes(ICON_GRAY).expect("embedded gray icon");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Jackdaw — idle")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
            "quit" => {
                app.exit(0);
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
                        let _ = window.show();
                        let _ = window.set_focus();
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

    let (running, waiting) = compute_tray_state(sessions);
    let total = sessions.len();

    let (icon_bytes, tooltip) = if total == 0 {
        (ICON_GRAY, "Jackdaw — idle".to_string())
    } else if running > 0 {
        (
            ICON_GREEN,
            format!("Jackdaw — {} running, {} waiting", running, waiting),
        )
    } else {
        (
            ICON_YELLOW,
            format!("Jackdaw — {} waiting", waiting),
        )
    };

    if let Ok(icon) = Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
    }
    let _ = tray.set_tooltip(Some(&tooltip));
}

/// Compute running/waiting counts from session list.
pub fn compute_tray_state(sessions: &[Session]) -> (usize, usize) {
    let running = sessions.iter().filter(|s| s.current_tool.is_some() || s.active_subagents > 0 || s.processing).count();
    let waiting = sessions.iter().filter(|s| s.current_tool.is_none() && s.active_subagents == 0 && !s.processing).count();
    (running, waiting)
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
        assert_eq!(compute_tray_state(&[]), (0, 0));
    }

    #[test]
    fn tray_state_all_running() {
        let sessions = vec![running_session_with_tool(), running_session_with_subagents()];
        assert_eq!(compute_tray_state(&sessions), (2, 0));
    }

    #[test]
    fn tray_state_all_waiting() {
        let sessions = vec![idle_session(), idle_session()];
        assert_eq!(compute_tray_state(&sessions), (0, 2));
    }

    #[test]
    fn tray_state_mixed() {
        let sessions = vec![running_session_with_tool(), idle_session(), running_session_processing()];
        assert_eq!(compute_tray_state(&sessions), (2, 1));
    }

    #[test]
    fn tray_state_pending_only_counts_as_waiting() {
        let sessions = vec![pending_only_session()];
        assert_eq!(compute_tray_state(&sessions), (0, 1));
    }
}
