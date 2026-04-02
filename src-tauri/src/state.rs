use chrono::{DateTime, Utc};
use indexmap::IndexMap;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

/// Incoming hook payload from Claude Code (via IPC socket)
#[derive(Debug, Deserialize)]
pub struct HookPayload {
    pub session_id: String,
    pub cwd: String,
    pub hook_event_name: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_use_id: Option<String>,
    #[serde(default)]
    pub spawned_session: Option<String>,
    #[serde(default)]
    pub source_tool: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionSource {
    External,
    Spawned,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "content", rename_all = "lowercase")]
pub enum MetadataValue {
    Text(String),
    Progress(f64),
    Log(Vec<String>),
}

#[derive(Debug, Clone, Serialize)]
pub struct MetadataEntry {
    pub key: String,
    pub value: MetadataValue,
}

/// Internal session state
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    pub started_at: DateTime<Utc>,
    pub current_tool: Option<ToolEvent>,
    pub tool_history: Vec<ToolEvent>,
    pub git_branch: Option<String>,
    pub active_subagents: u32,
    pub pending_approval: bool,
    pub processing: bool,
    pub has_unread: bool,
    pub source: SessionSource,
    pub display_name: Option<String>,
    pub metadata: IndexMap<String, MetadataEntry>,
    pub shell_pty_id: Option<String>,
    pub parent_session_id: Option<String>,
    pub alert_tier: Option<String>,
    pub source_tool: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolEvent {
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,
    pub summary: Option<String>,
    pub urls: Vec<String>,
    #[serde(skip_serializing)]
    pub tool_use_id: Option<String>,
}

/// Shared app state wrapped in Mutex for thread safety
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    pub db: Mutex<Connection>,
    pub subscriber_tx: broadcast::Sender<String>,
    /// Maps Claude's session_id → PTY session_id for spawned sessions.
    /// Hook events arrive with Claude's ID; this lets us find the session under its PTY ID.
    pub spawned_id_map: Mutex<HashMap<String, String>>,
    pub pending_subagent_starts: Mutex<Vec<(String, String, DateTime<Utc>)>>,
}

impl AppState {
    pub fn new(db: Connection) -> Self {
        let (subscriber_tx, _) = broadcast::channel(64);
        Self {
            sessions: Mutex::new(HashMap::new()),
            db: Mutex::new(db),
            subscriber_tx,
            spawned_id_map: Mutex::new(HashMap::new()),
            pending_subagent_starts: Mutex::new(Vec::new()),
        }
    }
}

/// Extract a human-readable summary from tool_input based on tool_name
pub fn extract_summary(tool_name: &str, tool_input: &Option<serde_json::Value>) -> Option<String> {
    let input = tool_input.as_ref()?;
    let value = match tool_name {
        // Canonical names (from @jackdaw/protocol)
        "shell" | "Bash" => input.get("command")?.as_str(),
        "file_edit" | "file_read" | "file_write" | "Edit" | "Read" | "Write" => {
            input.get("file_path")?.as_str()
        }
        "file_search" | "content_search" | "Glob" | "Grep" => input.get("pattern")?.as_str(),
        "agent" | "Agent" => input.get("description")?.as_str(),
        "web_fetch" | "WebFetch" => input.get("url")?.as_str(),
        "web_search" | "WebSearch" => input.get("query")?.as_str(),
        _ => None,
    };
    value.map(|s| s.chars().take(120).collect())
}

/// Extract URLs from tool_input by walking all string values in the JSON.
pub fn extract_urls(tool_input: &Option<serde_json::Value>) -> Vec<String> {
    let Some(input) = tool_input else {
        return Vec::new();
    };

    let mut urls = Vec::new();
    collect_urls_from_value(input, &mut urls);

    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    urls.retain(|url| seen.insert(url.clone()));
    urls
}

fn collect_urls_from_value(value: &serde_json::Value, urls: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => extract_urls_from_str(s, urls),
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_urls_from_value(v, urls);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                collect_urls_from_value(v, urls);
            }
        }
        _ => {}
    }
}

fn extract_urls_from_str(s: &str, urls: &mut Vec<String>) {
    // Match http://, https://, and file:// URLs
    let mut remaining = s;
    while let Some(start) = remaining
        .find("http://")
        .or_else(|| remaining.find("https://"))
        .or_else(|| remaining.find("file://"))
    {
        let url_start = &remaining[start..];
        // URL ends at whitespace, quote, backtick, or end of string
        let end = url_start
            .find(|c: char| {
                c.is_whitespace() || c == '"' || c == '\'' || c == '`' || c == '>' || c == ')' || c == ']'
            })
            .unwrap_or(url_start.len());
        let url = &url_start[..end];
        // Basic validation: must have at least scheme + something after ://
        if url.len() > 8 {
            urls.push(url.to_string());
        }
        remaining = &remaining[start + end..];
    }
}

pub async fn resolve_git_branch(cwd: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}

/// Detect the user's default shell. Returns (path, display_name).
pub fn detect_shell() -> (String, String) {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sh".to_string());
        (shell, name)
    }
    #[cfg(windows)]
    {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let name = "cmd".to_string();
        (shell, name)
    }
}

const MAX_TOOL_HISTORY: usize = 50;

impl Session {
    pub fn new(session_id: String, cwd: String) -> Self {
        Self {
            session_id,
            cwd,
            started_at: Utc::now(),
            current_tool: None,
            tool_history: Vec::new(),
            git_branch: None,
            active_subagents: 0,
            pending_approval: false,
            processing: false,
            has_unread: false,
            source: SessionSource::External,
            display_name: None,
            metadata: IndexMap::new(),
            shell_pty_id: None,
            parent_session_id: None,
            alert_tier: None,
            source_tool: None,
        }
    }

    pub fn is_busy(&self) -> bool {
        self.current_tool.is_some()
            || self.active_subagents > 0
            || self.processing
            || self.pending_approval
    }

    pub fn explicit_progress(&self) -> Option<f64> {
        self.metadata.get("progress").and_then(|entry| {
            if let MetadataValue::Progress(v) = &entry.value {
                Some(*v)
            } else {
                None
            }
        })
    }

    pub fn set_current_tool(&mut self, tool: ToolEvent) {
        // If there's already a current tool, move it to history first
        if let Some(prev) = self.current_tool.take() {
            self.push_history(prev);
        }
        self.current_tool = Some(tool);
    }

    pub fn complete_tool(&mut self, tool_use_id: Option<&str>, tool: ToolEvent) {
        match (&self.current_tool, tool_use_id) {
            // If we have a tool_use_id, only complete if it matches
            (Some(current), Some(id)) if current.tool_use_id.as_deref() == Some(id) => {
                let completed = self.current_tool.take().unwrap();
                self.push_history(completed);
            }
            // If no tool_use_id on the event, fall back to name matching
            (Some(current), None) if current.tool_name == tool.tool_name => {
                let completed = self.current_tool.take().unwrap();
                self.push_history(completed);
            }
            // No current tool or mismatch — just add to history
            _ => {
                self.push_history(tool);
            }
        }
    }

    pub fn clear_current_tool(&mut self) {
        if let Some(tool) = self.current_tool.take() {
            self.push_history(tool);
        }
    }

    pub fn hydrate_from_history(&mut self, history: &[crate::db::HistoryToolEvent]) {
        if !self.tool_history.is_empty() || history.is_empty() {
            return;
        }
        for event in history {
            let ts = event
                .timestamp
                .parse::<DateTime<Utc>>()
                .unwrap_or_else(|_| Utc::now());
            self.tool_history.push(ToolEvent {
                tool_name: event.tool_name.clone(),
                timestamp: ts,
                summary: event.summary.clone(),
                urls: Vec::new(),
                tool_use_id: None,
            });
        }
        while self.tool_history.len() > MAX_TOOL_HISTORY {
            self.tool_history.remove(0);
        }
    }

    fn push_history(&mut self, tool: ToolEvent) {
        self.tool_history.push(tool);
        if self.tool_history.len() > MAX_TOOL_HISTORY {
            self.tool_history.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_summary_bash_command() {
        let input = Some(json!({"command": "ls -la"}));
        assert_eq!(extract_summary("Bash", &input), Some("ls -la".into()));
    }

    #[test]
    fn extract_summary_read_file_path() {
        let input = Some(json!({"file_path": "/src/main.rs"}));
        assert_eq!(extract_summary("Read", &input), Some("/src/main.rs".into()));
    }

    #[test]
    fn extract_summary_edit_file_path() {
        let input = Some(json!({"file_path": "/src/lib.rs"}));
        assert_eq!(extract_summary("Edit", &input), Some("/src/lib.rs".into()));
    }

    #[test]
    fn extract_summary_write_file_path() {
        let input = Some(json!({"file_path": "/src/new.rs"}));
        assert_eq!(extract_summary("Write", &input), Some("/src/new.rs".into()));
    }

    #[test]
    fn extract_summary_glob_pattern() {
        let input = Some(json!({"pattern": "**/*.rs"}));
        assert_eq!(extract_summary("Glob", &input), Some("**/*.rs".into()));
    }

    #[test]
    fn extract_summary_grep_pattern() {
        let input = Some(json!({"pattern": "fn main"}));
        assert_eq!(extract_summary("Grep", &input), Some("fn main".into()));
    }

    #[test]
    fn extract_summary_agent_description() {
        let input = Some(json!({"description": "Search for files"}));
        assert_eq!(extract_summary("Agent", &input), Some("Search for files".into()));
    }

    #[test]
    fn extract_summary_none_input() {
        assert_eq!(extract_summary("Bash", &None), None);
    }

    #[test]
    fn extract_summary_missing_field() {
        let input = Some(json!({"other_field": "value"}));
        assert_eq!(extract_summary("Bash", &input), None);
    }

    #[test]
    fn extract_summary_unknown_tool() {
        let input = Some(json!({"command": "test"}));
        assert_eq!(extract_summary("UnknownTool", &input), None);
    }

    #[test]
    fn extract_summary_truncates_at_120_chars() {
        let long_cmd = "a".repeat(200);
        let input = Some(json!({"command": long_cmd}));
        let result = extract_summary("Bash", &input).unwrap();
        assert_eq!(result.len(), 120);
    }

    #[test]
    fn session_new_defaults() {
        let s = Session::new("sess-1".into(), "/home/test".into());
        assert_eq!(s.session_id, "sess-1");
        assert_eq!(s.cwd, "/home/test");
        assert!(s.current_tool.is_none());
        assert!(s.tool_history.is_empty());
        assert_eq!(s.active_subagents, 0);
        assert!(!s.pending_approval);
        assert!(!s.processing);
    }

    fn make_tool(name: &str, id: Option<&str>) -> ToolEvent {
        ToolEvent {
            tool_name: name.into(),
            timestamp: Utc::now(),
            summary: None,
            urls: Vec::new(),
            tool_use_id: id.map(String::from),
        }
    }

    #[test]
    fn set_current_tool_when_none() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Bash");
        assert!(s.tool_history.is_empty());
    }

    #[test]
    fn set_current_tool_moves_previous_to_history() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.set_current_tool(make_tool("Read", Some("id-2")));
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Read");
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn complete_tool_id_match() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(Some("id-1"), make_tool("Bash", Some("id-1")));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn complete_tool_name_fallback_when_no_event_id() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(None, make_tool("Bash", None));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn complete_tool_id_mismatch_keeps_current() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(Some("wrong-id"), make_tool("Read", Some("wrong-id")));
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Bash");
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Read");
    }

    #[test]
    fn complete_tool_no_current() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.complete_tool(Some("id-1"), make_tool("Bash", Some("id-1")));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
    }

    #[test]
    fn clear_current_tool_moves_to_history() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.clear_current_tool();
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn clear_current_tool_noop_when_none() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.clear_current_tool();
        assert!(s.current_tool.is_none());
        assert!(s.tool_history.is_empty());
    }

    #[test]
    fn hydrate_from_history_populates_tool_history() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        let history = vec![
            crate::db::HistoryToolEvent {
                tool_name: "Bash".into(),
                summary: Some("ls".into()),
                timestamp: "2026-03-23T00:01:00Z".into(),
            },
            crate::db::HistoryToolEvent {
                tool_name: "Read".into(),
                summary: Some("/f".into()),
                timestamp: "2026-03-23T00:02:00Z".into(),
            },
        ];
        s.hydrate_from_history(&history);
        assert_eq!(s.tool_history.len(), 2);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
        assert_eq!(s.tool_history[0].summary, Some("ls".into()));
        assert_eq!(s.tool_history[1].tool_name, "Read");
    }

    #[test]
    fn hydrate_from_history_noop_when_empty() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.hydrate_from_history(&[]);
        assert!(s.tool_history.is_empty());
    }

    #[test]
    fn hydrate_from_history_noop_when_already_has_history() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.clear_current_tool();
        let history = vec![crate::db::HistoryToolEvent {
            tool_name: "Read".into(),
            summary: None,
            timestamp: "2026-03-23T00:01:00Z".into(),
        }];
        s.hydrate_from_history(&history);
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[tokio::test]
    async fn resolve_git_branch_returns_branch_in_git_repo() {
        let branch = resolve_git_branch(".").await;
        assert!(branch.is_some());
        assert!(!branch.unwrap().is_empty());
    }

    #[tokio::test]
    async fn resolve_git_branch_returns_none_for_non_git_dir() {
        let branch = resolve_git_branch("/tmp").await;
        assert!(branch.is_none());
    }

    #[test]
    fn hook_payload_deserializes_spawned_session() {
        let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart","spawned_session":"pty-123"}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.spawned_session, Some("pty-123".into()));
    }

    #[test]
    fn hook_payload_spawned_session_defaults_to_none() {
        let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.spawned_session, None);
    }

    #[test]
    fn session_source_defaults_to_external() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert_eq!(s.source, SessionSource::External);
    }

    #[test]
    fn is_busy_with_current_tool() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        assert!(s.is_busy());
    }

    #[test]
    fn is_busy_with_subagents() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.active_subagents = 1;
        assert!(s.is_busy());
    }

    #[test]
    fn is_busy_when_processing() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.processing = true;
        assert!(s.is_busy());
    }

    #[test]
    fn is_busy_when_pending_approval() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.pending_approval = true;
        assert!(s.is_busy());
    }

    #[test]
    fn is_busy_false_when_idle() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert!(!s.is_busy());
    }

    #[test]
    fn session_source_serializes_as_lowercase() {
        let json = serde_json::to_value(SessionSource::Spawned).unwrap();
        assert_eq!(json, serde_json::json!("spawned"));
        let json = serde_json::to_value(SessionSource::External).unwrap();
        assert_eq!(json, serde_json::json!("external"));
    }

    #[test]
    fn metadata_value_text_serializes_as_tagged() {
        let entry = MetadataEntry {
            key: "status".into(),
            value: MetadataValue::Text("compiling".into()),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["key"], "status");
        assert_eq!(json["value"]["type"], "text");
        assert_eq!(json["value"]["content"], "compiling");
    }

    #[test]
    fn metadata_value_progress_serializes_as_tagged() {
        let entry = MetadataEntry {
            key: "coverage".into(),
            value: MetadataValue::Progress(87.5),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["value"]["type"], "progress");
        assert_eq!(json["value"]["content"], 87.5);
    }

    #[test]
    fn metadata_value_log_serializes_as_tagged() {
        let entry = MetadataEntry {
            key: "build_log".into(),
            value: MetadataValue::Log(vec!["line 1".into(), "line 2".into()]),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["value"]["type"], "log");
        let content = json["value"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0], "line 1");
    }

    #[test]
    fn session_new_has_empty_metadata() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert!(s.metadata.is_empty());
        assert!(s.display_name.is_none());
    }

    #[test]
    fn session_display_name_serializes() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.display_name = Some("CI Build #456".into());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["display_name"], "CI Build #456");
    }

    #[test]
    fn session_metadata_serializes_in_order() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.metadata.insert(
            "status".into(),
            MetadataEntry {
                key: "status".into(),
                value: MetadataValue::Text("building".into()),
            },
        );
        s.metadata.insert(
            "progress".into(),
            MetadataEntry {
                key: "progress".into(),
                value: MetadataValue::Progress(50.0),
            },
        );
        let json = serde_json::to_value(&s).unwrap();
        let meta = json["metadata"].as_object().unwrap();
        let keys: Vec<&String> = meta.keys().collect();
        assert_eq!(keys, vec!["status", "progress"]);
    }

    #[test]
    fn push_history_caps_at_50() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        for i in 0..55 {
            s.set_current_tool(make_tool(&format!("Tool{}", i), None));
        }
        assert_eq!(s.tool_history.len(), 50);
        assert_eq!(s.tool_history[0].tool_name, "Tool4");
        assert_eq!(s.tool_history[49].tool_name, "Tool53");
    }

    #[test]
    fn session_new_shell_pty_id_is_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert!(s.shell_pty_id.is_none());
    }

    #[test]
    fn session_shell_pty_id_serializes() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.shell_pty_id = Some("pty-abc".into());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["shell_pty_id"], "pty-abc");
    }

    #[test]
    fn session_shell_pty_id_serializes_null_when_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["shell_pty_id"].is_null());
    }

    #[test]
    fn detect_shell_returns_non_empty() {
        let (path, name) = super::detect_shell();
        assert!(!path.is_empty());
        assert!(!name.is_empty());
    }

    #[test]
    fn detect_shell_name_has_no_path_separator() {
        let (_, name) = super::detect_shell();
        assert!(!name.contains('/'));
    }

    #[test]
    fn explicit_progress_returns_none_when_no_progress_metadata() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert_eq!(s.explicit_progress(), None);
    }

    #[test]
    fn explicit_progress_returns_value_when_progress_metadata_set() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.metadata.insert(
            "progress".into(),
            MetadataEntry {
                key: "progress".into(),
                value: MetadataValue::Progress(75.0),
            },
        );
        assert_eq!(s.explicit_progress(), Some(75.0));
    }

    #[test]
    fn explicit_progress_ignores_non_progress_metadata_with_progress_key() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.metadata.insert(
            "progress".into(),
            MetadataEntry {
                key: "progress".into(),
                value: MetadataValue::Text("75%".into()),
            },
        );
        assert_eq!(s.explicit_progress(), None);
    }

    #[test]
    fn session_new_alert_tier_is_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert!(s.alert_tier.is_none());
    }

    #[test]
    fn session_alert_tier_serializes_when_set() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.alert_tier = Some("high".into());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["alert_tier"], "high");
    }

    #[test]
    fn session_alert_tier_serializes_null_when_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["alert_tier"].is_null());
    }

    #[test]
    fn hook_payload_deserializes_source_tool() {
        let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart","source_tool":"opencode"}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.source_tool.as_deref(), Some("opencode"));
    }

    #[test]
    fn hook_payload_source_tool_defaults_to_none() {
        let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert!(payload.source_tool.is_none());
    }

    #[test]
    fn session_serializes_source_tool() {
        let mut session = Session::new("s1".into(), "/tmp".into());
        session.source_tool = Some("opencode".into());
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(json["source_tool"], "opencode");
    }

    #[test]
    fn extract_summary_canonical_shell() {
        let input = serde_json::json!({"command": "ls -la"});
        assert_eq!(extract_summary("shell", &Some(input)), Some("ls -la".into()));
    }

    #[test]
    fn extract_summary_canonical_file_read() {
        let input = serde_json::json!({"file_path": "/foo/bar.rs"});
        assert_eq!(extract_summary("file_read", &Some(input)), Some("/foo/bar.rs".into()));
    }

    #[test]
    fn extract_summary_canonical_file_write() {
        let input = serde_json::json!({"file_path": "/foo/out.txt"});
        assert_eq!(extract_summary("file_write", &Some(input)), Some("/foo/out.txt".into()));
    }

    #[test]
    fn extract_summary_canonical_file_edit() {
        let input = serde_json::json!({"file_path": "/foo/bar.rs"});
        assert_eq!(extract_summary("file_edit", &Some(input)), Some("/foo/bar.rs".into()));
    }

    #[test]
    fn extract_summary_canonical_file_search() {
        let input = serde_json::json!({"pattern": "**/*.rs"});
        assert_eq!(extract_summary("file_search", &Some(input)), Some("**/*.rs".into()));
    }

    #[test]
    fn extract_summary_canonical_content_search() {
        let input = serde_json::json!({"pattern": "fn main"});
        assert_eq!(extract_summary("content_search", &Some(input)), Some("fn main".into()));
    }

    #[test]
    fn extract_summary_canonical_agent() {
        let input = serde_json::json!({"description": "search for foo"});
        assert_eq!(extract_summary("agent", &Some(input)), Some("search for foo".into()));
    }

    #[test]
    fn extract_summary_canonical_web_fetch() {
        let input = serde_json::json!({"url": "https://example.com"});
        assert_eq!(extract_summary("web_fetch", &Some(input)), Some("https://example.com".into()));
    }

    #[test]
    fn extract_summary_canonical_web_search() {
        let input = serde_json::json!({"query": "rust async patterns"});
        assert_eq!(extract_summary("web_search", &Some(input)), Some("rust async patterns".into()));
    }

    #[test]
    fn extract_summary_claude_code_names_still_work() {
        let input = serde_json::json!({"command": "echo hi"});
        assert_eq!(extract_summary("Bash", &Some(input)), Some("echo hi".into()));
    }

    #[test]
    fn extract_urls_from_web_fetch() {
        let input = Some(json!({"url": "https://example.com/page"}));
        assert_eq!(extract_urls(&input), vec!["https://example.com/page"]);
    }

    #[test]
    fn extract_urls_from_bash_command() {
        let input = Some(json!({"command": "curl https://api.example.com/data"}));
        assert_eq!(extract_urls(&input), vec!["https://api.example.com/data"]);
    }

    #[test]
    fn extract_urls_from_nested_json() {
        let input = Some(json!({
            "content": "Check http://localhost:3000/dashboard for the result"
        }));
        assert_eq!(extract_urls(&input), vec!["http://localhost:3000/dashboard"]);
    }

    #[test]
    fn extract_urls_multiple() {
        let input = Some(json!({
            "command": "curl https://a.com && curl https://b.com"
        }));
        let urls = extract_urls(&input);
        assert_eq!(urls, vec!["https://a.com", "https://b.com"]);
    }

    #[test]
    fn extract_urls_none_input() {
        assert_eq!(extract_urls(&None), Vec::<String>::new());
    }

    #[test]
    fn extract_urls_no_urls() {
        let input = Some(json!({"command": "ls -la"}));
        assert_eq!(extract_urls(&input), Vec::<String>::new());
    }

    #[test]
    fn extract_urls_deduplicates() {
        let input = Some(json!({
            "url": "https://example.com",
            "command": "fetch https://example.com"
        }));
        assert_eq!(extract_urls(&input), vec!["https://example.com"]);
    }

    #[test]
    fn extract_urls_localhost_with_port() {
        let input = Some(json!({"command": "open http://localhost:5173/page"}));
        assert_eq!(extract_urls(&input), vec!["http://localhost:5173/page"]);
    }

    #[test]
    fn extract_urls_filters_disallowed_schemes() {
        let input = Some(json!({"command": "javascript:alert(1) https://safe.com"}));
        assert_eq!(extract_urls(&input), vec!["https://safe.com"]);
    }

    #[test]
    fn session_new_parent_session_id_is_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        assert!(s.parent_session_id.is_none());
    }

    #[test]
    fn session_parent_session_id_serializes_null_when_none() {
        let s = Session::new("s1".into(), "/tmp".into());
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["parent_session_id"].is_null());
    }

    #[test]
    fn session_parent_session_id_serializes_when_set() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.parent_session_id = Some("parent-1".into());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["parent_session_id"], "parent-1");
    }
}
