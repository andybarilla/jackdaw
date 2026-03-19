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

/// Build the Jackdaw hook entry for a single event
fn jackdaw_matcher_group(port: u16) -> Value {
    serde_json::json!({
        "hooks": [{
            "type": "http",
            "url": jackdaw_hook_url(port),
            "timeout": 5
        }]
    })
}

/// Returns true if a matcher group contains a Jackdaw hook (any localhost:*/events URL)
fn is_jackdaw_matcher_group(mg: &Value) -> bool {
    mg.get("hooks")
        .and_then(|v| v.as_array())
        .map(|hooks| hooks.iter().any(|h| {
            h.get("type").and_then(|t| t.as_str()) == Some("http")
                && h.get("url").and_then(|u| u.as_str())
                    .map(|url| url.contains("localhost") && url.ends_with("/events"))
                    .unwrap_or(false)
        }))
        .unwrap_or(false)
}

/// Install or update Jackdaw hooks in a settings Value.
/// Preserves all existing non-Jackdaw hooks.
pub fn install(settings: &mut Value, port: u16) -> Result<(), String> {
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
        arr.push(jackdaw_matcher_group(port));
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
