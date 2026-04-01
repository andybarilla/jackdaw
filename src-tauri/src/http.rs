use crate::state::AppState;
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tokio::net::TcpListener;

// ── Token ────────────────────────────────────────────────────────────────────

pub fn load_or_generate_token(path: &Path) -> std::io::Result<String> {
    if path.exists() {
        let token = std::fs::read_to_string(path)?;
        return Ok(token.trim().to_string());
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    std::fs::write(path, &token)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(token)
}

// ── Config ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HttpConfig {
    pub enabled: bool,
    pub port: u16,
    pub bind_address: String,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 7456,
            bind_address: "127.0.0.1".to_string(),
        }
    }
}

// ── Server startup ────────────────────────────────────────────────────────────

pub async fn start_http_server(state: Arc<AppState>, app_handle: tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;

    let config: HttpConfig = app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("http_api"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    if !config.enabled {
        println!("[http] HTTP API disabled");
        return;
    }

    let token_path = dirs::home_dir()
        .expect("no home dir")
        .join(".jackdaw")
        .join("api-token");

    let token = match load_or_generate_token(&token_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[http] failed to load/generate token: {}", e);
            return;
        }
    };

    let addr = format!("{}:{}", config.bind_address, config.port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[http] failed to bind {}: {}", addr, e);
            return;
        }
    };

    println!("[http] listening on {}", addr);

    let router = build_router(state, token);
    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("[http] server error: {}", e);
    }
}

// ── HTTP state ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct HttpState {
    pub app_state: Arc<AppState>,
    pub token: Arc<String>,
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async fn auth_middleware(
    State(http_state): State<HttpState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let auth_header = req.headers().get("Authorization");
    let expected = format!("Bearer {}", http_state.token);

    match auth_header.and_then(|v| v.to_str().ok()) {
        Some(value) if value == expected => next.run(req).await,
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid or missing token"})),
        )
            .into_response(),
    }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({"ok": true}))
}

async fn sessions_handler(State(http_state): State<HttpState>) -> impl IntoResponse {
    let sessions = http_state.app_state.sessions.lock().unwrap();
    let mut list: Vec<_> = sessions.values().cloned().collect();
    list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Json(serde_json::to_value(list).unwrap())
}

async fn not_found_handler() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": "not found"})),
    )
}

pub fn build_router(state: Arc<AppState>, token: String) -> Router {
    let http_state = HttpState {
        app_state: state,
        token: Arc::new(token),
    };

    let authed = Router::new()
        .route("/api/sessions", get(sessions_handler))
        .route_layer(middleware::from_fn_with_state(
            http_state.clone(),
            auth_middleware,
        ))
        .with_state(http_state.clone());

    Router::new()
        .route("/api/health", get(health_handler))
        .merge(authed)
        .fallback(not_found_handler)
        .with_state(http_state)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tower::util::ServiceExt;

    fn make_state() -> Arc<AppState> {
        Arc::new(AppState::new(crate::db::init_memory()))
    }

    // ── Task 2: Token tests ───────────────────────────────────────────────────

    #[test]
    fn generates_token_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        let token = load_or_generate_token(&path).unwrap();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(path.exists());
    }

    #[test]
    fn loads_existing_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(&path, "abcd1234efgh5678").unwrap();
        let token = load_or_generate_token(&path).unwrap();
        assert_eq!(token, "abcd1234efgh5678");
    }

    #[test]
    fn generated_tokens_are_unique() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = load_or_generate_token(&dir.path().join("t1")).unwrap();
        let t2 = load_or_generate_token(&dir.path().join("t2")).unwrap();
        assert_ne!(t1, t2);
    }

    #[cfg(unix)]
    #[test]
    fn token_file_has_restrictive_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        load_or_generate_token(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // ── Task 3: Config tests ──────────────────────────────────────────────────

    #[test]
    fn config_defaults() {
        let cfg = HttpConfig::default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.port, 7456);
        assert_eq!(cfg.bind_address, "127.0.0.1");
    }

    #[test]
    fn config_deserializes_from_json() {
        let json = r#"{"enabled": true, "port": 8080, "bind_address": "0.0.0.0"}"#;
        let cfg: HttpConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.bind_address, "0.0.0.0");
    }

    #[test]
    fn config_partial_json_uses_defaults_via_option() {
        let cfg: HttpConfig = serde_json::from_str::<Option<HttpConfig>>("null")
            .unwrap()
            .unwrap_or_default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.port, 7456);
    }

    // ── Task 4: Router / auth tests ───────────────────────────────────────────

    #[tokio::test]
    async fn health_requires_no_auth() {
        let app = build_router(make_state(), "secret".to_string());
        let req = axum::http::Request::builder()
            .uri("/api/health")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["ok"], true);
    }

    #[tokio::test]
    async fn auth_rejects_missing_token() {
        let app = build_router(make_state(), "secret".to_string());
        let req = axum::http::Request::builder()
            .uri("/api/sessions")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_rejects_wrong_token() {
        let app = build_router(make_state(), "secret".to_string());
        let req = axum::http::Request::builder()
            .uri("/api/sessions")
            .header("Authorization", "Bearer wrongtoken")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_accepts_valid_token() {
        let app = build_router(make_state(), "secret".to_string());
        let req = axum::http::Request::builder()
            .uri("/api/sessions")
            .header("Authorization", "Bearer secret")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn unknown_route_returns_404() {
        let app = build_router(make_state(), "secret".to_string());
        let req = axum::http::Request::builder()
            .uri("/api/bogus")
            .header("Authorization", "Bearer secret")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
