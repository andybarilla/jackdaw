# HTTP API

Optional HTTP server for remote monitoring of Jackdaw sessions. Runs as a tokio task within the existing Jackdaw daemon, sharing `Arc<AppState>` with the IPC socket server. Built on axum.

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/health` | Health check | No |
| `GET` | `/api/sessions` | List all sessions | Yes |
| `GET` | `/api/sessions/:id` | Get single session | Yes |
| `GET` | `/api/status` | Aggregate status counts | Yes |
| `POST` | `/api/sessions/:id/dismiss` | Dismiss a session | Yes |
| `POST` | `/api/sessions/:id/read` | Mark session as read | Yes |
| `GET` | `/api/subscribe` | SSE stream of session updates | Yes |

### Response format

Endpoints return JSON directly — no wrapper envelope. HTTP status codes convey success/failure:

- `200` — success, body is the resource
- `401` — invalid or missing bearer token: `{"error": "invalid or missing token"}`
- `404` — session or route not found: `{"error": "session not found: <id>"}` or `{"error": "not found"}`

### Health check

`GET /api/health` returns `{"ok": true}` with no authentication. Used for network reachability checks.

### SSE stream

`GET /api/subscribe` opens a Server-Sent Events stream. Each state change emits:

```
event: session-update
data: <Session[] JSON>

```

The payload matches the Tauri `session-update` event — full `Session[]` sorted by `started_at` descending. The handler subscribes to the existing `state.subscriber_tx` broadcast channel.

## Route handlers

Each REST handler is a thin translation layer calling existing `api.rs` functions:

- `GET /api/sessions` → `api::handle_query("list_sessions", &None, &state)`
- `GET /api/sessions/:id` → `api::handle_query("get_session", &Some(json!({"session_id": id})), &state)`
- `GET /api/status` → `api::handle_query("get_status", &None, &state)`
- `POST /api/sessions/:id/dismiss` → `api::handle_action("dismiss_session", &Some(json!({"session_id": id})), &state)`
- `POST /api/sessions/:id/read` → `api::handle_action("mark_session_read", &Some(json!({"session_id": id})), &state)`

The SSE handler does not go through `api.rs` — it directly subscribes to `state.subscriber_tx`.

## Authentication

Bearer token auth on all endpoints except `/api/health`.

### Token generation

On startup, if `~/.jackdaw/api-token` does not exist, Jackdaw generates a random 32-byte hex token and writes it to that path with `0600` permissions (owner-only). The token is loaded once into memory at server start.

### Token validation

Every request (except health) must include `Authorization: Bearer <token>`. Implemented as an axum middleware layer that checks the header before routing. Returns `401` on failure.

### Token rotation

Delete `~/.jackdaw/api-token` and restart Jackdaw. A new token is generated automatically.

## Module structure

New file: `src-tauri/src/http.rs`

Contains:
- `start_http_server(state: Arc<AppState>)` — reads config from store, generates/loads token, binds axum server
- `auth_middleware` — tower middleware layer for bearer token validation
- Route handler functions (one per endpoint)
- SSE handler function

## Integration

Spawned in `lib.rs` setup, alongside the IPC server:

```rust
let http_state = app_state.clone();
let http_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    http::start_http_server(http_state, http_handle).await;
});
```

The `AppHandle` is passed so the HTTP module can read settings from the Tauri store.

## Configuration

Stored in Tauri settings store (`settings.json`) under `http_api`:

```json
{
  "http_api": {
    "enabled": false,
    "port": 7456,
    "bind_address": "127.0.0.1"
  }
}
```

- **enabled** — `false` by default. HTTP server only starts when `true`.
- **port** — default `7456`.
- **bind_address** — default `127.0.0.1`. Setting to `0.0.0.0` exposes to the network.

Config is read once at startup. Changes require restart.

## Frontend settings UI

A new section in settings with:

- **Enable HTTP API** toggle (default: off)
- **Port** number input (default: 7456)
- **Bind address** text input (default: 127.0.0.1), with a warning when set to `0.0.0.0`
- **API token** read-only field with copy button, shown only when enabled
- **"Restart required"** hint shown after any change

## Dependencies

Add to `src-tauri/Cargo.toml`:

- `axum` — HTTP framework
- `axum-extra` (feature `sse`) — SSE support if not in axum core
- `tower-http` (feature `cors`) — CORS middleware for browser clients
- `rand` — token generation (may already be a transitive dependency)

## Testing

### Rust unit tests

- Token file generation: creates file with correct permissions when missing
- Token file loading: reads existing token
- Auth middleware: rejects missing header, wrong token; accepts valid token
- Route handlers: correct status codes and JSON for each endpoint (using axum's test utilities)
- SSE: subscriber receives broadcast messages

### Integration tests

- Full HTTP request/response cycle against a running server
- SSE stream receives updates when session state changes

## Not in scope

- Hot-reload of config (restart required)
- HTTPS/TLS (use a reverse proxy or tunnel)
- `register_session`, `set_metadata`, `open_session_shell`, `close_session_shell` endpoints (tool-integration APIs, not monitoring)
- Team aggregation (future feature that builds on this)
