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

/// The URL pattern we use to identify Jackdaw hooks
fn jackdaw_hook_url(port: u16) -> String {
    format!("http://localhost:{}/events", port)
}

/// Events we install hooks for
const HOOK_EVENTS: &[&str] = &["SessionStart", "PreToolUse", "PostToolUse", "Stop"];

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
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Atomic write: write to temp file then rename
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write {}: {}", temp_path.display(), e))?;
    fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}

/// Check whether Jackdaw hooks are installed in the given settings
pub fn check_status(settings: &Value, port: u16) -> HookStatus {
    let hooks = match settings.get("hooks") {
        Some(h) if h.is_object() => h,
        _ => return HookStatus::NotInstalled,
    };

    let expected_url = jackdaw_hook_url(port);
    let mut found_count = 0;

    for event_name in HOOK_EVENTS {
        if let Some(event_array) = hooks.get(event_name).and_then(|v| v.as_array()) {
            let has_jackdaw_hook = event_array.iter().any(|matcher_group| {
                if let Some(hook_list) = matcher_group.get("hooks").and_then(|v| v.as_array()) {
                    hook_list.iter().any(|hook| {
                        hook.get("type").and_then(|t| t.as_str()) == Some("http")
                            && hook.get("url").and_then(|u| u.as_str()) == Some(&expected_url)
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
        // Check if there are hooks with a different port (localhost:*/events pattern)
        let has_old_jackdaw = HOOK_EVENTS.iter().any(|event_name| {
            hooks.get(event_name)
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().any(|mg| {
                    mg.get("hooks")
                        .and_then(|v| v.as_array())
                        .map(|hooks| hooks.iter().any(|h| {
                            h.get("type").and_then(|t| t.as_str()) == Some("http")
                                && h.get("url").and_then(|u| u.as_str())
                                    .map(|url| url.contains("localhost") && url.ends_with("/events"))
                                    .unwrap_or(false)
                        }))
                        .unwrap_or(false)
                }))
                .unwrap_or(false)
        });
        if has_old_jackdaw {
            HookStatus::Outdated
        } else {
            HookStatus::NotInstalled
        }
    }
}
