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
    let show = MenuItemBuilder::with_id("show", "Show Dashboard").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &settings, &quit]).build()?;

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

    let running = sessions.iter().filter(|s| s.current_tool.is_some()).count();
    let waiting = sessions.iter().filter(|s| s.current_tool.is_none()).count();
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
