use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Scope for hook installation target
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookScope {
    User,
    Project,
}

/// Status of Jackdaw hooks in a settings file
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HookStatus {
    NotInstalled,
    Installed,
    Outdated,
}

/// Resolve the jackdaw send command.
/// Uses the current executable path with "send" subcommand, falls back to PATH.
pub fn jackdaw_send_command() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if exe.exists() {
            return format!("{} send", exe.to_string_lossy());
        }
    }
    "jackdaw send".to_string()
}

/// Events we install hooks for
const HOOK_EVENTS: &[&str] = &["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Notification"];

/// Resolve the settings.json path for the given scope
pub fn get_settings_path(scope: &HookScope, cwd: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        HookScope::User => {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            Ok(home.join(".claude").join("settings.json"))
        }
        HookScope::Project => {
            let cwd = cwd.ok_or("Project scope requires a working directory path")?;
            Ok(PathBuf::from(cwd).join(".claude").join("settings.json"))
        }
    }
}

/// Read and parse a settings.json file. Returns empty object if file doesn't exist.
pub fn read_settings(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Invalid JSON in {}: {}. Please fix the file manually or remove comments if present.", path.display(), e))
}

/// Write settings JSON to file atomically (write to temp, then rename).
/// Creates parent directories if they don't exist.
pub fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?
        + "\n";

    // Atomic write: write to temp file then rename
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write {}: {}", temp_path.display(), e))?;
    fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}

/// Check whether Jackdaw hooks are installed in the given settings
pub fn check_status(settings: &Value) -> HookStatus {
    let hooks = match settings.get("hooks") {
        Some(h) if h.is_object() => h,
        _ => return HookStatus::NotInstalled,
    };

    let expected_cmd = jackdaw_send_command();
    let mut found_count = 0;

    for event_name in HOOK_EVENTS {
        if let Some(event_array) = hooks.get(event_name).and_then(|v| v.as_array()) {
            let has_jackdaw_hook = event_array.iter().any(|matcher_group| {
                if let Some(hook_list) = matcher_group.get("hooks").and_then(|v| v.as_array()) {
                    hook_list.iter().any(|hook| {
                        hook.get("type").and_then(|t| t.as_str()) == Some("command")
                            && hook.get("command").and_then(|c| c.as_str())
                                .map(|cmd| cmd == expected_cmd)
                                .unwrap_or(false)
                    })
                } else {
                    false
                }
            });
            if has_jackdaw_hook {
                found_count += 1;
            }
        }
    }

    if found_count == HOOK_EVENTS.len() {
        HookStatus::Installed
    } else if found_count > 0 {
        HookStatus::Outdated
    } else {
        HookStatus::NotInstalled
    }
}

/// Build the Jackdaw hook entry for a single event
fn jackdaw_matcher_group() -> Value {
    serde_json::json!({
        "hooks": [{
            "type": "command",
            "command": jackdaw_send_command(),
            "timeout": 5
        }]
    })
}

/// Returns true if a matcher group contains a Jackdaw hook.
/// Matches commands containing "jackdaw-send", "jackdaw send", or "jackdaw" with "send" arg.
fn is_jackdaw_matcher_group(mg: &Value) -> bool {
    mg.get("hooks")
        .and_then(|v| v.as_array())
        .map(|hooks| hooks.iter().any(|h| {
            h.get("type").and_then(|t| t.as_str()) == Some("command")
                && h.get("command").and_then(|c| c.as_str())
                    .map(|cmd| cmd.contains("jackdaw-send") || cmd.contains("jackdaw") && cmd.contains("send"))
                    .unwrap_or(false)
        }))
        .unwrap_or(false)
}

/// Install or update Jackdaw hooks in a settings Value.
/// Preserves all existing non-Jackdaw hooks.
pub fn install(settings: &mut Value) -> Result<(), String> {
    let settings_obj = settings
        .as_object_mut()
        .ok_or("Settings file root is not a JSON object")?;

    let hooks = settings_obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));

    let hooks_obj = hooks.as_object_mut()
        .ok_or("'hooks' field is not a JSON object")?;

    for event_name in HOOK_EVENTS {
        let event_array = hooks_obj
            .entry(*event_name)
            .or_insert_with(|| serde_json::json!([]));

        let arr = event_array.as_array_mut()
            .ok_or_else(|| format!("'{}' hook event is not an array", event_name))?;

        // Remove any existing Jackdaw matcher groups (update in place)
        arr.retain(|mg| !is_jackdaw_matcher_group(mg));

        // Append the new one
        arr.push(jackdaw_matcher_group());
    }

    Ok(())
}

/// Remove all Jackdaw hooks from a settings Value.
/// Preserves all other hooks. Removes empty event arrays.
pub fn uninstall(settings: &mut Value) {
    let hooks = match settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        Some(h) => h,
        None => return,
    };

    for event_name in HOOK_EVENTS {
        if let Some(event_array) = hooks.get_mut(*event_name).and_then(|v| v.as_array_mut()) {
            event_array.retain(|mg| !is_jackdaw_matcher_group(mg));
        }
    }

    // Clean up empty event arrays
    let empty_keys: Vec<String> = hooks
        .iter()
        .filter(|(_, v)| v.as_array().map(|a| a.is_empty()).unwrap_or(false))
        .map(|(k, _)| k.clone())
        .collect();
    for key in empty_keys {
        hooks.remove(&key);
    }

    // Remove hooks object entirely if empty
    if hooks.is_empty() {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("hooks");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_jackdaw_matcher_group_command_type() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "/usr/bin/jackdaw-send", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_bare_command() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "jackdaw-send", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_non_jackdaw_command() {
        let mg = json!({
            "hooks": [{"type": "command", "command": "other-tool"}]
        });
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_missing_hooks_field() {
        let mg = json!({"matcher": "something"});
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_empty_hooks_array() {
        let mg = json!({"hooks": []});
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    fn full_installed_settings() -> Value {
        let cmd = jackdaw_send_command();
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop",
                       "SessionEnd", "UserPromptSubmit", "SubagentStart",
                       "SubagentStop", "Notification"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "command", "command": cmd, "timeout": 5}]
            }]));
        }
        json!({"hooks": hooks})
    }

    #[test]
    fn check_status_empty_settings() {
        let settings = json!({});
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_no_hooks_key() {
        let settings = json!({"other": "stuff"});
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_all_installed() {
        let settings = full_installed_settings();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
    }

    #[test]
    fn check_status_partial_install() {
        let cmd = jackdaw_send_command();
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "command", "command": cmd, "timeout": 5}]
            }]));
        }
        let settings = json!({"hooks": hooks});
        assert!(matches!(check_status(&settings), HookStatus::Outdated));
    }

    #[test]
    fn install_empty_settings() {
        let mut settings = json!({});
        install(&mut settings).unwrap();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
    }

    #[test]
    fn install_preserves_non_jackdaw_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": {"tool_name": "Bash"},
                    "hooks": [{"type": "http", "url": "http://other-service.com/hook"}]
                }]
            }
        });
        install(&mut settings).unwrap();
        assert!(matches!(check_status(&settings), HookStatus::Installed));
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 2);
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other-service.com/hook");
    }

    #[test]
    fn uninstall_removes_jackdaw_hooks() {
        let mut settings = json!({});
        install(&mut settings).unwrap();
        uninstall(&mut settings);
        assert!(matches!(check_status(&settings), HookStatus::NotInstalled));
        assert!(settings.get("hooks").is_none());
    }

    #[test]
    fn uninstall_preserves_other_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"type": "http", "url": "http://other.com/hook"}]},
                    {"hooks": [{"type": "command", "command": "jackdaw-send", "timeout": 5}]}
                ]
            }
        });
        uninstall(&mut settings);
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other.com/hook");
    }

    #[test]
    fn uninstall_noop_when_not_installed() {
        let mut settings = json!({"other": "data"});
        uninstall(&mut settings);
        assert_eq!(settings, json!({"other": "data"}));
    }

    #[test]
    fn read_settings_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"hooks":{}}"#).unwrap();
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({"hooks": {}}));
    }

    #[test]
    fn read_settings_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({}));
    }

    #[test]
    fn write_settings_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("dir").join("settings.json");
        let settings = json!({"hooks": {}});
        write_settings(&path, &settings).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        let parsed: Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, settings);
    }

    #[test]
    fn write_settings_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = json!({});
        install(&mut settings).unwrap();
        write_settings(&path, &settings).unwrap();
        let loaded = read_settings(&path).unwrap();
        assert!(matches!(check_status(&loaded), HookStatus::Installed));
    }

    #[test]
    fn write_settings_atomic_no_temp_file_left() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = json!({"test": true});
        write_settings(&path, &settings).unwrap();
        let temp_path = path.with_extension("json.tmp");
        assert!(!temp_path.exists());
        assert!(path.exists());
    }
}
