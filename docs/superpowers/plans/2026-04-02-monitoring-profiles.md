# Monitoring Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-project alert configuration via user-assigned profiles, with fallback to global defaults for unmatched sessions.

**Architecture:** New `MonitoringProfile` struct in `notify.rs` alongside existing `AlertPrefs`. Profiles stored in Tauri Store (`settings.json`) under key `"profiles"`. Two new Tauri commands (`get_profiles`, `save_profiles`) for frontend CRUD. Alert resolution in `server.rs` checks for a profile match before falling back to global prefs. Session struct gets a `profile_name` field. Frontend adds a "Monitoring Profiles" section to `Settings.svelte`.

**Tech Stack:** Rust (Tauri v2, serde, uuid), Svelte 5, Vitest, tauri-plugin-store

---

### Task 1: MonitoringProfile Struct and Profile Matching Logic

**Files:**
- Modify: `src-tauri/src/notify.rs`

- [ ] **Step 1: Write failing tests for MonitoringProfile and find_profile_for_cwd**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/notify.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib notify`
Expected: FAIL — `MonitoringProfile` and `find_profile_for_cwd` not defined

- [ ] **Step 3: Implement MonitoringProfile struct and find_profile_for_cwd**

Add to `src-tauri/src/notify.rs`, after the `AlertPrefs` impl block and before `resolve_alert_tier`:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib notify`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notify.rs
git commit -m "feat: add MonitoringProfile struct and find_profile_for_cwd"
```

---

### Task 2: Profile-Aware Alert Resolution in server.rs

**Files:**
- Modify: `src-tauri/src/server.rs` (lines 379-476, the alert resolution block in `handle_event`)

- [ ] **Step 1: Write failing test for profile-aware alert resolution**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/server.rs`:

```rust
#[test]
fn resolve_alert_with_profile_override() {
    use crate::notify::{AlertPrefs, AlertTier, MonitoringProfile, find_profile_for_cwd, resolve_alert_tier};

    let profiles = vec![MonitoringProfile {
        id: "p1".to_string(),
        name: "Silent".to_string(),
        directories: vec!["/home/user/quiet-project".to_string()],
        alerts: AlertPrefs {
            on_approval_needed: AlertTier::Off,
            on_session_end: AlertTier::Off,
            on_stop: AlertTier::Off,
        },
        alert_volume: 0,
        notification_command: String::new(),
    }];

    let global_prefs = AlertPrefs::default();

    // Session in quiet-project should use profile (all off)
    let profile = find_profile_for_cwd(&profiles, "/home/user/quiet-project");
    let prefs = profile.map(|p| &p.alerts).unwrap_or(&global_prefs);
    let tier = resolve_alert_tier("Stop", false, prefs);
    assert_eq!(tier, AlertTier::Off);

    // Session in other project should use global defaults
    let profile = find_profile_for_cwd(&profiles, "/home/user/other");
    let prefs = profile.map(|p| &p.alerts).unwrap_or(&global_prefs);
    let tier = resolve_alert_tier("Stop", false, prefs);
    assert_eq!(tier, AlertTier::Medium);
}
```

- [ ] **Step 2: Run test to verify it passes (logic already works with existing functions)**

Run: `cd src-tauri && cargo test --lib server::tests::resolve_alert_with_profile_override`
Expected: PASS — this test validates the composition pattern works. The actual integration happens next.

- [ ] **Step 3: Update handle_event alert resolution to check profiles**

In `src-tauri/src/server.rs`, replace the alert resolution block (lines ~380-399) that currently reads:

```rust
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
```

With:

```rust
    let (resolved_tier, profile_notification_command) = {
        use tauri_plugin_store::StoreExt;

        let is_visible = app_handle
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);

        let store = app_handle.store("settings.json").ok();

        let profiles: Vec<crate::notify::MonitoringProfile> = store
            .as_ref()
            .and_then(|s| s.get("profiles"))
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        let profile = crate::notify::find_profile_for_cwd(&profiles, &cwd);

        let prefs = match &profile {
            Some(p) => p.alerts.clone(),
            None => store
                .as_ref()
                .and_then(|s| s.get("notifications").map(|v| crate::notify::migrate_alert_prefs(v)))
                .unwrap_or_default(),
        };

        let profile_cmd = profile.map(|p| p.notification_command.clone());

        (crate::notify::resolve_alert_tier(&event_name, is_visible, &prefs), profile_cmd)
    };
```

- [ ] **Step 4: Update notification command block to use profile command when available**

In the same function, find the notification command block (lines ~454-476) and replace:

```rust
        // Notification command
        {
            use tauri_plugin_store::StoreExt;
            let notification_command = app_handle
                .store("settings.json")
                .ok()
                .and_then(|store| store.get("notification_command"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
```

With:

```rust
        // Notification command (profile override or global)
        {
            use tauri_plugin_store::StoreExt;
            let notification_command = profile_notification_command
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| {
                    app_handle
                        .store("settings.json")
                        .ok()
                        .and_then(|store| store.get("notification_command"))
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_default()
                });
```

- [ ] **Step 5: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: profile-aware alert resolution in handle_event"
```

---

### Task 3: profile_name Field on Session

**Files:**
- Modify: `src-tauri/src/state.rs` (Session struct, lines 49-68)
- Modify: `src-tauri/src/server.rs` (handle_event, SessionStart/session-creation block)
- Modify: `src/lib/types.ts` (Session interface)

- [ ] **Step 1: Write failing test for profile_name on Session**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/server.rs`:

```rust
#[test]
fn session_has_profile_name_field() {
    use crate::state::Session;
    let session = Session::new("s1".into(), "/tmp".into());
    assert_eq!(session.profile_name, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib server::tests::session_has_profile_name_field`
Expected: FAIL — `profile_name` not a field on Session

- [ ] **Step 3: Add profile_name to Session struct**

In `src-tauri/src/state.rs`, add to the Session struct (after `source_tool`):

```rust
    pub profile_name: Option<String>,
```

Then find `Session::new()` in the same file and add `profile_name: None` to the constructor.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib server::tests::session_has_profile_name_field`
Expected: PASS

- [ ] **Step 5: Set profile_name when session is created in handle_event**

In `src-tauri/src/server.rs`, inside the `handle_event` function, find the block where a new session is created (around line 198, inside the `if !sessions.contains_key(&session_id)` block). After `sessions.insert(session_id.clone(), session);` and after the pending subagent matching block, add profile resolution:

```rust
                // Resolve monitoring profile for this session
                {
                    use tauri_plugin_store::StoreExt;
                    let profiles: Vec<crate::notify::MonitoringProfile> = app_handle
                        .store("settings.json")
                        .ok()
                        .and_then(|s| s.get("profiles"))
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default();
                    if let Some(profile) = crate::notify::find_profile_for_cwd(&profiles, &cwd) {
                        if let Some(session) = sessions.get_mut(&session_id) {
                            session.profile_name = Some(profile.name.clone());
                        }
                    }
                }
```

- [ ] **Step 6: Add profile_name to TypeScript Session interface**

In `src/lib/types.ts`, add to the `Session` interface (after `source_tool`):

```typescript
  profile_name: string | null;
```

- [ ] **Step 7: Run all tests**

Run: `cd src-tauri && cargo test && cd .. && npm run check`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/server.rs src/lib/types.ts
git commit -m "feat: add profile_name field to Session"
```

---

### Task 4: Tauri Commands for Profile CRUD

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing test for get_profiles and save_profiles commands**

These are Tauri commands that require the store plugin, so we test them indirectly via the types. Add to `src-tauri/src/notify.rs` tests:

```rust
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib notify::tests::profiles_vec_serializes_to_json_array`
Expected: PASS (struct already defined in Task 1)

- [ ] **Step 3: Add get_profiles and save_profiles Tauri commands**

In `src-tauri/src/lib.rs`, add these two commands (after the existing `get_api_token` command):

```rust
#[tauri::command]
fn get_profiles(app: AppHandle) -> Vec<notify::MonitoringProfile> {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .ok()
        .and_then(|store| store.get("profiles"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_profiles(profiles: Vec<notify::MonitoringProfile>, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let value = serde_json::to_value(&profiles).map_err(|e| e.to_string())?;
    store.set("profiles", value);
    store.save().map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register the commands in the invoke_handler**

In `src-tauri/src/lib.rs`, add `get_profiles` and `save_profiles` to the `tauri::generate_handler!` macro invocation:

```rust
            get_profiles,
            save_profiles,
```

- [ ] **Step 5: Run all backend tests and type check**

Run: `cd src-tauri && cargo test && cd .. && npm run check`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add get_profiles and save_profiles Tauri commands"
```

---

### Task 5: Frontend Profile Types and Store Integration

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add MonitoringProfile interface to types.ts**

In `src/lib/types.ts`, add after the `AlertTier` type:

```typescript
export interface AlertPrefs {
  on_approval_needed: AlertTier;
  on_session_end: AlertTier;
  on_stop: AlertTier;
}

export interface MonitoringProfile {
  id: string;
  name: string;
  directories: string[];
  alerts: AlertPrefs;
  alert_volume: number;
  notification_command: string;
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add MonitoringProfile and AlertPrefs types"
```

---

### Task 6: ProfileEditor Component

**Files:**
- Create: `src/lib/components/ProfileEditor.svelte`
- Create: `src/tests/ProfileEditor.test.ts`

- [ ] **Step 1: Write failing tests for ProfileEditor**

Create `src/tests/ProfileEditor.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileEditor from '$lib/components/ProfileEditor.svelte';
import type { MonitoringProfile } from '$lib/types';

function makeProfile(overrides: Partial<MonitoringProfile> = {}): MonitoringProfile {
  return {
    id: 'test-id',
    name: 'Test Profile',
    directories: ['/home/user/project'],
    alerts: { on_approval_needed: 'high', on_session_end: 'low', on_stop: 'medium' },
    alert_volume: 80,
    notification_command: '',
    ...overrides,
  };
}

describe('ProfileEditor', () => {
  it('renders profile name', () => {
    const { getByDisplayValue } = render(ProfileEditor, {
      props: { profile: makeProfile({ name: 'Work' }), onSave: vi.fn(), onDelete: vi.fn() },
    });
    expect(getByDisplayValue('Work')).toBeTruthy();
  });

  it('renders directories', () => {
    const { getByDisplayValue } = render(ProfileEditor, {
      props: {
        profile: makeProfile({ directories: ['/home/user/work'] }),
        onSave: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByDisplayValue('/home/user/work')).toBeTruthy();
  });

  it('calls onDelete when delete is confirmed', async () => {
    const onDelete = vi.fn();
    const { getByText } = render(ProfileEditor, {
      props: { profile: makeProfile(), onSave: vi.fn(), onDelete },
    });
    // Click delete, then confirm
    await fireEvent.click(getByText('Delete'));
    await fireEvent.click(getByText('Confirm'));
    expect(onDelete).toHaveBeenCalledWith('test-id');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/tests/ProfileEditor.test.ts`
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Implement ProfileEditor component**

Create `src/lib/components/ProfileEditor.svelte`:

```svelte
<script lang="ts">
  import type { MonitoringProfile, AlertTier } from '$lib/types';

  let { profile, onSave, onDelete }: {
    profile: MonitoringProfile;
    onSave: (profile: MonitoringProfile) => void;
    onDelete: (id: string) => void;
  } = $props();

  let name = $state(profile.name);
  let directories = $state<string[]>([...profile.directories]);
  let alerts = $state({ ...profile.alerts });
  let alertVolume = $state(profile.alert_volume);
  let notificationCommand = $state(profile.notification_command);
  let confirmingDelete = $state(false);

  function save() {
    onSave({
      id: profile.id,
      name,
      directories: directories.filter((d) => d.trim() !== ''),
      alerts: { ...alerts },
      alert_volume: alertVolume,
      notification_command: notificationCommand,
    });
  }

  function addDirectory() {
    directories = [...directories, ''];
  }

  function removeDirectory(index: number) {
    directories = directories.filter((_, i) => i !== index);
    save();
  }

  function handleDelete() {
    if (confirmingDelete) {
      onDelete(profile.id);
    } else {
      confirmingDelete = true;
    }
  }
</script>

<div class="profile-editor">
  <div class="field-row">
    <label class="field-label" for="profile-name-{profile.id}">Name</label>
    <input
      id="profile-name-{profile.id}"
      type="text"
      class="field-input"
      bind:value={name}
      onblur={save}
    />
  </div>

  <div class="field-group">
    <span class="field-label">Directories</span>
    {#each directories as dir, i}
      <div class="dir-row">
        <input
          type="text"
          class="field-input dir-input"
          bind:value={directories[i]}
          onblur={save}
          placeholder="/path/to/project"
        />
        <button class="remove-btn" onclick={() => removeDirectory(i)}>✕</button>
      </div>
    {/each}
    <button class="add-btn" onclick={addDirectory}>+ Add directory</button>
  </div>

  <div class="field-group">
    <span class="field-label">Alert Tiers</span>
    <div class="alert-row">
      <span class="alert-label">Approval Needed</span>
      <select class="alert-select" bind:value={alerts.on_approval_needed} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
    <div class="alert-row">
      <span class="alert-label">Waiting for Input</span>
      <select class="alert-select" bind:value={alerts.on_stop} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
    <div class="alert-row">
      <span class="alert-label">Session Ended</span>
      <select class="alert-select" bind:value={alerts.on_session_end} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
  </div>

  <div class="field-row">
    <label class="field-label" for="profile-volume-{profile.id}">Volume</label>
    <div class="volume-row">
      <input
        id="profile-volume-{profile.id}"
        type="range"
        min="0"
        max="100"
        bind:value={alertVolume}
        onchange={save}
        class="volume-slider"
      />
      <span class="volume-value">{alertVolume}%</span>
    </div>
  </div>

  <div class="field-row">
    <label class="field-label" for="profile-cmd-{profile.id}">Notification command</label>
    <input
      id="profile-cmd-{profile.id}"
      type="text"
      class="field-input"
      bind:value={notificationCommand}
      onblur={save}
      placeholder="e.g. ~/.config/jackdaw/on-notify.sh"
    />
  </div>

  <div class="delete-row">
    <button class="delete-btn" onclick={handleDelete}>
      {confirmingDelete ? 'Confirm' : 'Delete'}
    </button>
    {#if confirmingDelete}
      <button class="cancel-btn" onclick={() => (confirmingDelete = false)}>Cancel</button>
    {/if}
  </div>
</div>

<style>
  .profile-editor {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  .field-row {
    padding: 6px 0;
  }

  .field-group {
    padding: 6px 0;
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
    font-family: monospace;
  }

  .field-input:focus {
    outline: none;
    border-color: var(--active);
  }

  .dir-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
  }

  .dir-input {
    flex: 1;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }

  .remove-btn:hover {
    color: var(--state-approval);
  }

  .add-btn {
    background: none;
    border: none;
    color: var(--active);
    cursor: pointer;
    font-size: 12px;
    padding: 4px 0;
  }

  .alert-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }

  .alert-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .alert-select {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
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

  .delete-row {
    display: flex;
    gap: 8px;
    padding: 8px 0 0;
  }

  .delete-btn {
    background: none;
    border: 1px solid var(--state-approval);
    color: var(--state-approval);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .cancel-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/tests/ProfileEditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ProfileEditor.svelte src/tests/ProfileEditor.test.ts
git commit -m "feat: add ProfileEditor component with tests"
```

---

### Task 7: Integrate Profiles Section into Settings.svelte

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Add profile state and load/save logic to Settings.svelte**

In `src/lib/components/Settings.svelte`, add the import at the top of the `<script>` block:

```typescript
  import ProfileEditor from './ProfileEditor.svelte';
  import type { MonitoringProfile } from '$lib/types';
```

Add state variables after the existing `httpApiChanged` declaration:

```typescript
  let profiles = $state<MonitoringProfile[]>([]);
```

In the `onMount` callback, add after the HTTP API load block:

```typescript
    profiles = await invoke<MonitoringProfile[]>('get_profiles');
```

Add functions after the existing `toggleHttpApi` function:

```typescript
  async function addProfile() {
    const newProfile: MonitoringProfile = {
      id: crypto.randomUUID(),
      name: 'New Profile',
      directories: [],
      alerts: { ...alertPrefs },
      alert_volume: alertVolume,
      notification_command: notificationCommand,
    };
    profiles = [...profiles, newProfile];
    await invoke('save_profiles', { profiles });
  }

  async function saveProfile(updated: MonitoringProfile) {
    profiles = profiles.map((p) => (p.id === updated.id ? updated : p));
    await invoke('save_profiles', { profiles });
  }

  async function deleteProfile(id: string) {
    profiles = profiles.filter((p) => p.id !== id);
    await invoke('save_profiles', { profiles });
  }
```

- [ ] **Step 2: Add Monitoring Profiles section to the template**

In the `<div class="settings">` template, add the profiles section before the existing `<h3 class="settings-title">Alerts</h3>`:

```svelte
  <h3 class="settings-title">Monitoring Profiles</h3>
  <p class="settings-hint">Per-project alert overrides. Unmatched sessions use the global settings below.</p>
  {#each profiles as profile (profile.id)}
    <ProfileEditor {profile} onSave={saveProfile} onDelete={deleteProfile} />
  {/each}
  <button class="add-profile-btn" onclick={addProfile}>+ Add Profile</button>
```

- [ ] **Step 3: Add styles for the new elements**

In the `<style>` block of `Settings.svelte`, add:

```css
  .settings-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .add-profile-btn {
    background: none;
    border: 1px dashed var(--border);
    color: var(--active);
    border-radius: 4px;
    padding: 8px;
    width: 100%;
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 16px;
  }

  .add-profile-btn:hover {
    border-color: var(--active);
  }
```

- [ ] **Step 4: Run type check and frontend tests**

Run: `npm run check && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: integrate monitoring profiles section into Settings"
```

---

### Task 8: Profile Badge on SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Write failing test for profile badge**

Add to the existing SessionCard test file (find with `ls src/tests/Session*`), or create `src/tests/SessionCardProfileBadge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SessionCard from '$lib/components/SessionCard.svelte';

function makeSession(overrides = {}) {
  return {
    session_id: 's1',
    cwd: '/tmp',
    started_at: new Date().toISOString(),
    git_branch: null,
    current_tool: null,
    tool_history: [],
    active_subagents: 0,
    pending_approval: false,
    processing: false,
    has_unread: false,
    source: 'external' as const,
    display_name: null,
    metadata: {},
    shell_pty_id: null,
    parent_session_id: null,
    alert_tier: null,
    source_tool: null,
    profile_name: null,
    ...overrides,
  };
}

describe('SessionCard profile badge', () => {
  it('shows profile badge when profile_name is set', () => {
    const { getByText } = render(SessionCard, {
      props: {
        session: makeSession({ profile_name: 'Work' }),
        selected: false,
        onSelect: () => {},
      },
    });
    expect(getByText('Work')).toBeTruthy();
  });

  it('hides profile badge when profile_name is null', () => {
    const { queryByTestId } = render(SessionCard, {
      props: {
        session: makeSession({ profile_name: null }),
        selected: false,
        onSelect: () => {},
      },
    });
    expect(queryByTestId('profile-badge')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/tests/SessionCardProfileBadge.test.ts`
Expected: FAIL — no profile badge rendered

- [ ] **Step 3: Add profile badge to SessionCard**

In `src/lib/components/SessionCard.svelte`, find the metadata row section where `git_branch` and `source_tool` are rendered (around lines 145-156). Add after the `source_tool` block:

```svelte
  {#if session.profile_name}
    <div class="metadata-row" data-testid="profile-badge">
      <span class="profile-badge">{session.profile_name}</span>
    </div>
  {/if}
```

Add to the `<style>` block:

```css
  .profile-badge {
    font-size: 10px;
    color: var(--active);
    background: color-mix(in srgb, var(--active) 15%, transparent);
    padding: 1px 6px;
    border-radius: 3px;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/tests/SessionCardProfileBadge.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite and type check**

Run: `npm run check && npm test && cd src-tauri && cargo test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/SessionCard.svelte src/tests/SessionCardProfileBadge.test.ts
git commit -m "feat: show profile badge on SessionCard"
```

---

### Task 9: Volume Override from Profile in Alert Sound

**Files:**
- Modify: `src/lib/stores/sessions.svelte.ts` (or wherever alert sound is triggered from session-update events)

The frontend currently plays alert sounds based on `alert_tier` from the session-update event, using the global `alert_volume`. With profiles, the volume should come from the profile when a session matches one.

- [ ] **Step 1: Add alert_volume field to Session for profile volume override**

Sound is played in `src/lib/stores/sessions.svelte.ts:45` via `playAlertSound(session.alert_tier, this.#alertVolume)`, using the global volume. We need to pass the profile's volume alongside `alert_tier` so the frontend can use it.

In `src-tauri/src/state.rs`, add to Session struct:

```rust
    pub alert_volume: Option<u32>,
```

Set it to `None` in `Session::new()`.

In `src/lib/types.ts`, add to Session interface:

```typescript
  alert_volume: number | null;
```

- [ ] **Step 3: Set alert_volume from profile in server.rs**

In `src-tauri/src/server.rs`, in the alert resolution block where `resolved_tier` is computed, also extract the profile volume. After the existing `profile_cmd` line, add:

```rust
        let profile_volume = profile.map(|p| p.alert_volume);
```

Then in the block where `alert_tier` is set on the session (around line 409), also set the volume:

```rust
        if let Some(session) = sessions.get_mut(&session_id) {
            session.alert_tier = Some(tier_str.to_string());
            session.alert_volume = profile_volume;
        }
```

And in the clear-after-delay block:

```rust
            if let Some(session) = sessions.get_mut(&sid_clone) {
                session.alert_tier = None;
                session.alert_volume = None;
            }
```

- [ ] **Step 4: Use alert_volume from session in frontend sound playback**

In `src/lib/stores/sessions.svelte.ts`, line 45, change:

```typescript
        playAlertSound(session.alert_tier, this.#alertVolume);
```

To:

```typescript
        playAlertSound(session.alert_tier, session.alert_volume ?? this.#alertVolume);
```

- [ ] **Step 5: Run all tests**

Run: `npm run check && npm test && cd src-tauri && cargo test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/server.rs src/lib/types.ts src/lib/stores/sessions.svelte.ts
git commit -m "feat: profile volume override for alert sounds"
```

---

### Task 10: Update Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Move Monitoring Profiles to Completed**

In `docs/ROADMAP.md`, remove the "Monitoring Profiles" section from "High Priority" (lines 7-9) and add to the top of the "Completed" list:

```markdown
- **Monitoring Profiles** — per-project alert configuration via named profiles with directory associations
```

If the High Priority section is now empty, remove it entirely.

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Monitoring Profiles complete on roadmap"
```
