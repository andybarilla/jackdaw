use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview};
use tauri::webview::WebviewBuilder;

pub struct PreviewState {
    webview: Mutex<Option<Webview>>,
}

impl Default for PreviewState {
    fn default() -> Self {
        Self {
            webview: Mutex::new(None),
        }
    }
}

fn is_allowed_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://") || url.starts_with("file://")
}

#[tauri::command]
pub async fn preview_open(
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    app: AppHandle,
    state: tauri::State<'_, PreviewState>,
) -> Result<String, String> {
    if !is_allowed_url(&url) {
        return Err(format!("Blocked URL scheme: {url}"));
    }

    let mut webview_lock = state.webview.lock().unwrap();

    // If webview exists, navigate it
    if let Some(ref wv) = *webview_lock {
        wv.navigate(url::Url::parse(&url).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        // Reposition in case modal moved
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
        return Ok(url);
    }

    // add_child is on Window, not WebviewWindow — use get_window
    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let emit_handle = app.clone();

    let builder = WebviewBuilder::new("preview", tauri::WebviewUrl::External(parsed_url))
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            let _ = emit_handle.emit("preview-navigation", &url_str);
            let scheme = nav_url.scheme();
            scheme == "http" || scheme == "https" || scheme == "file"
        });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    *webview_lock = Some(webview);
    Ok(url)
}

#[tauri::command]
pub fn preview_reposition(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, PreviewState>,
) -> Result<(), String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
    }
    Ok(())
}

#[tauri::command]
pub fn preview_back(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        wv.eval("window.history.back()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_forward(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        wv.eval("window.history.forward()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_close(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let mut lock = state.webview.lock().unwrap();
    if let Some(wv) = lock.take() {
        let _ = wv.close();
    }
    Ok(())
}

#[tauri::command]
pub fn preview_get_url(state: tauri::State<'_, PreviewState>) -> Result<Option<String>, String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        Ok(Some(wv.url().map_err(|e| e.to_string())?.to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_allowed_url_accepts_http() {
        assert!(is_allowed_url("http://example.com"));
        assert!(is_allowed_url("https://example.com"));
        assert!(is_allowed_url("file:///home/user/page.html"));
    }

    #[test]
    fn is_allowed_url_rejects_dangerous_schemes() {
        assert!(!is_allowed_url("javascript:alert(1)"));
        assert!(!is_allowed_url("data:text/html,<h1>hi</h1>"));
        assert!(!is_allowed_url("blob:http://example.com/abc"));
        assert!(!is_allowed_url("ftp://files.example.com"));
    }
}
