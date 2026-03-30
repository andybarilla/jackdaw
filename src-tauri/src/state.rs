use chrono::{DateTime, Utc};
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
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolEvent {
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,
    pub summary: Option<String>,
    #[serde(skip_serializing)]
    pub tool_use_id: Option<String>,
}

/// Shared app state wrapped in Mutex for thread safety
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    pub db: Mutex<Connection>,
    pub subscriber_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(db: Connection) -> Self {
        let (subscriber_tx, _) = broadcast::channel(64);
        Self {
            sessions: Mutex::new(HashMap::new()),
            db: Mutex::new(db),
            subscriber_tx,
        }
    }
}

/// Extract a human-readable summary from tool_input based on tool_name
pub fn extract_summary(tool_name: &str, tool_input: &Option<serde_json::Value>) -> Option<String> {
    let input = tool_input.as_ref()?;
    let value = match tool_name {
        "Bash" => input.get("command")?.as_str(),
        "Edit" | "Read" | "Write" => input.get("file_path")?.as_str(),
        "Glob" => input.get("pattern")?.as_str(),
        "Grep" => input.get("pattern")?.as_str(),
        "Agent" => input.get("description")?.as_str(),
        _ => None,
    };
    value.map(|s| s.chars().take(120).collect())
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
        }
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
    fn push_history_caps_at_50() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        for i in 0..55 {
            s.set_current_tool(make_tool(&format!("Tool{}", i), None));
        }
        assert_eq!(s.tool_history.len(), 50);
        assert_eq!(s.tool_history[0].tool_name, "Tool4");
        assert_eq!(s.tool_history[49].tool_name, "Tool53");
    }
}
