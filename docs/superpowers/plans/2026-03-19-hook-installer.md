# Hook Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click installation of Claude Code HTTP hooks that send events to Jackdaw's server.

**Architecture:** New Rust `hooks.rs` module handles reading/writing Claude Code `settings.json` files with merge logic. Three Tauri commands expose this to the frontend. A new `HookSetup.svelte` component provides the dashboard UI, and the tray menu gets a submenu for quick install/uninstall.

**Tech Stack:** Rust (serde_json for JSON manipulation, dirs for home directory), Svelte 5, Tauri v2 commands

**Spec:** `docs/superpowers/specs/2026-03-19-hook-installer-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/hooks.rs` | Hook install/uninstall/status logic, settings file I/O |
| Modify | `src-tauri/src/lib.rs` | Register hooks module and new Tauri commands |
| Modify | `src-tauri/src/server.rs:46` | Fix `"SessionStop"` → `"Stop"` event name |
| Modify | `src-tauri/src/tray.rs` | Add "Install Claude Hooks" submenu |
| Modify | `src-tauri/Cargo.toml` | Add `dirs` dependency |
| Create | `src/lib/components/HookSetup.svelte` | Dashboard onboarding card for hook installation |
| Modify | `src/lib/components/Dashboard.svelte` | Integrate HookSetup in empty state |
| Modify | `src/lib/types.ts` | Add HookStatus and HookScope types |

---

### Task 1: Fix the Stop event name bug

**Files:**
- Modify: `src-tauri/src/server.rs:46`

- [ ] **Step 1: Fix the match arm**

In `src-tauri/src/server.rs`, change line 46:

```rust
// Before:
"SessionStop" => {
// After:
"Stop" => {
```

- [ ] **Step 2: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "fix: rename SessionStop to Stop to match Claude Code hook event name"
```

---

### Task 2: Add `dirs` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dirs crate**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
dirs = "6"
```

- [ ] **Step 2: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles, `dirs` downloaded

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add dirs crate for home directory resolution"
```

---

### Task 3: Create `hooks.rs` — settings path resolution and file I/O

**Files:**
- Create: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `mod hooks;`)

- [ ] **Step 1: Create hooks.rs with path resolution and read/write helpers**

Create `src-tauri/src/hooks.rs`:

```rust
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
```

- [ ] **Step 2: Add `mod hooks;` to lib.rs**

In `src-tauri/src/lib.rs`, add after line 3 (`mod tray;`):

```rust
mod hooks;
```

- [ ] **Step 3: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles with warnings about unused functions (expected at this stage)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hooks.rs src-tauri/src/lib.rs
git commit -m "feat: add hooks module with settings path resolution and file I/O"
```

---

### Task 4: Add hook status checking to `hooks.rs`

**Files:**
- Modify: `src-tauri/src/hooks.rs`

- [ ] **Step 1: Add check_hooks_status function**

Append to `src-tauri/src/hooks.rs`:

```rust
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
        // Partial install or different port
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
```

- [ ] **Step 2: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hooks.rs
git commit -m "feat: add hook status checking logic"
```

---

### Task 5: Add install and uninstall logic to `hooks.rs`

**Files:**
- Modify: `src-tauri/src/hooks.rs`

- [ ] **Step 1: Add install_hooks function**

Append to `src-tauri/src/hooks.rs`:

```rust
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

        let arr = event_array.as_array_mut().unwrap();

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
```

- [ ] **Step 2: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hooks.rs
git commit -m "feat: add hook install and uninstall logic with safe merge strategy"
```

---

### Task 6: Add Tauri commands for hooks

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Tauri command functions to lib.rs**

Add these command functions in `src-tauri/src/lib.rs`, after the `dismiss_session` function (after line 19):

```rust
#[tauri::command]
fn check_hooks_status(
    scope: hooks::HookScope,
    cwd: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<hooks::HookStatus, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let settings = hooks::read_settings(&path)?;
    Ok(hooks::check_status(&settings, state.port))
}

#[tauri::command]
fn install_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::install(&mut settings, state.port)?;
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks installed to {}", path.display()))
}

#[tauri::command]
fn uninstall_hooks(
    scope: hooks::HookScope,
    cwd: Option<String>,
) -> Result<String, String> {
    let path = hooks::get_settings_path(&scope, cwd.as_deref())?;
    let mut settings = hooks::read_settings(&path)?;
    hooks::uninstall(&mut settings);
    hooks::write_settings(&path, &settings)?;
    Ok(format!("Hooks removed from {}", path.display()))
}
```

- [ ] **Step 2: Register commands in invoke_handler**

In `src-tauri/src/lib.rs`, update the invoke_handler line (line 43):

```rust
// Before:
.invoke_handler(tauri::generate_handler![dismiss_session])
// After:
.invoke_handler(tauri::generate_handler![dismiss_session, check_hooks_status, install_hooks, uninstall_hooks])
```

- [ ] **Step 3: Build to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for hook install, uninstall, and status check"
```

---

### Task 7: Add TypeScript types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add HookStatus and HookScope types**

Append to `src/lib/types.ts`:

```typescript
export type HookStatus = 'not_installed' | 'installed' | 'outdated';
export type HookScope = 'user' | 'project';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add HookStatus and HookScope TypeScript types"
```

---

### Task 8: Create HookSetup.svelte component

**Files:**
- Create: `src/lib/components/HookSetup.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/HookSetup.svelte`:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { HookStatus, HookScope } from '$lib/types';

  let scope: HookScope = $state('user');
  let projectPath: string = $state('');
  let status: HookStatus | null = $state(null);
  let message: string = $state('');
  let loading: boolean = $state(false);
  let error: string = $state('');

  async function checkStatus() {
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      status = await invoke<HookStatus>('check_hooks_status', { scope, cwd });
      error = '';
    } catch (e) {
      error = String(e);
      status = null;
    }
  }

  async function handleInstall() {
    loading = true;
    error = '';
    message = '';
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      const result = await invoke<string>('install_hooks', { scope, cwd });
      message = result;
      await checkStatus();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function handleUninstall() {
    loading = true;
    error = '';
    message = '';
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      const result = await invoke<string>('uninstall_hooks', { scope, cwd });
      message = result;
      await checkStatus();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  // Check status on mount and when scope changes
  $effect(() => {
    scope;
    checkStatus();
  });

  // Debounce project path changes to avoid firing on every keystroke
  let pathTimeout: ReturnType<typeof setTimeout>;
  $effect(() => {
    projectPath;
    clearTimeout(pathTimeout);
    pathTimeout = setTimeout(() => checkStatus(), 500);
  });
</script>

<div class="hook-setup">
  <p class="title">Install Claude Code Hooks</p>
  <p class="subtitle">Automatically send session events to Jackdaw</p>

  <div class="scope-toggle">
    <label class:active={scope === 'user'}>
      <input type="radio" bind:group={scope} value="user" />
      User-level
    </label>
    <label class:active={scope === 'project'}>
      <input type="radio" bind:group={scope} value="project" />
      Project-level
    </label>
  </div>

  {#if scope === 'project'}
    <input
      type="text"
      class="path-input"
      bind:value={projectPath}
      placeholder="/path/to/project"
    />
  {/if}

  {#if status === 'installed'}
    <p class="status installed">Hooks installed</p>
  {:else if status === 'outdated'}
    <p class="status outdated">Hooks need updating</p>
  {:else if status === 'not_installed'}
    <p class="status not-installed">Hooks not installed</p>
  {/if}

  <div class="actions">
    {#if status === 'installed'}
      <button class="btn btn-secondary" onclick={handleUninstall} disabled={loading}>
        Uninstall
      </button>
    {:else}
      <button class="btn btn-primary" onclick={handleInstall} disabled={loading || (scope === 'project' && !projectPath)}>
        {loading ? 'Installing...' : status === 'outdated' ? 'Update Hooks' : 'Install Hooks'}
      </button>
    {/if}
  </div>

  {#if message}
    <p class="message success">{message}</p>
  {/if}
  {#if error}
    <p class="message error">{error}</p>
  {/if}
</div>

<style>
  .hook-setup {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
  }

  .scope-toggle {
    display: flex;
    gap: 4px;
    background: var(--bg);
    border-radius: 6px;
    padding: 2px;
  }

  .scope-toggle label {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .scope-toggle label.active {
    background: var(--card-bg);
    color: var(--text-primary);
  }

  .scope-toggle input[type="radio"] {
    display: none;
  }

  .path-input {
    width: 100%;
    max-width: 300px;
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-primary);
    font-size: 12px;
    font-family: monospace;
  }

  .path-input::placeholder {
    color: var(--text-muted);
  }

  .status {
    font-size: 12px;
    font-weight: 500;
  }

  .status.installed { color: var(--green); }
  .status.outdated { color: var(--yellow); }
  .status.not-installed { color: var(--text-muted); }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--blue);
    color: #fff;
    border-color: var(--blue);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .message {
    font-size: 11px;
    max-width: 300px;
    word-break: break-word;
  }

  .message.success { color: var(--green); }
  .message.error { color: #f85149; }
</style>
```

- [ ] **Step 2: Build frontend to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/HookSetup.svelte
git commit -m "feat: add HookSetup component for one-click hook installation"
```

---

### Task 9: Integrate HookSetup into Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Update Dashboard empty state**

In `src/lib/components/Dashboard.svelte`, add the import after line 3:

```svelte
import HookSetup from './HookSetup.svelte';
```

Replace the empty state block (lines 22-26):

```svelte
<!-- Before: -->
<div class="empty">
  <p class="empty-title">No active sessions</p>
  <p class="empty-subtitle">Sessions will appear here when Claude Code sends hook events</p>
</div>

<!-- After: -->
<div class="empty">
  <HookSetup />
</div>
```

- [ ] **Step 2: Build full app to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && npm run build`
Expected: Builds successfully

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: show hook setup card in dashboard empty state"
```

---

### Task 10: Add tray submenu for hook install/uninstall

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Update tray menu creation**

In `src-tauri/src/tray.rs`, replace the `create_tray` function (lines 17-59) with:

```rust
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{PredefinedMenuItem, SubmenuBuilder};

    let show = MenuItemBuilder::with_id("show", "Show Dashboard").build(app)?;
    let install_user = MenuItemBuilder::with_id("install_hooks_user", "User-level (global)").build(app)?;
    let uninstall = MenuItemBuilder::with_id("uninstall_hooks", "Uninstall").build(app)?;
    let hooks_submenu = SubmenuBuilder::with_id(app, "hooks_submenu", "Install Claude Hooks")
        .items(&[&install_user, &uninstall])
        .build()?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &hooks_submenu, &separator, &settings, &quit])
        .build()?;

    let icon = Image::from_bytes(ICON_GRAY).expect("embedded gray icon");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Jackdaw — idle")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "install_hooks_user" => {
                let state = app.state::<std::sync::Arc<crate::state::AppState>>();
                let port = state.port;
                match crate::hooks::get_settings_path(&crate::hooks::HookScope::User, None) {
                    Ok(path) => {
                        match crate::hooks::read_settings(&path) {
                            Ok(mut settings) => {
                                if let Err(e) = crate::hooks::install(&mut settings, port) {
                                    eprintln!("Jackdaw: failed to install hooks: {}", e);
                                    return;
                                }
                                match crate::hooks::write_settings(&path, &settings) {
                                    Ok(_) => {
                                        if let Some(tray) = app.tray_by_id(TRAY_ID) {
                                            let _ = tray.set_tooltip(Some("Jackdaw — hooks installed"));
                                        }
                                    }
                                    Err(e) => eprintln!("Jackdaw: failed to install hooks: {}", e),
                                }
                            }
                            Err(e) => eprintln!("Jackdaw: failed to read settings: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Jackdaw: failed to resolve settings path: {}", e),
                }
            }
            "uninstall_hooks" => {
                match crate::hooks::get_settings_path(&crate::hooks::HookScope::User, None) {
                    Ok(path) => {
                        match crate::hooks::read_settings(&path) {
                            Ok(mut settings) => {
                                crate::hooks::uninstall(&mut settings);
                                match crate::hooks::write_settings(&path, &settings) {
                                    Ok(_) => {
                                        if let Some(tray) = app.tray_by_id(TRAY_ID) {
                                            let _ = tray.set_tooltip(Some("Jackdaw — hooks removed"));
                                        }
                                    }
                                    Err(e) => eprintln!("Jackdaw: failed to uninstall hooks: {}", e),
                                }
                            }
                            Err(e) => eprintln!("Jackdaw: failed to read settings: {}", e),
                        }
                    }
                    Err(e) => eprintln!("Jackdaw: failed to resolve settings path: {}", e),
                }
            }
            "settings" => {
                // TODO: open settings window (v2)
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

- [ ] **Step 2: Build full app to verify**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/tray.rs
git commit -m "feat: add Install Claude Hooks submenu to system tray"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Full build**

Run: `cd /home/andy/dev/andybarilla/jackdaw && cargo tauri build --debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 2: Manual smoke test**

Launch the app and verify:
1. Dashboard shows HookSetup card when no sessions are active
2. Click "Install Hooks" with user-level scope
3. Check `~/.claude/settings.json` contains the 4 hook events
4. Status shows "Hooks installed"
5. Click "Uninstall" — hooks removed from settings file
6. Right-click tray → "Install Claude Hooks" → "User-level (global)" works
7. Right-click tray → "Install Claude Hooks" → "Uninstall" works

- [ ] **Step 3: Verify existing settings preserved**

If `~/.claude/settings.json` has other settings/hooks, verify they are untouched after install/uninstall.
