use serde::{Deserialize, Serialize};

fn default_timeout() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomCommand {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CommandsConfig {
    commands: Vec<CustomCommand>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

/// Parse commands from a JSON string. Returns empty vec on invalid input.
pub fn parse_commands(json: &str) -> Vec<CustomCommand> {
    serde_json::from_str::<CommandsConfig>(json)
        .map(|c| c.commands)
        .unwrap_or_default()
}

/// Read commands from a project's `.jackdaw/commands.json` file.
pub fn read_project_commands(cwd: &str) -> Vec<CustomCommand> {
    let path = std::path::Path::new(cwd).join(".jackdaw/commands.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => parse_commands(&contents),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_commands_all_fields() {
        let json = r#"{"commands":[{"name":"Test","command":"npm test","icon":"test","timeout":60}]}"#;
        let cmds = parse_commands(json);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].name, "Test");
        assert_eq!(cmds[0].command, "npm test");
        assert_eq!(cmds[0].icon, Some("test".into()));
        assert_eq!(cmds[0].timeout, 60);
    }

    #[test]
    fn parse_commands_required_fields_only() {
        let json = r#"{"commands":[{"name":"Build","command":"cargo build"}]}"#;
        let cmds = parse_commands(json);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].icon, None);
        assert_eq!(cmds[0].timeout, 30);
    }

    #[test]
    fn parse_commands_empty_array() {
        let json = r#"{"commands":[]}"#;
        let cmds = parse_commands(json);
        assert!(cmds.is_empty());
    }

    #[test]
    fn parse_commands_malformed_json() {
        let cmds = parse_commands("not json");
        assert!(cmds.is_empty());
    }

    #[test]
    fn parse_commands_wrong_structure() {
        let json = r#"{"items":[{"name":"Test"}]}"#;
        let cmds = parse_commands(json);
        assert!(cmds.is_empty());
    }

    #[test]
    fn read_project_commands_missing_file() {
        let cmds = read_project_commands("/tmp/nonexistent-dir-12345");
        assert!(cmds.is_empty());
    }
}
