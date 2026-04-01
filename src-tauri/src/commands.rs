use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

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

const MAX_OUTPUT_BYTES: usize = 10 * 1024;

fn truncate_output(bytes: Vec<u8>) -> String {
    let s = String::from_utf8_lossy(&bytes);
    if s.len() > MAX_OUTPUT_BYTES {
        s[..MAX_OUTPUT_BYTES].to_string()
    } else {
        s.into_owned()
    }
}

pub async fn run_command(cwd: &str, command: &str, timeout_secs: u64) -> Result<CommandResult, String> {
    let mut child = Command::new("sh")
        .args(["-c", command])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn: {e}"))?;

    let result = timeout(Duration::from_secs(timeout_secs), async {
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();

        if let Some(ref mut stdout) = child.stdout {
            let _ = stdout.read_to_end(&mut stdout_buf).await;
        }
        if let Some(ref mut stderr) = child.stderr {
            let _ = stderr.read_to_end(&mut stderr_buf).await;
        }

        let status = child.wait().await.map_err(|e| format!("wait failed: {e}"))?;
        Ok::<_, String>((stdout_buf, stderr_buf, status))
    })
    .await;

    match result {
        Ok(Ok((stdout_buf, stderr_buf, status))) => Ok(CommandResult {
            stdout: truncate_output(stdout_buf),
            stderr: truncate_output(stderr_buf),
            exit_code: status.code(),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.kill().await;
            Ok(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                timed_out: true,
            })
        }
    }
}

#[tauri::command]
pub async fn get_custom_commands(cwd: String, app: tauri::AppHandle) -> Result<Vec<CustomCommand>, String> {
    use tauri_plugin_store::StoreExt;

    let mut commands = read_project_commands(&cwd);

    if let Ok(store) = app.store("settings.json") {
        if let Some(value) = store.get("commands") {
            if let Ok(config) = serde_json::from_value::<CommandsConfig>(value) {
                commands.extend(config.commands);
            }
        }
    }

    Ok(commands)
}

#[tauri::command]
pub async fn run_custom_command(cwd: String, command: String, timeout_secs: u64) -> Result<CommandResult, String> {
    run_command(&cwd, &command, timeout_secs).await
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

    #[tokio::test]
    async fn run_command_captures_stdout() {
        let result = run_command("/tmp", "echo hello", 5).await.unwrap();
        assert_eq!(result.stdout.trim(), "hello");
        assert_eq!(result.exit_code, Some(0));
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn run_command_captures_stderr() {
        let result = run_command("/tmp", "echo err >&2", 5).await.unwrap();
        assert_eq!(result.stderr.trim(), "err");
    }

    #[tokio::test]
    async fn run_command_captures_nonzero_exit() {
        let result = run_command("/tmp", "exit 42", 5).await.unwrap();
        assert_eq!(result.exit_code, Some(42));
    }

    #[tokio::test]
    async fn run_command_kills_after_timeout() {
        let result = run_command("/tmp", "sleep 60", 1).await.unwrap();
        assert!(result.timed_out);
    }

    #[tokio::test]
    async fn run_command_truncates_large_output() {
        let result = run_command("/tmp", "yes | head -5000", 5).await.unwrap();
        assert!(result.stdout.len() <= MAX_OUTPUT_BYTES);
    }
}
