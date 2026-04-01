use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertTier {
    High,
    Medium,
    Low,
    Off,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertPrefs {
    pub on_approval_needed: AlertTier,
    pub on_session_end: AlertTier,
    pub on_stop: AlertTier,
}

impl Default for AlertPrefs {
    fn default() -> Self {
        Self {
            on_approval_needed: AlertTier::High,
            on_session_end: AlertTier::Low,
            on_stop: AlertTier::Medium,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPrefs {
    pub on_approval_needed: bool,
    pub on_session_end: bool,
    pub on_stop: bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            on_approval_needed: true,
            on_session_end: true,
            on_stop: true,
        }
    }
}

pub fn should_notify(event_name: &str, is_visible: bool, prefs: &NotificationPrefs) -> bool {
    if is_visible {
        return false;
    }
    match event_name {
        "Notification" => prefs.on_approval_needed,
        "Stop" => prefs.on_stop,
        "SessionEnd" => prefs.on_session_end,
        _ => false,
    }
}

pub async fn run_notification_command(
    command: &str,
    session_id: &str,
    event_name: &str,
    cwd: &str,
    title: &str,
    body: &str,
) {
    let expanded = if command.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            format!("{}{}", home.display(), &command[1..])
        } else {
            command.to_string()
        }
    } else {
        command.to_string()
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("sh")
            .args(["-c", &expanded])
            .env("JACKDAW_SESSION_ID", session_id)
            .env("JACKDAW_EVENT", event_name)
            .env("JACKDAW_CWD", cwd)
            .env("JACKDAW_TITLE", title)
            .env("JACKDAW_BODY", body)
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) if !output.status.success() => {
            eprintln!(
                "notification command exited {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Ok(Err(e)) => eprintln!("notification command failed: {e}"),
        Err(_) => eprintln!("notification command timed out"),
        _ => {}
    }
}

pub fn notification_content(event_name: &str, cwd: &str) -> Option<(&'static str, String)> {
    let (title, body) = match event_name {
        "Notification" => ("Approval Needed", format!("Session in {} needs approval", cwd)),
        "Stop" => ("Waiting for Input", format!("Session in {} is waiting", cwd)),
        "SessionEnd" => ("Session Ended", format!("Session in {} has ended", cwd)),
        _ => return None,
    };
    Some((title, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alert_tier_serializes_lowercase() {
        assert_eq!(serde_json::to_value(AlertTier::High).unwrap(), "high");
        assert_eq!(serde_json::to_value(AlertTier::Medium).unwrap(), "medium");
        assert_eq!(serde_json::to_value(AlertTier::Low).unwrap(), "low");
        assert_eq!(serde_json::to_value(AlertTier::Off).unwrap(), "off");
    }

    #[test]
    fn alert_tier_deserializes_lowercase() {
        assert_eq!(serde_json::from_str::<AlertTier>("\"high\"").unwrap(), AlertTier::High);
        assert_eq!(serde_json::from_str::<AlertTier>("\"off\"").unwrap(), AlertTier::Off);
    }

    #[test]
    fn alert_prefs_defaults() {
        let prefs = AlertPrefs::default();
        assert_eq!(prefs.on_approval_needed, AlertTier::High);
        assert_eq!(prefs.on_stop, AlertTier::Medium);
        assert_eq!(prefs.on_session_end, AlertTier::Low);
    }

    #[test]
    fn not_notified_when_focused() {
        let prefs = NotificationPrefs::default();
        assert!(!should_notify("Notification", true, &prefs));
        assert!(!should_notify("Stop", true, &prefs));
        assert!(!should_notify("SessionEnd", true, &prefs));
    }

    #[test]
    fn notified_when_not_focused_and_enabled() {
        let prefs = NotificationPrefs::default();
        assert!(should_notify("Notification", false, &prefs));
        assert!(should_notify("Stop", false, &prefs));
        assert!(should_notify("SessionEnd", false, &prefs));
    }

    #[test]
    fn not_notified_when_pref_disabled() {
        let prefs = NotificationPrefs {
            on_approval_needed: false,
            on_session_end: false,
            on_stop: false,
        };
        assert!(!should_notify("Notification", false, &prefs));
        assert!(!should_notify("Stop", false, &prefs));
        assert!(!should_notify("SessionEnd", false, &prefs));
    }

    #[test]
    fn not_notified_for_irrelevant_events() {
        let prefs = NotificationPrefs::default();
        assert!(!should_notify("PreToolUse", false, &prefs));
        assert!(!should_notify("PostToolUse", false, &prefs));
        assert!(!should_notify("SessionStart", false, &prefs));
        assert!(!should_notify("UserPromptSubmit", false, &prefs));
    }

    #[test]
    fn selective_prefs() {
        let prefs = NotificationPrefs {
            on_approval_needed: true,
            on_session_end: false,
            on_stop: true,
        };
        assert!(should_notify("Notification", false, &prefs));
        assert!(!should_notify("SessionEnd", false, &prefs));
        assert!(should_notify("Stop", false, &prefs));
    }

    #[test]
    fn notification_content_for_valid_events() {
        let (title, body) = notification_content("Notification", "/home/user/project").unwrap();
        assert_eq!(title, "Approval Needed");
        assert!(body.contains("/home/user/project"));

        let (title, body) = notification_content("Stop", "/tmp").unwrap();
        assert_eq!(title, "Waiting for Input");
        assert!(body.contains("/tmp"));

        let (title, body) = notification_content("SessionEnd", "/work").unwrap();
        assert_eq!(title, "Session Ended");
        assert!(body.contains("/work"));
    }

    #[test]
    fn notification_content_none_for_irrelevant_events() {
        assert!(notification_content("PreToolUse", "/tmp").is_none());
        assert!(notification_content("PostToolUse", "/tmp").is_none());
    }

    #[tokio::test]
    async fn command_runs_successfully() {
        run_notification_command("true", "sid", "Stop", "/tmp", "title", "body").await;
    }

    #[tokio::test]
    async fn command_receives_env_vars() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("env.txt");
        let cmd = format!("env | grep JACKDAW > {}", out.display());
        run_notification_command(&cmd, "test-session", "Notification", "/home/user", "Approval Needed", "body text").await;

        let contents = std::fs::read_to_string(&out).unwrap();
        assert!(contents.contains("JACKDAW_SESSION_ID=test-session"));
        assert!(contents.contains("JACKDAW_EVENT=Notification"));
        assert!(contents.contains("JACKDAW_CWD=/home/user"));
        assert!(contents.contains("JACKDAW_TITLE=Approval Needed"));
        assert!(contents.contains("JACKDAW_BODY=body text"));
    }

    #[tokio::test]
    async fn command_nonzero_exit_does_not_panic() {
        run_notification_command("exit 1", "sid", "Stop", "/tmp", "t", "b").await;
    }

    #[tokio::test]
    async fn command_timeout() {
        let start = std::time::Instant::now();
        run_notification_command("sleep 30", "sid", "Stop", "/tmp", "t", "b").await;
        assert!(start.elapsed().as_secs() < 15);
    }

    #[tokio::test]
    async fn tilde_expansion() {
        let home = dirs::home_dir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("tilde.txt");
        // Create a script in home dir, run it via tilde path
        let script = home.join(".jackdaw-test-tilde.sh");
        std::fs::write(&script, format!("#!/bin/sh\necho ok > {}", out.display())).unwrap();
        std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        run_notification_command("~/.jackdaw-test-tilde.sh", "sid", "Stop", "/tmp", "t", "b").await;

        let contents = std::fs::read_to_string(&out).unwrap();
        assert_eq!(contents.trim(), "ok");
        std::fs::remove_file(&script).unwrap();
    }
}
