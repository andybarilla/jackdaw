use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

pub struct UpdateState {
    pub pending: Mutex<Option<Update>>,
    pub auto_update_enabled: AtomicBool,
}

impl UpdateState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            auto_update_enabled: AtomicBool::new(true),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    pub chunk_length: usize,
    pub content_length: Option<u64>,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(update) => {
            let info = UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
                body: update.body.clone(),
            };
            let _ = app.emit("update-available", &info);
            let state = app.state::<UpdateState>();
            *state.pending.lock().await = Some(update);
            Ok(info)
        }
        None => Ok(UpdateInfo {
            available: false,
            version: None,
            body: None,
        }),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = {
        let state = app.state::<UpdateState>();
        let result = state.pending.lock().await.take();
        result
    };

    let update = match update {
        Some(u) => u,
        None => {
            let updater = app.updater().map_err(|e| e.to_string())?;
            match updater.check().await.map_err(|e| e.to_string())? {
                Some(u) => u,
                None => return Err("No update available".into()),
            }
        }
    };

    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_handle.emit(
                    "update-progress",
                    UpdateProgress {
                        chunk_length,
                        content_length,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

#[tauri::command]
pub fn set_auto_update(enabled: bool, state: tauri::State<'_, UpdateState>) {
    state.auto_update_enabled.store(enabled, Ordering::Relaxed);
}

/// Spawns a background loop that checks for updates immediately, then every 24 hours.
pub fn spawn_update_check_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let interval = std::time::Duration::from_secs(24 * 60 * 60);
        loop {
            let enabled = {
                let state = app.state::<UpdateState>();
                state.auto_update_enabled.load(Ordering::Relaxed)
            };
            if enabled {
                if let Ok(updater) = app.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        let info = UpdateInfo {
                            available: true,
                            version: Some(update.version.clone()),
                            body: update.body.clone(),
                        };
                        let _ = app.emit("update-available", &info);
                        let state = app.state::<UpdateState>();
                        *state.pending.lock().await = Some(update);
                    }
                }
            }
            tokio::time::sleep(interval).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_state_defaults_to_auto_update_enabled() {
        let state = UpdateState::new();
        assert!(state.auto_update_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn update_state_pending_starts_none() {
        let state = UpdateState::new();
        let pending = state.pending.blocking_lock();
        assert!(pending.is_none());
    }

    #[test]
    fn auto_update_toggle() {
        let state = UpdateState::new();
        assert!(state.auto_update_enabled.load(Ordering::Relaxed));

        state.auto_update_enabled.store(false, Ordering::Relaxed);
        assert!(!state.auto_update_enabled.load(Ordering::Relaxed));

        state.auto_update_enabled.store(true, Ordering::Relaxed);
        assert!(state.auto_update_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn update_info_serializes() {
        let info = UpdateInfo {
            available: true,
            version: Some("1.2.3".to_string()),
            body: Some("Release notes".to_string()),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["available"], true);
        assert_eq!(json["version"], "1.2.3");
        assert_eq!(json["body"], "Release notes");
    }

    #[test]
    fn update_info_serializes_when_no_update() {
        let info = UpdateInfo {
            available: false,
            version: None,
            body: None,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["available"], false);
        assert!(json["version"].is_null());
        assert!(json["body"].is_null());
    }

    #[test]
    fn update_progress_serializes() {
        let progress = UpdateProgress {
            chunk_length: 1024,
            content_length: Some(10240),
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["chunk_length"], 1024);
        assert_eq!(json["content_length"], 10240);
    }

    #[test]
    fn update_progress_serializes_unknown_length() {
        let progress = UpdateProgress {
            chunk_length: 512,
            content_length: None,
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["chunk_length"], 512);
        assert!(json["content_length"].is_null());
    }
}
