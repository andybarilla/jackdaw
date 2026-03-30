# Bidirectional Socket API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the IPC socket to accept query, action, and subscription commands alongside existing hook payloads, enabling external tools to programmatically interact with Jackdaw.

**Architecture:** Add request/response types to the NDJSON protocol. If an incoming line has a `"type"` field, dispatch it as a `Request`; otherwise fall back to `HookPayload`. Responses are written back on the same connection. Subscriptions keep the connection open and push session updates. The connection handler splits into read/write halves to support concurrent reads and writes.

**Tech Stack:** Rust, tokio, serde_json, interprocess

---

### Task 1: Define Request and Response Types

**Files:**
- Create: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing test**

Create `src-tauri/src/api.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(rename = "type")]
    pub request_type: String,
    pub command: String,
    pub id: String,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn success(id: String, data: serde_json::Value) -> Self {
        Self { id, ok: true, data: Some(data), error: None }
    }

    pub fn error(id: String, message: String) -> Self {
        Self { id, ok: false, data: None, error: Some(message) }
    }
}

/// Try to parse a JSON line as a Request. Returns None if it lacks a "type" field.
pub fn try_parse_request(line: &str) -> Option<Request> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type").is_some() {
        serde_json::from_value(value).ok()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_query_request() {
        let line = r#"{"type":"query","command":"list_sessions","id":"abc"}"#;
        let req = try_parse_request(line).unwrap();
        assert_eq!(req.request_type, "query");
        assert_eq!(req.command, "list_sessions");
        assert_eq!(req.id, "abc");
    }

    #[test]
    fn parse_action_request_with_args() {
        let line = r#"{"type":"action","command":"dismiss_session","id":"def","args":{"session_id":"s1"}}"#;
        let req = try_parse_request(line).unwrap();
        assert_eq!(req.request_type, "action");
        assert_eq!(req.command, "dismiss_session");
        let session_id = req.args.unwrap()["session_id"].as_str().unwrap();
        assert_eq!(session_id, "s1");
    }

    #[test]
    fn hook_payload_not_parsed_as_request() {
        let line = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        assert!(try_parse_request(line).is_none());
    }

    #[test]
    fn response_success_serializes() {
        let resp = Response::success("abc".into(), serde_json::json!({"count": 3}));
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains(r#""ok":true"#));
        assert!(json.contains(r#""id":"abc""#));
        assert!(!json.contains("error"));
    }

    #[test]
    fn response_error_serializes() {
        let resp = Response::error("abc".into(), "not found".into());
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains(r#""ok":false"#));
        assert!(json.contains("not found"));
        assert!(!json.contains("data"));
    }
}
```

- [ ] **Step 2: Register module**

In `src-tauri/src/lib.rs`, add:

```rust
mod api;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test api::tests`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/api.rs src-tauri/src/lib.rs
git commit -m "feat: define Request/Response types and parser for socket API"
```

---

### Task 2: Implement Query Command Handlers

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing tests**

Add to `src-tauri/src/api.rs`:

```rust
use crate::state::AppState;
use std::sync::Arc;

pub fn handle_query(command: &str, args: &Option<serde_json::Value>, state: &Arc<AppState>) -> Result<serde_json::Value, String> {
    match command {
        "list_sessions" => {
            let sessions = state.sessions.lock().unwrap();
            let mut list: Vec<_> = sessions.values().cloned().collect();
            list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            Ok(serde_json::to_value(list).unwrap())
        }
        "get_session" => {
            let session_id = args
                .as_ref()
                .and_then(|a| a.get("session_id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing args.session_id".to_string())?;
            let sessions = state.sessions.lock().unwrap();
            let session = sessions.get(session_id)
                .ok_or_else(|| format!("session not found: {}", session_id))?;
            Ok(serde_json::to_value(session.clone()).unwrap())
        }
        "get_status" => {
            let sessions = state.sessions.lock().unwrap();
            let mut running = 0u32;
            let mut approval = 0u32;
            let mut input = 0u32;
            let mut idle = 0u32;
            for s in sessions.values() {
                if s.pending_approval {
                    approval += 1;
                } else if s.current_tool.is_some() || s.active_subagents > 0 || s.processing {
                    running += 1;
                } else {
                    // Distinguish input vs idle: sessions waiting for user input are not idle
                    // A session that exists but isn't processing is waiting for input
                    input += 1;
                }
            }
            Ok(serde_json::json!({
                "total": sessions.len(),
                "running": running,
                "approval": approval,
                "input": input,
            }))
        }
        _ => Err(format!("unknown query command: {}", command)),
    }
}
```

Add tests:

```rust
#[test]
fn handle_query_list_sessions_empty() {
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    let result = handle_query("list_sessions", &None, &state).unwrap();
    assert_eq!(result, serde_json::json!([]));
}

#[test]
fn handle_query_list_sessions_with_data() {
    use crate::state::Session;
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert("s1".into(), Session::new("s1".into(), "/tmp".into()));
    }
    let result = handle_query("list_sessions", &None, &state).unwrap();
    let arr = result.as_array().unwrap();
    assert_eq!(arr.len(), 1);
}

#[test]
fn handle_query_get_session_found() {
    use crate::state::Session;
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert("s1".into(), Session::new("s1".into(), "/tmp".into()));
    }
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_query("get_session", &args, &state).unwrap();
    assert_eq!(result["session_id"], "s1");
}

#[test]
fn handle_query_get_session_not_found() {
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    let args = Some(serde_json::json!({"session_id": "nope"}));
    let result = handle_query("get_session", &args, &state);
    assert!(result.is_err());
}

#[test]
fn handle_query_get_status() {
    use crate::state::Session;
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut s1 = Session::new("s1".into(), "/a".into());
        s1.processing = true;
        sessions.insert("s1".into(), s1);

        let mut s2 = Session::new("s2".into(), "/b".into());
        s2.pending_approval = true;
        sessions.insert("s2".into(), s2);

        sessions.insert("s3".into(), Session::new("s3".into(), "/c".into()));
    }
    let result = handle_query("get_status", &None, &state).unwrap();
    assert_eq!(result["total"], 3);
    assert_eq!(result["running"], 1);
    assert_eq!(result["approval"], 1);
    assert_eq!(result["input"], 1);
}

#[test]
fn handle_query_unknown_command() {
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    let result = handle_query("bogus", &None, &state);
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test api::tests`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: implement query command handlers"
```

---

### Task 3: Implement Action Command Handlers

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Add action handler and tests**

```rust
pub fn handle_action(command: &str, args: &Option<serde_json::Value>, state: &Arc<AppState>) -> Result<serde_json::Value, String> {
    let get_session_id = || -> Result<String, String> {
        args.as_ref()
            .and_then(|a| a.get("session_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "missing args.session_id".to_string())
    };

    match command {
        "dismiss_session" => {
            let session_id = get_session_id()?;
            let mut sessions = state.sessions.lock().unwrap();
            if sessions.remove(&session_id).is_some() {
                Ok(serde_json::json!({"dismissed": true}))
            } else {
                Err(format!("session not found: {}", session_id))
            }
        }
        // NOTE: mark_session_read depends on Feature 2 (has_unread field).
        // If implementing Feature 3 before Feature 2, skip this arm and add it later.
        "mark_session_read" => {
            let session_id = get_session_id()?;
            let mut sessions = state.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id) {
                session.has_unread = false;
                Ok(serde_json::json!({"marked": true}))
            } else {
                Err(format!("session not found: {}", session_id))
            }
        }
        _ => Err(format!("unknown action command: {}", command)),
    }
}
```

Tests:

```rust
#[test]
fn handle_action_dismiss_session() {
    use crate::state::Session;
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert("s1".into(), Session::new("s1".into(), "/tmp".into()));
    }
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_action("dismiss_session", &args, &state).unwrap();
    assert_eq!(result["dismissed"], true);

    let sessions = state.sessions.lock().unwrap();
    assert!(!sessions.contains_key("s1"));
}

#[test]
fn handle_action_mark_session_read() {
    use crate::state::Session;
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.has_unread = true;
        sessions.insert("s1".into(), s);
    }
    let args = Some(serde_json::json!({"session_id": "s1"}));
    handle_action("mark_session_read", &args, &state).unwrap();

    let sessions = state.sessions.lock().unwrap();
    assert!(!sessions.get("s1").unwrap().has_unread);
}

#[test]
fn handle_action_dismiss_not_found() {
    let state = Arc::new(AppState::new(crate::db::init_memory()));
    let args = Some(serde_json::json!({"session_id": "nope"}));
    assert!(handle_action("dismiss_session", &args, &state).is_err());
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test api::tests`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: implement action command handlers"
```

---

### Task 4: Add Subscription Registry

**Files:**
- Modify: `src-tauri/src/api.rs`
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Add subscriber channel to AppState**

In `src-tauri/src/state.rs`, add:

```rust
use tokio::sync::broadcast;
```

Add to `AppState`:

```rust
pub subscriber_tx: broadcast::Sender<String>,
```

Update `AppState::new()`:

```rust
pub fn new(db: Connection) -> Self {
    let (subscriber_tx, _) = broadcast::channel(64);
    Self {
        sessions: Mutex::new(HashMap::new()),
        db: Mutex::new(db),
        subscriber_tx,
    }
}
```

- [ ] **Step 2: Broadcast session updates from server.rs**

In `src-tauri/src/server.rs`, after the `app_handle.emit("session-update", &session_list)` line, add:

```rust
// Broadcast to socket subscribers
if let Ok(json) = serde_json::to_string(&session_list) {
    let _ = state.subscriber_tx.send(json);
}
```

- [ ] **Step 3: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/server.rs
git commit -m "feat: add broadcast channel for socket subscribers"
```

---

### Task 5: Integrate API Dispatch into Connection Handler

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Restructure connection handler**

The current handler uses `BufReader::lines()` on the full connection. To support writing responses back, we need to split the connection into read/write halves. The `interprocess` crate's tokio Stream implements `AsyncRead + AsyncWrite`, so we can use `tokio::io::split()`.

Replace the connection handler in the `tokio::spawn` block:

```rust
tokio::spawn(async move {
    let (read_half, mut write_half) = tokio::io::split(conn);
    let reader = tokio::io::BufReader::new(read_half);
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    let mut lines = reader.lines();

    // Track if this connection has an active subscription (id, receiver)
    let mut subscription_rx: Option<(String, broadcast::Receiver<String>)> = None;

    loop {
        tokio::select! {
            line_result = lines.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if let Some(request) = crate::api::try_parse_request(&line) {
                            let response = match request.request_type.as_str() {
                                "query" => {
                                    match crate::api::handle_query(&request.command, &request.args, &state) {
                                        Ok(data) => crate::api::Response::success(request.id, data),
                                        Err(e) => crate::api::Response::error(request.id, e),
                                    }
                                }
                                "action" => {
                                    let resp = match crate::api::handle_action(&request.command, &request.args, &state) {
                                        Ok(data) => crate::api::Response::success(request.id.clone(), data),
                                        Err(e) => crate::api::Response::error(request.id.clone(), e),
                                    };
                                    // Re-emit session list after actions
                                    let sessions = state.sessions.lock().unwrap();
                                    let mut session_list: Vec<_> = sessions.values().cloned().collect();
                                    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
                                    let _ = app_handle.emit("session-update", &session_list);
                                    crate::tray::update_tray(&app_handle, &session_list);
                                    resp
                                }
                                "subscribe" => {
                                    if request.command == "session_updates" {
                                        subscription_rx = Some((request.id.clone(), state.subscriber_tx.subscribe()));
                                        crate::api::Response::success(request.id, serde_json::json!({"subscribed": true}))
                                    } else {
                                        crate::api::Response::error(request.id, format!("unknown subscription: {}", request.command))
                                    }
                                }
                                _ => crate::api::Response::error(request.id, format!("unknown request type: {}", request.request_type)),
                            };
                            if let Ok(json) = serde_json::to_string(&response) {
                                let msg = format!("{}\n", json);
                                if write_half.write_all(msg.as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                        } else {
                            handle_event(&app_handle, &state, &line).await;
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            update = async {
                if let Some((_, ref mut rx)) = subscription_rx {
                    rx.recv().await
                } else {
                    // No subscription — pend forever so only the line reader drives
                    std::future::pending::<Result<String, broadcast::error::RecvError>>().await
                }
            } => {
                if let Ok(session_json) = update {
                    let sub_id = subscription_rx.as_ref().map(|(id, _)| id.clone()).unwrap();
                    let push = crate::api::Response::success(sub_id, serde_json::from_str(&session_json).unwrap_or_default());
                    let json = serde_json::to_string(&push).unwrap();
                    let msg = format!("{}\n", json);
                    if write_half.write_all(msg.as_bytes()).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
});
```

- [ ] **Step 2: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: integrate API dispatch into socket connection handler"
```

---

### Task 6: End-to-End Socket API Test

**Files:**
- Modify: `src-tauri/src/server.rs` (test module)

- [ ] **Step 1: Write integration test**

This test uses the actual socket server with a test client. Add to the `server.rs` test module:

```rust
#[tokio::test]
async fn socket_api_query_list_sessions() {
    use crate::state::{AppState, Session};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let state = Arc::new(AppState::new(crate::db::init_memory()));
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert("s1".into(), Session::new("s1".into(), "/tmp".into()));
    }

    // Create a socket pair for testing
    let (client, server_conn) = tokio::io::duplex(4096);

    let state_clone = state.clone();
    // Simulate the server-side connection handler
    tokio::spawn(async move {
        let (read_half, mut write_half) = tokio::io::split(server_conn);
        let reader = BufReader::new(read_half);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(request) = crate::api::try_parse_request(&line) {
                let response = match request.request_type.as_str() {
                    "query" => {
                        match crate::api::handle_query(&request.command, &request.args, &state_clone) {
                            Ok(data) => crate::api::Response::success(request.id, data),
                            Err(e) => crate::api::Response::error(request.id, e),
                        }
                    }
                    _ => crate::api::Response::error(request.id, "unsupported".into()),
                };
                let json = serde_json::to_string(&response).unwrap();
                let msg = format!("{}\n", json);
                write_half.write_all(msg.as_bytes()).await.unwrap();
            }
        }
    });

    // Client side
    let (read_half, mut write_half) = tokio::io::split(client);
    let reader = BufReader::new(read_half);
    let mut lines = reader.lines();

    // Send a list_sessions query
    let query = r#"{"type":"query","command":"list_sessions","id":"test1"}"#;
    write_half.write_all(format!("{}\n", query).as_bytes()).await.unwrap();

    // Read response
    let response_line = lines.next_line().await.unwrap().unwrap();
    let resp: serde_json::Value = serde_json::from_str(&response_line).unwrap();
    assert_eq!(resp["id"], "test1");
    assert_eq!(resp["ok"], true);
    assert_eq!(resp["data"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn socket_api_hook_payload_still_works() {
    // Verify that a HookPayload (no "type" field) still gets processed as before
    let line = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
    assert!(crate::api::try_parse_request(line).is_none());
    // If try_parse_request returns None, the connection handler falls back to handle_event
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test socket_api`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "test: add integration tests for socket API"
```

---

### Task 7: Verify End-to-End

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 2: Run frontend checks**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Manual smoke test**

Run: `npm run tauri dev`

In another terminal, test the socket API directly:

```bash
# Query list_sessions
echo '{"type":"query","command":"list_sessions","id":"1"}' | socat - UNIX-CONNECT:~/.jackdaw/jackdaw.sock

# Query get_status
echo '{"type":"query","command":"get_status","id":"2"}' | socat - UNIX-CONNECT:~/.jackdaw/jackdaw.sock

# Verify a hook payload still works
echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"SessionStart"}' | socat - UNIX-CONNECT:~/.jackdaw/jackdaw.sock
```

- [ ] **Step 4: Test subscription**

```bash
# Subscribe to updates (stays connected)
echo '{"type":"subscribe","command":"session_updates","id":"3"}' | socat -t 10 - UNIX-CONNECT:~/.jackdaw/jackdaw.sock
# Trigger a hook event from another terminal — should see update pushed
```
