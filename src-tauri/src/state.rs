use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Incoming hook payload from Claude Code (via POST /events)
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
    pub agent_id: Option<String>,
}

/// Internal session state
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    pub started_at: DateTime<Utc>,
    pub current_tool: Option<ToolEvent>,
    pub tool_history: Vec<ToolEvent>,
    pub active_subagents: u32,
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
    pub port: u16,
}

impl AppState {
    pub fn new(port: u16) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            port,
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

const MAX_TOOL_HISTORY: usize = 50;

impl Session {
    pub fn new(session_id: String, cwd: String) -> Self {
        Self {
            session_id,
            cwd,
            started_at: Utc::now(),
            current_tool: None,
            tool_history: Vec::new(),
            active_subagents: 0,
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

    fn push_history(&mut self, tool: ToolEvent) {
        self.tool_history.push(tool);
        if self.tool_history.len() > MAX_TOOL_HISTORY {
            self.tool_history.remove(0);
        }
    }
}
