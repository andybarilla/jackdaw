use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
        Self {
            id,
            ok: true,
            data: Some(data),
            error: None,
        }
    }
    pub fn error(id: String, message: String) -> Self {
        Self {
            id,
            ok: false,
            data: None,
            error: Some(message),
        }
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

pub fn handle_query(
    command: &str,
    args: &Option<serde_json::Value>,
    state: &Arc<AppState>,
) -> Result<serde_json::Value, String> {
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
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("session not found: {}", session_id))?;
            Ok(serde_json::to_value(session.clone()).unwrap())
        }
        "get_status" => {
            let sessions = state.sessions.lock().unwrap();
            let (mut running, mut approval, mut input) = (0u32, 0u32, 0u32);
            for s in sessions.values() {
                if s.pending_approval {
                    approval += 1;
                } else if s.current_tool.is_some() || s.active_subagents > 0 || s.processing {
                    running += 1;
                } else {
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

pub fn handle_action(
    command: &str,
    args: &Option<serde_json::Value>,
    state: &Arc<AppState>,
) -> Result<serde_json::Value, String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Session;

    fn test_state() -> Arc<AppState> {
        Arc::new(AppState::new(crate::db::init_memory()))
    }

    fn insert_session(state: &Arc<AppState>, id: &str) {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.into(), Session::new(id.into(), "/tmp".into()));
    }

    // --- try_parse_request ---

    #[test]
    fn parse_query_request() {
        let line = r#"{"type":"query","command":"list_sessions","id":"req-1"}"#;
        let req = try_parse_request(line).unwrap();
        assert_eq!(req.request_type, "query");
        assert_eq!(req.command, "list_sessions");
        assert_eq!(req.id, "req-1");
        assert!(req.args.is_none());
    }

    #[test]
    fn parse_action_with_args() {
        let line =
            r#"{"type":"action","command":"dismiss_session","id":"req-2","args":{"session_id":"s1"}}"#;
        let req = try_parse_request(line).unwrap();
        assert_eq!(req.request_type, "action");
        assert_eq!(req.args.unwrap()["session_id"], "s1");
    }

    #[test]
    fn hook_payload_not_parsed_as_request() {
        let line = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        assert!(try_parse_request(line).is_none());
    }

    #[test]
    fn invalid_json_returns_none() {
        assert!(try_parse_request("not json").is_none());
    }

    #[test]
    fn response_success_serialization() {
        let resp = Response::success("r1".into(), serde_json::json!({"count": 3}));
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], "r1");
        assert_eq!(json["ok"], true);
        assert_eq!(json["data"]["count"], 3);
        assert!(json.get("error").is_none());
    }

    #[test]
    fn response_error_serialization() {
        let resp = Response::error("r2".into(), "not found".into());
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "not found");
        assert!(json.get("data").is_none());
    }

    // --- handle_query ---

    #[test]
    fn query_list_sessions_empty() {
        let state = test_state();
        let result = handle_query("list_sessions", &None, &state).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 0);
    }

    #[test]
    fn query_list_sessions_with_data() {
        let state = test_state();
        insert_session(&state, "s1");
        insert_session(&state, "s2");
        let result = handle_query("list_sessions", &None, &state).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 2);
    }

    #[test]
    fn query_get_session_found() {
        let state = test_state();
        insert_session(&state, "s1");
        let args = Some(serde_json::json!({"session_id": "s1"}));
        let result = handle_query("get_session", &args, &state).unwrap();
        assert_eq!(result["session_id"], "s1");
    }

    #[test]
    fn query_get_session_not_found() {
        let state = test_state();
        let args = Some(serde_json::json!({"session_id": "nope"}));
        let err = handle_query("get_session", &args, &state).unwrap_err();
        assert!(err.contains("session not found"));
    }

    #[test]
    fn query_get_session_missing_arg() {
        let state = test_state();
        let err = handle_query("get_session", &None, &state).unwrap_err();
        assert!(err.contains("missing args.session_id"));
    }

    #[test]
    fn query_get_status() {
        let state = test_state();
        {
            let mut sessions = state.sessions.lock().unwrap();
            let mut s1 = Session::new("s1".into(), "/tmp".into());
            s1.processing = true;
            sessions.insert("s1".into(), s1);

            let mut s2 = Session::new("s2".into(), "/tmp".into());
            s2.pending_approval = true;
            sessions.insert("s2".into(), s2);

            sessions.insert("s3".into(), Session::new("s3".into(), "/tmp".into()));
        }
        let result = handle_query("get_status", &None, &state).unwrap();
        assert_eq!(result["total"], 3);
        assert_eq!(result["running"], 1);
        assert_eq!(result["approval"], 1);
        assert_eq!(result["input"], 1);
    }

    #[test]
    fn query_unknown_command() {
        let state = test_state();
        let err = handle_query("bogus", &None, &state).unwrap_err();
        assert!(err.contains("unknown query command"));
    }

    // --- handle_action ---

    #[test]
    fn action_dismiss_session() {
        let state = test_state();
        insert_session(&state, "s1");
        let args = Some(serde_json::json!({"session_id": "s1"}));
        let result = handle_action("dismiss_session", &args, &state).unwrap();
        assert_eq!(result["dismissed"], true);
        assert!(state.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn action_dismiss_not_found() {
        let state = test_state();
        let args = Some(serde_json::json!({"session_id": "nope"}));
        let err = handle_action("dismiss_session", &args, &state).unwrap_err();
        assert!(err.contains("session not found"));
    }

    #[test]
    fn action_mark_session_read() {
        let state = test_state();
        {
            let mut sessions = state.sessions.lock().unwrap();
            let mut s = Session::new("s1".into(), "/tmp".into());
            s.has_unread = true;
            sessions.insert("s1".into(), s);
        }
        let args = Some(serde_json::json!({"session_id": "s1"}));
        let result = handle_action("mark_session_read", &args, &state).unwrap();
        assert_eq!(result["marked"], true);
        assert!(!state.sessions.lock().unwrap().get("s1").unwrap().has_unread);
    }

    #[test]
    fn action_unknown_command() {
        let state = test_state();
        let err = handle_action("bogus", &None, &state).unwrap_err();
        assert!(err.contains("unknown action command"));
    }

    // --- E2E socket test ---

    #[tokio::test]
    async fn socket_api_query_list_sessions() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let state = test_state();
        insert_session(&state, "s1");

        let (client, server_conn) = tokio::io::duplex(4096);
        let state_clone = state.clone();

        tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(server_conn);
            let reader = BufReader::new(read_half);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(request) = try_parse_request(&line) {
                    let response = match request.request_type.as_str() {
                        "query" => {
                            match handle_query(&request.command, &request.args, &state_clone) {
                                Ok(data) => Response::success(request.id, data),
                                Err(e) => Response::error(request.id, e),
                            }
                        }
                        _ => Response::error(request.id, "unsupported".into()),
                    };
                    let json = serde_json::to_string(&response).unwrap();
                    write_half
                        .write_all(format!("{}\n", json).as_bytes())
                        .await
                        .unwrap();
                }
            }
        });

        let (read_half, mut write_half) = tokio::io::split(client);
        let reader = BufReader::new(read_half);
        let mut lines = reader.lines();

        write_half
            .write_all(b"{\"type\":\"query\",\"command\":\"list_sessions\",\"id\":\"test1\"}\n")
            .await
            .unwrap();

        let response_line = lines.next_line().await.unwrap().unwrap();
        let resp: serde_json::Value = serde_json::from_str(&response_line).unwrap();
        assert_eq!(resp["id"], "test1");
        assert_eq!(resp["ok"], true);
        assert_eq!(resp["data"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn hook_payload_not_parsed_as_request_detailed() {
        let line = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        assert!(try_parse_request(line).is_none());
    }
}
