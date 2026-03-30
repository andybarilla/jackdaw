use jackdaw_lib::api::{try_parse_request, Response};
use jackdaw_lib::state::AppState;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn test_state() -> (Arc<AppState>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let conn = jackdaw_lib::db::init(&db_path);
    (Arc::new(AppState::new(conn)), dir)
}

fn insert_session(state: &Arc<AppState>, id: &str) {
    use jackdaw_lib::state::Session;
    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(id.into(), Session::new(id.into(), "/tmp".into()));
}

/// Simulate the server-side dispatch loop on a duplex stream.
/// Returns the client half for the test to read/write.
fn spawn_dispatch(state: Arc<AppState>) -> tokio::io::DuplexStream {
    use jackdaw_lib::api;

    let (client, server) = tokio::io::duplex(8192);
    tokio::spawn(async move {
        let (read_half, mut write_half) = tokio::io::split(server);
        let reader = BufReader::new(read_half);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(request) = api::try_parse_request(&line) {
                let response = match request.request_type.as_str() {
                    "query" => {
                        match api::handle_query(&request.command, &request.args, &state) {
                            Ok(data) => Response::success(request.id, data),
                            Err(e) => Response::error(request.id, e),
                        }
                    }
                    "action" => {
                        match api::handle_action(&request.command, &request.args, &state) {
                            Ok(data) => Response::success(request.id, data),
                            Err(e) => Response::error(request.id, e),
                        }
                    }
                    _ => Response::error(request.id, "unsupported type".into()),
                };
                let json = serde_json::to_string(&response).unwrap();
                if write_half
                    .write_all(format!("{}\n", json).as_bytes())
                    .await
                    .is_err()
                {
                    break;
                }
            }
            // Non-request lines (HookPayloads) are silently consumed — no response
        }
    });

    client
}

#[tokio::test]
async fn query_list_sessions_returns_sessions() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");
    insert_session(&state, "s2");

    let client = spawn_dispatch(state);
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(b"{\"type\":\"query\",\"command\":\"list_sessions\",\"id\":\"r1\"}\n")
        .await
        .unwrap();

    let resp_line = lines.next_line().await.unwrap().unwrap();
    let resp: serde_json::Value = serde_json::from_str(&resp_line).unwrap();
    assert_eq!(resp["id"], "r1");
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn query_get_status_counts() {
    let (state, _dir) = test_state();
    {
        use jackdaw_lib::state::Session;
        let mut sessions = state.sessions.lock().unwrap();
        let mut s1 = Session::new("s1".into(), "/tmp".into());
        s1.processing = true;
        sessions.insert("s1".into(), s1);
        sessions.insert("s2".into(), Session::new("s2".into(), "/tmp".into()));
    }

    let client = spawn_dispatch(state);
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(b"{\"type\":\"query\",\"command\":\"get_status\",\"id\":\"r2\"}\n")
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["total"], 2);
    assert_eq!(resp["data"]["running"], 1);
    assert_eq!(resp["data"]["input"], 1);
}

#[tokio::test]
async fn action_dismiss_via_socket() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"dismiss_session\",\"id\":\"r3\",\"args\":{\"session_id\":\"s1\"}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["dismissed"], true);
    assert!(state.sessions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hook_payload_produces_no_response() {
    let (state, _dir) = test_state();
    let client = spawn_dispatch(state);
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    // Send a HookPayload (no "type" field) — server should NOT respond
    write_half
        .write_all(b"{\"session_id\":\"s1\",\"cwd\":\"/tmp\",\"hook_event_name\":\"SessionStart\"}\n")
        .await
        .unwrap();

    // Send a query to prove the connection is still alive and we get a response
    write_half
        .write_all(b"{\"type\":\"query\",\"command\":\"list_sessions\",\"id\":\"r4\"}\n")
        .await
        .unwrap();

    // The first response we get should be the query response, not anything from the HookPayload
    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(resp["id"], "r4");
}

#[test]
fn try_parse_request_returns_none_for_hook_payload() {
    let line = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
    assert!(try_parse_request(line).is_none());
}

#[test]
fn try_parse_request_returns_some_for_request() {
    let line = r#"{"type":"query","command":"list_sessions","id":"r1"}"#;
    let req = try_parse_request(line).unwrap();
    assert_eq!(req.request_type, "query");
    assert_eq!(req.command, "list_sessions");
}

#[tokio::test]
async fn unknown_request_type_returns_error() {
    let (state, _dir) = test_state();
    let client = spawn_dispatch(state);
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(b"{\"type\":\"bogus\",\"command\":\"foo\",\"id\":\"r5\"}\n")
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(!resp["ok"].as_bool().unwrap());
    assert!(resp["error"].as_str().unwrap().contains("unsupported"));
}
