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

/// Spawn a dispatch loop that also handles `subscribe` requests.
fn spawn_dispatch_with_subscribe(state: Arc<AppState>) -> tokio::io::DuplexStream {
    use jackdaw_lib::api;

    let (client, server) = tokio::io::duplex(65536);
    tokio::spawn(async move {
        let (read_half, mut write_half) = tokio::io::split(server);
        let reader = BufReader::new(read_half);
        let mut lines = reader.lines();
        let mut subscription: Option<(String, tokio::sync::broadcast::Receiver<String>)> = None;

        loop {
            tokio::select! {
                line_result = lines.next_line() => {
                    match line_result {
                        Ok(Some(line)) => {
                            if let Some(request) = api::try_parse_request(&line) {
                                let response = match request.request_type.as_str() {
                                    "query" => match api::handle_query(&request.command, &request.args, &state) {
                                        Ok(data) => Response::success(request.id, data),
                                        Err(e) => Response::error(request.id, e),
                                    },
                                    "action" => match api::handle_action(&request.command, &request.args, &state) {
                                        Ok(data) => Response::success(request.id, data),
                                        Err(e) => Response::error(request.id, e),
                                    },
                                    "subscribe" => {
                                        if request.command == "session_updates" {
                                            subscription = Some((request.id.clone(), state.subscriber_tx.subscribe()));
                                            Response::success(request.id, serde_json::json!({"subscribed": "session_updates"}))
                                        } else {
                                            Response::error(request.id.clone(), format!("unknown subscription: {}", request.command))
                                        }
                                    }
                                    _ => Response::error(request.id, "unsupported type".into()),
                                };
                                let json = serde_json::to_string(&response).unwrap();
                                if write_half.write_all(format!("{}\n", json).as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
                update = async {
                    match &mut subscription {
                        Some((_, rx)) => rx.recv().await,
                        None => std::future::pending().await,
                    }
                } => {
                    if let Ok(session_json) = update {
                        let sub_id = subscription.as_ref().map(|(id, _)| id.clone()).unwrap_or_default();
                        let push = Response::success(
                            sub_id,
                            serde_json::from_str(&session_json).unwrap_or_default(),
                        );
                        if let Ok(json) = serde_json::to_string(&push) {
                            if write_half.write_all(format!("{}\n", json).as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    });

    client
}

#[tokio::test]
async fn subscribe_push_includes_subscription_id() {
    let (state, _dir) = test_state();

    let client = spawn_dispatch_with_subscribe(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    // Subscribe
    write_half
        .write_all(b"{\"type\":\"subscribe\",\"command\":\"session_updates\",\"id\":\"sub-1\"}\n")
        .await
        .unwrap();

    // Confirm subscription ack
    let ack: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(ack["id"], "sub-1");
    assert!(ack["ok"].as_bool().unwrap());

    // Trigger a state change by inserting a session and broadcasting
    insert_session(&state, "s1");
    {
        use jackdaw_lib::state::Session;
        let sessions = state.sessions.lock().unwrap();
        let session_list: Vec<&Session> = sessions.values().collect();
        let json = serde_json::to_string(&session_list).unwrap();
        let _ = state.subscriber_tx.send(json);
    }

    // The push must arrive with the original subscription id
    let push: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(push["id"], "sub-1");
    assert!(push["ok"].as_bool().unwrap());
    let sessions = push["data"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["session_id"], "s1");
}

#[tokio::test]
async fn action_register_session_via_socket() {
    let (state, _dir) = test_state();

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"register_session\",\"id\":\"r1\",\"args\":{\"session_id\":\"build-1\",\"display_name\":\"CI Build\"}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["registered"], true);

    let sessions = state.sessions.lock().unwrap();
    assert_eq!(sessions.get("build-1").unwrap().display_name.as_deref(), Some("CI Build"));
}

#[tokio::test]
async fn action_set_metadata_via_socket() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"set_metadata\",\"id\":\"r2\",\"args\":{\"session_id\":\"s1\",\"entries\":[{\"key\":\"status\",\"value\":\"building\"}]}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["updated"], true);

    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.get("s1").unwrap().metadata.contains_key("status"));
}

#[tokio::test]
async fn action_end_session_via_socket() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"end_session\",\"id\":\"r3\",\"args\":{\"session_id\":\"s1\"}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["ended"], true);
    assert!(state.sessions.lock().unwrap().is_empty());
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
