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
