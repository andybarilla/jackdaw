use serde::{Deserialize, Serialize};

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
}
