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
}

/// Internal session state
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    pub started_at: DateTime<Utc>,
    pub current_tool: Option<ToolEvent>,
    pub tool_history: Vec<ToolEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolEvent {
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,
    pub summary: Option<String>,
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
        }
    }

    pub fn set_current_tool(&mut self, tool: ToolEvent) {
        self.current_tool = Some(tool);
    }

    pub fn complete_current_tool(&mut self, tool: ToolEvent) {
        // If there's a current tool, move it to history
        if let Some(current) = self.current_tool.take() {
            self.tool_history.push(current);
        } else {
            // PostToolUse without PreToolUse — add directly
            self.tool_history.push(tool);
            if self.tool_history.len() > MAX_TOOL_HISTORY {
                self.tool_history.remove(0);
            }
            return;
        }
        if self.tool_history.len() > MAX_TOOL_HISTORY {
            self.tool_history.remove(0);
        }
    }
}
