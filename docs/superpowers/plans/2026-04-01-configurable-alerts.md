# Configurable Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace boolean notification toggles with an urgency-tier system (High/Medium/Low/Off) that controls sound, tray animation, session card pulse, dock bounce, and desktop notifications per event type.

**Architecture:** Backend resolves event → tier mapping and signals the frontend via an `alert_tier` field on sessions. Tray animation runs in a background tokio task cycling embedded icon frames. Sound playback and card pulse are frontend-only (Web Audio API + CSS animations). Settings UI uses preset dropdowns instead of checkboxes.

**Tech Stack:** Rust (Tauri backend), Svelte 5 with runes, Web Audio API, tauri-plugin-notification, tauri-plugin-store

---

## File Structure

**Backend (modify):**
- `src-tauri/src/notify.rs` — Replace `NotificationPrefs`/`should_notify` with `AlertTier`/`AlertPrefs`/`resolve_alert_tier`
- `src-tauri/src/state.rs` — Add `alert_tier: Option<String>` to `Session`
- `src-tauri/src/server.rs` — Use new alert resolution, trigger tray animation + dock bounce
- `src-tauri/src/tray.rs` — Add animation frame cycling logic

**Frontend (modify):**
- `src/lib/types.ts` — Add `AlertTier` type, update `Session`
- `src/lib/stores/sessions.svelte.ts` — Sound playback on alert tier changes
- `src/lib/components/SessionCard.svelte` — CSS pulse animation per tier
- `src/lib/components/Settings.svelte` — Replace checkboxes with dropdowns + volume slider

**Frontend (create):**
- `src/lib/stores/alertSound.svelte.ts` — Sound playback module
- `src/lib/stores/alertSound.test.ts` — Tests for sound module

**Assets (create):**
- `src/lib/assets/sounds/alert-high.wav` — Sharp chime
- `src/lib/assets/sounds/alert-medium.wav` — Softer tone
- `src/lib/assets/sounds/alert-low.wav` — Subtle click
- `static/icons/tray-red-1.png` through `tray-red-4.png` — Red pulse animation frames
- `static/icons/tray-amber-1.png` through `tray-amber-4.png` — Amber pulse animation frames

---

### Task 1: AlertTier Enum and AlertPrefs (Backend)

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Write failing tests for AlertTier and AlertPrefs**

Add these tests to the existing `#[cfg(test)] mod tests` block in `src-tauri/src/notify.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test alert_tier_serializes -- --nocapture`
Expected: FAIL — `AlertTier` not defined

- [ ] **Step 3: Implement AlertTier and AlertPrefs**

Add above the existing `NotificationPrefs` struct in `src-tauri/src/notify.rs`:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test alert_tier -- --nocapture`
Expected: All 3 new tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "feat(alerts): add AlertTier enum and AlertPrefs struct"
```

---

### Task 2: resolve_alert_tier and alert_channels (Backend)

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Write failing tests for resolve_alert_tier**

Add to the test module in `src-tauri/src/notify.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test resolve_tier -- --nocapture`
Expected: FAIL — `resolve_alert_tier` not defined

- [ ] **Step 3: Write failing tests for alert_channels**

Add to the test module:

```rust
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
```

- [ ] **Step 4: Implement resolve_alert_tier and alert_channels**

Add to `src-tauri/src/notify.rs`, below the `AlertPrefs` impl block:

```rust
pub fn resolve_alert_tier(event_name: &str, is_visible: bool, prefs: &AlertPrefs) -> AlertTier {
    if is_visible {
        return AlertTier::Off;
    }
    match event_name {
        "Notification" => prefs.on_approval_needed,
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
```

- [ ] **Step 5: Run all new tests**

Run: `cd src-tauri && cargo test resolve_tier -- --nocapture && cargo test alert_channels -- --nocapture`
Expected: All 8 new tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "feat(alerts): add resolve_alert_tier and alert_channels functions"
```

---

### Task 3: Prefs Migration (Backend)

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Write failing test for migration**

Add to the test module in `src-tauri/src/notify.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test migrate -- --nocapture`
Expected: FAIL — `migrate_alert_prefs` not defined

- [ ] **Step 3: Implement migrate_alert_prefs**

Add to `src-tauri/src/notify.rs`:

```rust
pub fn migrate_alert_prefs(value: serde_json::Value) -> AlertPrefs {
    // Try new format first
    if let Ok(prefs) = serde_json::from_value::<AlertPrefs>(value.clone()) {
        return prefs;
    }
    // Try old boolean format
    if let Ok(old) = serde_json::from_value::<NotificationPrefs>(value) {
        return AlertPrefs {
            on_approval_needed: if old.on_approval_needed { AlertTier::High } else { AlertTier::Off },
            on_stop: if old.on_stop { AlertTier::Medium } else { AlertTier::Off },
            on_session_end: if old.on_session_end { AlertTier::Low } else { AlertTier::Off },
        };
    }
    AlertPrefs::default()
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test migrate -- --nocapture`
Expected: All 4 migration tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "feat(alerts): add prefs migration from boolean to tier format"
```

---

### Task 4: Add alert_tier to Session (Backend + Frontend Types)

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Write failing test for alert_tier field on Session**

Add to the test module in `src-tauri/src/state.rs`:

```rust
#[test]
fn session_new_alert_tier_is_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert!(s.alert_tier.is_none());
}

#[test]
fn session_alert_tier_serializes_when_set() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.alert_tier = Some("high".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["alert_tier"], "high");
}

#[test]
fn session_alert_tier_serializes_null_when_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["alert_tier"].is_null());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test alert_tier -- --nocapture`
Expected: FAIL — `alert_tier` field not found on `Session`

- [ ] **Step 3: Add alert_tier field to Session struct**

In `src-tauri/src/state.rs`, add to the `Session` struct after `parent_session_id`:

```rust
pub alert_tier: Option<String>,
```

In `Session::new()`, add to the returned `Self`:

```rust
alert_tier: None,
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test alert_tier -- --nocapture`
Expected: All 3 new tests PASS

- [ ] **Step 5: Update frontend types**

In `src/lib/types.ts`, add `AlertTier` type and update `Session`:

Add at the top of the file (after the existing type exports):

```typescript
export type AlertTier = 'high' | 'medium' | 'low' | 'off';
```

Add to the `Session` interface after `parent_session_id`:

```typescript
alert_tier: AlertTier | null;
```

- [ ] **Step 6: Run type check**

Run: `npm run check`
Expected: PASS (no type errors)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs src/lib/types.ts
git commit -m "feat(alerts): add alert_tier field to Session"
```

---

### Task 5: Wire Alert Resolution into server.rs

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Update the notification block in handle_event to use AlertPrefs**

In `src-tauri/src/server.rs`, replace the notification block (the block starting with `// Fire desktop notification if appropriate` at ~line 364) with:

```rust
    // Resolve alert tier and fire appropriate channels
    let resolved_tier = {
        use tauri_plugin_store::StoreExt;

        let is_visible = app_handle
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);

        let prefs = app_handle
            .store("settings.json")
            .ok()
            .and_then(|store| {
                store.get("notifications").map(|v| {
                    crate::notify::migrate_alert_prefs(v)
                })
            })
            .unwrap_or_default();

        crate::notify::resolve_alert_tier(&event_name, is_visible, &prefs)
    };

    // Set alert_tier on the session for the frontend
    if resolved_tier != crate::notify::AlertTier::Off {
        let tier_str = match resolved_tier {
            crate::notify::AlertTier::High => "high",
            crate::notify::AlertTier::Medium => "medium",
            crate::notify::AlertTier::Low => "low",
            crate::notify::AlertTier::Off => unreachable!(),
        };
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.alert_tier = Some(tier_str.to_string());
        }
        drop(sessions);

        // Re-emit session list with alert_tier set
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        drop(sessions);
        let _ = app_handle.emit("session-update", &session_list);

        if let Ok(json) = serde_json::to_string(&session_list) {
            let _ = state.subscriber_tx.send(json);
        }

        let channels = crate::notify::alert_channels(resolved_tier);

        // Desktop notification
        if channels.desktop_notification {
            use tauri_plugin_notification::NotificationExt;
            if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
                let _ = app_handle.notification().builder()
                    .title(title)
                    .body(&body)
                    .show();
            }
        }

        // Dock/taskbar bounce (High only)
        if channels.dock_bounce {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.request_user_attention(
                    Some(tauri::UserAttentionType::Critical)
                );
            }
        }

        // Tray animation
        if channels.tray_animation {
            crate::tray::start_tray_animation(app_handle, resolved_tier);
        }

        // Notification command
        {
            use tauri_plugin_store::StoreExt;
            let notification_command = app_handle
                .store("settings.json")
                .ok()
                .and_then(|store| store.get("notification_command"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();

            if !notification_command.is_empty() {
                if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
                    let cmd = notification_command;
                    let sid = session_id.clone();
                    let evt = event_name.clone();
                    let cwd = cwd.clone();
                    let t = title.to_string();
                    let b = body;
                    tokio::spawn(async move {
                        crate::notify::run_notification_command(&cmd, &sid, &evt, &cwd, &t, &b).await;
                    });
                }
            }
        }

        // Clear alert_tier after a short delay so frontend has time to read it
        let state_clone = state.clone();
        let sid_clone = session_id.clone();
        let app_clone = app_handle.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let mut sessions = state_clone.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&sid_clone) {
                session.alert_tier = None;
            }
            let mut session_list: Vec<_> = sessions.values().cloned().collect();
            session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            drop(sessions);
            let _ = app_clone.emit("session-update", &session_list);
        });
    }
```

- [ ] **Step 2: Remove the old notification block**

Delete the old block that used `should_notify` and `NotificationPrefs` (the block from `// Fire desktop notification if appropriate` through the closing brace of that block, ~lines 364–411). The new code above replaces it entirely.

- [ ] **Step 3: Run backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (existing tests still pass; the notification logic tests in server.rs test session state, not the notification dispatch code directly)

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat(alerts): wire alert tier resolution into event handler"
```

---

### Task 6: Tray Icon Animation (Backend)

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Create placeholder animation frame icons**

The animation frames need to exist for the `include_bytes!` macro. Create 8 PNG files (same dimensions as existing tray icons — copy `tray-approval.png` as a starting point; the actual visual design is a polish step done later):

```bash
cd /home/andy/dev/andybarilla/jackdaw
for i in 1 2 3 4; do cp static/icons/tray-approval.png static/icons/tray-red-$i.png; done
for i in 1 2 3 4; do cp static/icons/tray-input.png static/icons/tray-amber-$i.png; done
```

- [ ] **Step 2: Write failing test for tray animation state**

Add to the test module in `src-tauri/src/tray.rs`:

```rust
#[test]
fn animation_frames_high_returns_red_frames() {
    let frames = animation_frames(crate::notify::AlertTier::High);
    assert_eq!(frames.len(), 4);
}

#[test]
fn animation_frames_medium_returns_amber_frames() {
    let frames = animation_frames(crate::notify::AlertTier::Medium);
    assert_eq!(frames.len(), 4);
}

#[test]
fn animation_frames_low_returns_empty() {
    let frames = animation_frames(crate::notify::AlertTier::Low);
    assert!(frames.is_empty());
}

#[test]
fn animation_frames_off_returns_empty() {
    let frames = animation_frames(crate::notify::AlertTier::Off);
    assert!(frames.is_empty());
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test animation_frames -- --nocapture`
Expected: FAIL — `animation_frames` not defined

- [ ] **Step 4: Implement animation frame embedding and accessor**

Add to `src-tauri/src/tray.rs`, after the existing `ICON_IDLE` constant:

```rust
const ICON_RED_1: &[u8] = include_bytes!("../../static/icons/tray-red-1.png");
const ICON_RED_2: &[u8] = include_bytes!("../../static/icons/tray-red-2.png");
const ICON_RED_3: &[u8] = include_bytes!("../../static/icons/tray-red-3.png");
const ICON_RED_4: &[u8] = include_bytes!("../../static/icons/tray-red-4.png");

const ICON_AMBER_1: &[u8] = include_bytes!("../../static/icons/tray-amber-1.png");
const ICON_AMBER_2: &[u8] = include_bytes!("../../static/icons/tray-amber-2.png");
const ICON_AMBER_3: &[u8] = include_bytes!("../../static/icons/tray-amber-3.png");
const ICON_AMBER_4: &[u8] = include_bytes!("../../static/icons/tray-amber-4.png");
```

Add the `animation_frames` function:

```rust
pub fn animation_frames(tier: crate::notify::AlertTier) -> Vec<&'static [u8]> {
    match tier {
        crate::notify::AlertTier::High => vec![ICON_RED_1, ICON_RED_2, ICON_RED_3, ICON_RED_4],
        crate::notify::AlertTier::Medium => vec![ICON_AMBER_1, ICON_AMBER_2, ICON_AMBER_3, ICON_AMBER_4],
        _ => vec![],
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test animation_frames -- --nocapture`
Expected: All 4 tests PASS

- [ ] **Step 6: Implement start_tray_animation and stop_tray_animation**

Add to `src-tauri/src/tray.rs`:

```rust
use std::sync::atomic::{AtomicU64, Ordering};

/// Monotonic counter used to cancel stale animation loops.
static ANIMATION_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn start_tray_animation(app: &AppHandle, tier: crate::notify::AlertTier) {
    let frames = animation_frames(tier);
    if frames.is_empty() {
        return;
    }

    let gen = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();

    tokio::spawn(async move {
        let mut idx = 0;
        loop {
            if ANIMATION_GENERATION.load(Ordering::SeqCst) != gen {
                break;
            }
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                if let Ok(icon) = Image::from_bytes(frames[idx % frames.len()]) {
                    let _ = tray.set_icon(Some(icon));
                }
            }
            idx += 1;
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });
}

pub fn stop_tray_animation(app: &AppHandle, sessions: &[Session]) {
    // Bump generation to cancel any running animation loop
    ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst);
    // Restore the correct static icon
    update_tray(app, sessions);
}
```

- [ ] **Step 7: Add animation stop on window focus**

In `src-tauri/src/tray.rs`, in the `on_tray_icon_event` closure inside `create_tray`, update the click handler to stop animation when showing the window:

Replace the existing `on_tray_icon_event` block:

```rust
.on_tray_icon_event(|tray, event| {
    if let tauri::tray::TrayIconEvent::Click { .. } = event {
        let app = tray.app_handle();
        if let Some(window) = app.get_webview_window("main") {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            } else {
                show_and_focus(app);
                let state = app.state::<std::sync::Arc<crate::state::AppState>>();
                let sessions = state.sessions.lock().unwrap();
                let session_list: Vec<_> = sessions.values().cloned().collect();
                drop(sessions);
                stop_tray_animation(app, &session_list);
            }
        }
    }
})
```

- [ ] **Step 8: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/tray.rs static/icons/tray-red-*.png static/icons/tray-amber-*.png
git commit -m "feat(alerts): add tray icon animation with frame cycling"
```

---

### Task 7: Session Card Pulse Animation (Frontend)

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add alert tier CSS classes to the card element**

In `src/lib/components/SessionCard.svelte`, update the card `<div>` (line 89) to add alert tier classes:

```svelte
<div
  class="card"
  class:expanded
  class:completion-flash={showCompletion}
  class:alert-high={session.alert_tier === 'high'}
  class:alert-medium={session.alert_tier === 'medium'}
  class:alert-low={session.alert_tier === 'low'}
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
>
```

- [ ] **Step 2: Add CSS keyframe animations**

Add to the `<style>` block in `SessionCard.svelte`:

```css
.card.alert-high {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #e74c3c;
}

.card.alert-medium {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #f39c12;
}

.card.alert-low {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #3498db;
}

@keyframes pulse-alert {
    0% {
        border-left-color: var(--alert-color);
        box-shadow: 0 0 16px color-mix(in srgb, var(--alert-color) 30%, transparent);
    }
    50% {
        border-left-color: var(--alert-color);
        box-shadow: 0 0 8px color-mix(in srgb, var(--alert-color) 15%, transparent);
    }
    100% {
        border-left-color: var(--accent-color);
        box-shadow: none;
    }
}
```

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat(alerts): add session card pulse animation per alert tier"
```

---

### Task 8: Sound Playback Module (Frontend)

**Files:**
- Create: `src/lib/stores/alertSound.svelte.ts`
- Create: `src/lib/stores/alertSound.test.ts`

- [ ] **Step 1: Create placeholder sound files**

The sound files need to exist for imports. Create minimal WAV files (actual sounds are a polish step):

```bash
mkdir -p /home/andy/dev/andybarilla/jackdaw/src/lib/assets/sounds
# Create minimal valid WAV files (44 bytes each — header only, produces silence)
for tier in high medium low; do
  printf 'RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00' > /home/andy/dev/andybarilla/jackdaw/src/lib/assets/sounds/alert-$tier.wav
done
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/stores/alertSound.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playAlertSound } from './alertSound.svelte';

// Mock HTMLAudioElement
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockAudio = { play: mockPlay, volume: 1 };

vi.stubGlobal('Audio', vi.fn(() => mockAudio));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playAlertSound', () => {
  it('plays high alert sound', () => {
    playAlertSound('high', 80);
    expect(Audio).toHaveBeenCalled();
    expect(mockAudio.volume).toBe(0.8);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('plays medium alert sound', () => {
    playAlertSound('medium', 50);
    expect(mockAudio.volume).toBe(0.5);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('plays low alert sound', () => {
    playAlertSound('low', 100);
    expect(mockAudio.volume).toBe(1);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('does not play for off tier', () => {
    playAlertSound('off', 80);
    expect(Audio).not.toHaveBeenCalled();
  });

  it('does not play at zero volume', () => {
    playAlertSound('high', 0);
    expect(Audio).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run src/lib/stores/alertSound.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement playAlertSound**

Create `src/lib/stores/alertSound.svelte.ts`:

```typescript
import type { AlertTier } from '$lib/types';

import alertHighUrl from '$lib/assets/sounds/alert-high.wav';
import alertMediumUrl from '$lib/assets/sounds/alert-medium.wav';
import alertLowUrl from '$lib/assets/sounds/alert-low.wav';

const SOUND_URLS: Record<string, string> = {
  high: alertHighUrl,
  medium: alertMediumUrl,
  low: alertLowUrl,
};

export function playAlertSound(tier: AlertTier, volume: number): void {
  if (tier === 'off' || volume <= 0) return;

  const url = SOUND_URLS[tier];
  if (!url) return;

  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, volume / 100));
  audio.play().catch(() => {
    // Browser may block autoplay before user interaction — silently ignore
  });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run src/lib/stores/alertSound.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/alertSound.svelte.ts src/lib/stores/alertSound.test.ts src/lib/assets/sounds/
git commit -m "feat(alerts): add sound playback module with per-tier audio"
```

---

### Task 9: Wire Sound Playback into Session Store

**Files:**
- Modify: `src/lib/stores/sessions.svelte.ts`

- [ ] **Step 1: Add sound playback on alert tier change**

In `src/lib/stores/sessions.svelte.ts`, update the session-update listener to detect `alert_tier` and play sounds:

```typescript
import { listen } from '@tauri-apps/api/event';
import type { Session } from '$lib/types';
import { playAlertSound } from './alertSound.svelte';
import { Store } from '@tauri-apps/plugin-store';

class SessionStore {
  sessions = $state<Session[]>([]);
  #alertVolume = 80;

  constructor() {
    Store.load('settings.json').then(async (store) => {
      const vol = await store.get<number>('alert_volume');
      if (vol !== undefined && vol !== null) {
        this.#alertVolume = vol;
      }
    });
  }

  get count(): number {
    return this.sessions.length;
  }

  get hasUnread(): boolean {
    return this.sessions.some(s => s.has_unread);
  }

  get globalState(): 'approval' | 'input' | 'running' | 'idle' {
    if (this.sessions.length === 0) return 'idle';
    for (const s of this.sessions) {
      if (s.pending_approval) return 'approval';
    }
    for (const s of this.sessions) {
      if (s.current_tool === null && s.active_subagents === 0 && !s.processing) return 'input';
    }
    return 'running';
  }

  setVolume(volume: number): void {
    this.#alertVolume = volume;
  }

  handleAlerts(sessions: Session[]): void {
    for (const session of sessions) {
      if (session.alert_tier && session.alert_tier !== 'off') {
        playAlertSound(session.alert_tier, this.#alertVolume);
        break; // Play only the highest-priority alert sound per update
      }
    }
  }
}

export const sessionStore = new SessionStore();

export function initSessionListener(): () => void {
  let unlisten: (() => void) | undefined;

  listen<Session[]>('session-update', (event) => {
    sessionStore.handleAlerts(event.payload);
    sessionStore.sessions = event.payload;
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/sessions.svelte.ts
git commit -m "feat(alerts): wire sound playback into session update listener"
```

---

### Task 10: Settings UI — Replace Checkboxes with Dropdowns

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Update the Settings component**

Replace the `NotificationPrefs` interface, state, and toggle function with the new alert prefs model. In `src/lib/components/Settings.svelte`:

Replace the `NotificationPrefs` interface and related state (lines 8-18) with:

```typescript
import type { AlertTier } from '$lib/types';
import { sessionStore } from '$lib/stores/sessions.svelte';

interface AlertPrefs {
  on_approval_needed: AlertTier;
  on_session_end: AlertTier;
  on_stop: AlertTier;
}

let alertPrefs = $state<AlertPrefs>({
  on_approval_needed: 'high',
  on_session_end: 'low',
  on_stop: 'medium',
});

let alertVolume = $state(80);
```

Update `onMount` to load alert prefs instead of the old notification prefs:

Replace the `const saved = await store.get<NotificationPrefs>('notifications')` block with:

```typescript
const saved = await store.get<AlertPrefs>('notifications');
if (saved) {
  // Handle migration from old boolean format
  const raw = saved as Record<string, unknown>;
  if (typeof raw.on_approval_needed === 'boolean') {
    alertPrefs = {
      on_approval_needed: raw.on_approval_needed ? 'high' : 'off',
      on_stop: (raw as Record<string, unknown>).on_stop ? 'medium' : 'off',
      on_session_end: (raw as Record<string, unknown>).on_session_end ? 'low' : 'off',
    };
    await store.set('notifications', alertPrefs);
    await store.save();
  } else {
    alertPrefs = saved;
  }
}
const savedVolume = await store.get<number>('alert_volume');
if (savedVolume !== undefined && savedVolume !== null) {
  alertVolume = savedVolume;
}
```

Remove the old `toggle` function. Add new save functions:

```typescript
async function saveAlertPrefs() {
  if (store) {
    await store.set('notifications', alertPrefs);
    await store.save();
  }
}

async function saveVolume() {
  if (store) {
    await store.set('alert_volume', alertVolume);
    await store.save();
    sessionStore.setVolume(alertVolume);
  }
}
```

- [ ] **Step 2: Update the template**

Replace the Notifications section (the `<h3>` and three `<label class="toggle-row">` blocks and the command-row) with:

```svelte
<h3 class="settings-title">Alerts</h3>
<div class="alert-row">
  <span class="alert-label">Approval Needed</span>
  <select class="alert-select" bind:value={alertPrefs.on_approval_needed} onchange={saveAlertPrefs}>
    <option value="high">High</option>
    <option value="medium">Medium</option>
    <option value="low">Low</option>
    <option value="off">Off</option>
  </select>
</div>
<div class="alert-row">
  <span class="alert-label">Waiting for Input</span>
  <select class="alert-select" bind:value={alertPrefs.on_stop} onchange={saveAlertPrefs}>
    <option value="high">High</option>
    <option value="medium">Medium</option>
    <option value="low">Low</option>
    <option value="off">Off</option>
  </select>
</div>
<div class="alert-row">
  <span class="alert-label">Session Ended</span>
  <select class="alert-select" bind:value={alertPrefs.on_session_end} onchange={saveAlertPrefs}>
    <option value="high">High</option>
    <option value="medium">Medium</option>
    <option value="low">Low</option>
    <option value="off">Off</option>
  </select>
</div>
<div class="alert-row">
  <span class="alert-label">Sound theme</span>
  <select class="alert-select">
    <option value="default">Default</option>
  </select>
</div>
<div class="alert-row">
  <span class="alert-label">Volume</span>
  <div class="volume-row">
    <input
      type="range"
      min="0"
      max="100"
      bind:value={alertVolume}
      onchange={saveVolume}
      class="volume-slider"
    />
    <span class="volume-value">{alertVolume}%</span>
  </div>
</div>
<div class="command-row">
  <label class="command-label" for="notification-command">Run command on alert</label>
  <input
    id="notification-command"
    type="text"
    class="command-input"
    placeholder="e.g. ~/.config/jackdaw/on-notify.sh"
    bind:value={notificationCommand}
    onblur={saveCommand}
  />
</div>
```

- [ ] **Step 3: Add CSS for the new alert settings**

Add to the `<style>` block in `Settings.svelte`:

```css
.alert-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.alert-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.alert-select {
  background: var(--card-bg);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.alert-select:focus {
  outline: none;
  border-color: var(--active);
}

.volume-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.volume-slider {
  width: 120px;
  accent-color: var(--active);
}

.volume-value {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}
```

- [ ] **Step 4: Remove old toggle-row CSS if no longer used elsewhere**

The `.toggle-row` styles are still used by the auto-update checkbox and HTTP API toggle, so keep them.

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Run frontend tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat(alerts): replace notification checkboxes with urgency tier dropdowns"
```

---

### Task 11: Clean Up Old Code

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Remove old should_notify function**

The old `should_notify` function is now replaced by `resolve_alert_tier`. Remove:
- The `should_notify` function
- Tests: `not_notified_when_focused`, `notified_when_not_focused_and_enabled`, `not_notified_when_pref_disabled`, `not_notified_for_irrelevant_events`, `selective_prefs`

Keep `NotificationPrefs` — it's still needed by `migrate_alert_prefs` for deserializing old format.

- [ ] **Step 2: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (no remaining references to `should_notify`)

- [ ] **Step 3: Run full check**

Run: `npm run check && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "refactor(alerts): remove old should_notify in favor of resolve_alert_tier"
```

---

### Task 12: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Verify dev mode launches**

Run: `npm run tauri dev`
Expected: App launches, settings show new dropdown UI, no console errors

- [ ] **Step 5: Commit any final fixes if needed**
