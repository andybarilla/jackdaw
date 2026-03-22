# Desktop Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OS-native desktop notifications when Claude Code sessions need attention, with user-configurable preferences stored via tauri-plugin-store.

**Architecture:** Notifications fire from the Rust backend in `server.rs` after processing hook events. A `should_notify()` pure function decides whether to notify based on event type, window focus, and user preferences. Preferences are stored via `tauri-plugin-store` and editable from a Settings tab in the frontend.

**Tech Stack:** tauri-plugin-notification, tauri-plugin-store, @tauri-apps/plugin-notification (JS), @tauri-apps/plugin-store (JS)

**Spec:** `docs/superpowers/specs/2026-03-22-notifications-design.md`

---

### Task 1: Add dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`

- [ ] **Step 1: Add notification and store plugins to Cargo.toml**

Add to `[dependencies]`:

```toml
tauri-plugin-notification = "2"
tauri-plugin-store = "2"
```

- [ ] **Step 2: Install frontend packages**

```bash
npm install @tauri-apps/plugin-notification @tauri-apps/plugin-store
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
git commit -m "chore: add notification and store plugin dependencies"
```

---

### Task 2: Register plugins and add permissions

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Register both plugins in lib.rs**

In `lib.rs`, add to the `tauri::Builder` chain (before `.on_window_event()`):

```rust
.plugin(tauri_plugin_notification::init())
.plugin(tauri_plugin_store::Builder::default().build())
```

- [ ] **Step 2: Add permissions to capabilities**

Add to the `permissions` array in `src-tauri/capabilities/default.json`:

```json
"notification:default",
"core:window:allow-is-focused",
"core:window:allow-show",
"core:window:allow-set-focus",
"store:allow-get",
"store:allow-set",
"store:allow-save",
"store:allow-load"
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: register notification and store plugins with permissions"
```

---

### Task 3: Implement notification decision logic (TDD)

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod notify;`)

- [ ] **Step 1: Create notify.rs with NotificationPrefs struct, should_notify, notification_content, and tests**

```rust
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

pub fn should_notify(event_name: &str, is_focused: bool, prefs: &NotificationPrefs) -> bool {
    if is_focused {
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
```

- [ ] **Step 2: Add mod declaration to lib.rs**

Add `mod notify;` to the top of `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all notify tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs
git commit -m "feat: add notification decision logic with tests"
```

---

### Task 4: Wire notifications into server.rs

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Add notification firing after state update**

After `crate::tray::update_tray(app_handle, &session_list);` (line 188) and before the DB persistence section, add:

```rust
// Fire desktop notification if appropriate
{
    use tauri_plugin_notification::NotificationExt;
    use tauri_plugin_store::StoreExt;

    let is_focused = app_handle
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);

    let prefs = app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store.get("notifications").and_then(|v| {
                serde_json::from_value::<crate::notify::NotificationPrefs>(v).ok()
            })
        })
        .unwrap_or_default();

    if crate::notify::should_notify(&event_name, is_focused, &prefs) {
        if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
            let _ = app_handle.notification().builder()
                .title(title)
                .body(body)
                .show();
        }
    }
}
```

Note: `cwd` comes from `payload.cwd` (captured at line 73), not from session state. This is important for `SessionEnd` where the session has already been removed.

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: fire desktop notifications from event handler"
```

---

### Task 5: Request notification permission on startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add permission request in setup**

In the `.setup()` closure in `lib.rs`, after `tray::create_tray(app.handle())?;`, add:

```rust
// Request notification permission if not already granted (required on macOS)
{
    use tauri_plugin_notification::NotificationExt;
    let notification = app.notification();
    if !notification.is_permission_granted().unwrap_or(false) {
        let _ = notification.request_permission();
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: request notification permission on startup"
```

---

### Task 6: Frontend Settings component

**Files:**
- Create: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Create Settings.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Store } from '@tauri-apps/plugin-store';

  interface NotificationPrefs {
    on_approval_needed: boolean;
    on_session_end: boolean;
    on_stop: boolean;
  }

  let prefs = $state<NotificationPrefs>({
    on_approval_needed: true,
    on_session_end: true,
    on_stop: true,
  });

  let store: Awaited<ReturnType<typeof Store.load>> | null = $state(null);

  onMount(async () => {
    store = await Store.load('settings.json');
    const saved = await store.get<NotificationPrefs>('notifications');
    if (saved) {
      prefs = saved;
    }
  });

  async function toggle(key: keyof NotificationPrefs) {
    prefs[key] = !prefs[key];
    if (store) {
      await store.set('notifications', prefs);
      await store.save();
    }
  }
</script>

<div class="settings">
  <h3 class="settings-title">Notifications</h3>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_approval_needed} onchange={() => toggle('on_approval_needed')} />
    <span>Notify when approval needed</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_stop} onchange={() => toggle('on_stop')} />
    <span>Notify when waiting for input</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_session_end} onchange={() => toggle('on_session_end')} />
    <span>Notify when session ends</span>
  </label>
</div>

<style>
  .settings {
    padding: 16px;
  }

  .settings-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px 0;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .toggle-row input[type="checkbox"] {
    accent-color: var(--blue);
  }
</style>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: add Settings component with notification toggles"
```

---

### Task 7: Add Settings tab to Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Import Settings and add third tab**

In `Dashboard.svelte`:

1. Add import: `import Settings from './Settings.svelte';`
2. Change `activeTab` type: `let activeTab = $state<'active' | 'history' | 'settings'>('active');`
3. Update `switchTab` signature: `async function switchTab(tab: 'active' | 'history' | 'settings')`
4. Add settings tab button after the History button:

```svelte
<button class="tab" class:active={activeTab === 'settings'} onclick={() => switchTab('settings')}>
  Settings
</button>
```

5. Add settings view in the session-list div, after the history block's closing `{/if}`:

```svelte
{:else if activeTab === 'settings'}
  <Settings />
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add Settings tab to Dashboard"
```

---

### Task 8: Manual integration test

- [ ] **Step 1: Start dev server**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify Settings tab appears and toggles work**

- Click the Settings tab
- Toggle each notification preference off and on
- Verify toggles persist after switching tabs and back

- [ ] **Step 3: Verify notifications fire**

- Start a Claude Code session (triggers SessionStart, then Stop/Notification events)
- With the Jackdaw window minimized/hidden, verify OS notifications appear
- With the Jackdaw window focused, verify notifications do NOT appear
- Disable a notification type in Settings, verify it stops firing

- [ ] **Step 4: Run full test suites**

```bash
cd src-tauri && cargo test
npm test
npm run check
```

Expected: all pass

- [ ] **Step 5: Commit any fixes from integration testing**
