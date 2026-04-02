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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringProfile {
    pub id: String,
    pub name: String,
    pub directories: Vec<String>,
    pub alerts: AlertPrefs,
    pub alert_volume: u32,
    pub notification_command: String,
}

pub fn find_profile_for_cwd<'a>(profiles: &'a [MonitoringProfile], cwd: &str) -> Option<&'a MonitoringProfile> {
    profiles.iter().find(|p| p.directories.iter().any(|d| d == cwd))
}

pub fn resolve_alert_tier(event_name: &str, is_visible: bool, prefs: &AlertPrefs) -> AlertTier {
    if is_visible {
        return AlertTier::Off;
    }
    match event_name {
        "Notification" | "PermissionRequest" => prefs.on_approval_needed,
        "Stop" => prefs.on_stop,
        "SessionEnd" => prefs.on_session_end,
        _ => AlertTier::Off,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AlertChannels {
    pub sound: bool,
    pub tray_animation: bool,
    pub card_pulse: bool,
    pub dock_bounce: bool,
    pub desktop_notification: bool,
}

pub fn alert_channels(tier: AlertTier) -> AlertChannels {
    match tier {
        AlertTier::High => AlertChannels {
            sound: true,
            tray_animation: true,
            card_pulse: true,
            dock_bounce: true,
            desktop_notification: true,
        },
        AlertTier::Medium => AlertChannels {
            sound: true,
            tray_animation: true,
            card_pulse: true,
            dock_bounce: false,
            desktop_notification: true,
        },
        AlertTier::Low => AlertChannels {
            sound: true,
            tray_animation: false,
            card_pulse: true,
            dock_bounce: false,
            desktop_notification: false,
        },
        AlertTier::Off => AlertChannels {
            sound: false,
            tray_animation: false,
            card_pulse: false,
            dock_bounce: false,
            desktop_notification: false,
        },
    }
}

pub fn migrate_alert_prefs(value: serde_json::Value) -> AlertPrefs {
    if let Ok(prefs) = serde_json::from_value::<AlertPrefs>(value.clone()) {
        return prefs;
    }
    if let Ok(old) = serde_json::from_value::<NotificationPrefs>(value) {
        return AlertPrefs {
            on_approval_needed: if old.on_approval_needed { AlertTier::High } else { AlertTier::Off },
            on_stop: if old.on_stop { AlertTier::Medium } else { AlertTier::Off },
            on_session_end: if old.on_session_end { AlertTier::Low } else { AlertTier::Off },
        };
    }
    AlertPrefs::default()
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
        "Notification" | "PermissionRequest" => ("Approval Needed", format!("Session in {} needs approval", cwd)),
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

    #[test]
    fn resolve_tier_returns_off_when_visible() {
        let prefs = AlertPrefs::default();
        assert_eq!(resolve_alert_tier("Notification", true, &prefs), AlertTier::Off);
        assert_eq!(resolve_alert_tier("Stop", true, &prefs), AlertTier::Off);
        assert_eq!(resolve_alert_tier("SessionEnd", true, &prefs), AlertTier::Off);
    }

    #[test]
    fn resolve_tier_returns_configured_tier_when_not_visible() {
        let prefs = AlertPrefs::default();
        assert_eq!(resolve_alert_tier("Notification", false, &prefs), AlertTier::High);
        assert_eq!(resolve_alert_tier("Stop", false, &prefs), AlertTier::Medium);
        assert_eq!(resolve_alert_tier("SessionEnd", false, &prefs), AlertTier::Low);
    }

    #[test]
    fn resolve_tier_returns_off_for_irrelevant_events() {
        let prefs = AlertPrefs::default();
        assert_eq!(resolve_alert_tier("PreToolUse", false, &prefs), AlertTier::Off);
        assert_eq!(resolve_alert_tier("PostToolUse", false, &prefs), AlertTier::Off);
        assert_eq!(resolve_alert_tier("SessionStart", false, &prefs), AlertTier::Off);
    }

    #[test]
    fn resolve_tier_respects_custom_prefs() {
        let prefs = AlertPrefs {
            on_approval_needed: AlertTier::Low,
            on_session_end: AlertTier::Off,
            on_stop: AlertTier::High,
        };
        assert_eq!(resolve_alert_tier("Notification", false, &prefs), AlertTier::Low);
        assert_eq!(resolve_alert_tier("SessionEnd", false, &prefs), AlertTier::Off);
        assert_eq!(resolve_alert_tier("Stop", false, &prefs), AlertTier::High);
    }

    #[test]
    fn alert_channels_high() {
        let ch = alert_channels(AlertTier::High);
        assert!(ch.sound);
        assert!(ch.tray_animation);
        assert!(ch.card_pulse);
        assert!(ch.dock_bounce);
        assert!(ch.desktop_notification);
    }

    #[test]
    fn alert_channels_medium() {
        let ch = alert_channels(AlertTier::Medium);
        assert!(ch.sound);
        assert!(ch.tray_animation);
        assert!(ch.card_pulse);
        assert!(!ch.dock_bounce);
        assert!(ch.desktop_notification);
    }

    #[test]
    fn alert_channels_low() {
        let ch = alert_channels(AlertTier::Low);
        assert!(ch.sound);
        assert!(!ch.tray_animation);
        assert!(ch.card_pulse);
        assert!(!ch.dock_bounce);
        assert!(!ch.desktop_notification);
    }

    #[test]
    fn alert_channels_off() {
        let ch = alert_channels(AlertTier::Off);
        assert!(!ch.sound);
        assert!(!ch.tray_animation);
        assert!(!ch.card_pulse);
        assert!(!ch.dock_bounce);
        assert!(!ch.desktop_notification);
    }

    #[test]
    fn migrate_old_bool_prefs_all_enabled() {
        let old_json = serde_json::json!({
            "on_approval_needed": true,
            "on_session_end": true,
            "on_stop": true
        });
        let prefs = migrate_alert_prefs(old_json);
        assert_eq!(prefs.on_approval_needed, AlertTier::High);
        assert_eq!(prefs.on_stop, AlertTier::Medium);
        assert_eq!(prefs.on_session_end, AlertTier::Low);
    }

    #[test]
    fn migrate_old_bool_prefs_some_disabled() {
        let old_json = serde_json::json!({
            "on_approval_needed": false,
            "on_session_end": true,
            "on_stop": false
        });
        let prefs = migrate_alert_prefs(old_json);
        assert_eq!(prefs.on_approval_needed, AlertTier::Off);
        assert_eq!(prefs.on_stop, AlertTier::Off);
        assert_eq!(prefs.on_session_end, AlertTier::Low);
    }

    #[test]
    fn migrate_new_tier_prefs_passes_through() {
        let new_json = serde_json::json!({
            "on_approval_needed": "medium",
            "on_session_end": "off",
            "on_stop": "high"
        });
        let prefs = migrate_alert_prefs(new_json);
        assert_eq!(prefs.on_approval_needed, AlertTier::Medium);
        assert_eq!(prefs.on_stop, AlertTier::High);
        assert_eq!(prefs.on_session_end, AlertTier::Off);
    }

    #[test]
    fn migrate_invalid_json_returns_defaults() {
        let bad_json = serde_json::json!("garbage");
        let prefs = migrate_alert_prefs(bad_json);
        assert_eq!(prefs.on_approval_needed, AlertTier::High);
        assert_eq!(prefs.on_stop, AlertTier::Medium);
        assert_eq!(prefs.on_session_end, AlertTier::Low);
    }

    #[test]
    fn monitoring_profile_serializes_roundtrip() {
        let profile = MonitoringProfile {
            id: "test-id".to_string(),
            name: "Work".to_string(),
            directories: vec!["/home/user/work".to_string()],
            alerts: AlertPrefs::default(),
            alert_volume: 80,
            notification_command: String::new(),
        };
        let json = serde_json::to_value(&profile).unwrap();
        let deserialized: MonitoringProfile = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.id, "test-id");
        assert_eq!(deserialized.name, "Work");
        assert_eq!(deserialized.directories.len(), 1);
        assert_eq!(deserialized.alert_volume, 80);
    }

    #[test]
    fn find_profile_matches_exact_cwd() {
        let profiles = vec![MonitoringProfile {
            id: "p1".to_string(),
            name: "Work".to_string(),
            directories: vec!["/home/user/work".to_string(), "/home/user/work2".to_string()],
            alerts: AlertPrefs {
                on_approval_needed: AlertTier::Off,
                on_session_end: AlertTier::Off,
                on_stop: AlertTier::Off,
            },
            alert_volume: 50,
            notification_command: String::new(),
        }];
        let result = find_profile_for_cwd(&profiles, "/home/user/work");
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "Work");
    }

    #[test]
    fn find_profile_returns_none_for_unmatched_cwd() {
        let profiles = vec![MonitoringProfile {
            id: "p1".to_string(),
            name: "Work".to_string(),
            directories: vec!["/home/user/work".to_string()],
            alerts: AlertPrefs::default(),
            alert_volume: 80,
            notification_command: String::new(),
        }];
        let result = find_profile_for_cwd(&profiles, "/home/user/personal");
        assert!(result.is_none());
    }

    #[test]
    fn find_profile_no_partial_match() {
        let profiles = vec![MonitoringProfile {
            id: "p1".to_string(),
            name: "Work".to_string(),
            directories: vec!["/home/user/work".to_string()],
            alerts: AlertPrefs::default(),
            alert_volume: 80,
            notification_command: String::new(),
        }];
        // Subdirectory should NOT match — exact only
        let result = find_profile_for_cwd(&profiles, "/home/user/work/subdir");
        assert!(result.is_none());
    }

    #[test]
    fn find_profile_empty_profiles_returns_none() {
        let result = find_profile_for_cwd(&[], "/any/path");
        assert!(result.is_none());
    }

    #[test]
    fn profiles_vec_serializes_to_json_array() {
        let profiles = vec![
            MonitoringProfile {
                id: "p1".to_string(),
                name: "Work".to_string(),
                directories: vec!["/work".to_string()],
                alerts: AlertPrefs::default(),
                alert_volume: 80,
                notification_command: String::new(),
            },
            MonitoringProfile {
                id: "p2".to_string(),
                name: "Personal".to_string(),
                directories: vec!["/personal".to_string()],
                alerts: AlertPrefs {
                    on_approval_needed: AlertTier::Off,
                    on_session_end: AlertTier::Off,
                    on_stop: AlertTier::Off,
                },
                alert_volume: 0,
                notification_command: "echo hi".to_string(),
            },
        ];
        let json = serde_json::to_value(&profiles).unwrap();
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["name"], "Work");
        assert_eq!(arr[1]["notification_command"], "echo hi");

        // Roundtrip
        let deserialized: Vec<MonitoringProfile> = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.len(), 2);
        assert_eq!(deserialized[0].id, "p1");
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
