# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app auto-update using Tauri's updater plugin with GitHub Releases, background checking every 24h, and a disable toggle in Settings.

**Architecture:** Tauri plugin-updater checks GitHub Releases for signed update artifacts. A Rust background task runs the check loop; the frontend controls whether it's enabled. Update state (`Mutex<Option<Update>>`) lives in Tauri managed state so the check and install commands share it.

**Tech Stack:** tauri-plugin-updater (Rust + JS), tauri-plugin-store (settings persistence), Svelte 5 runes, GitHub Actions with tauri-action

**Spec:** `docs/superpowers/specs/2026-03-24-auto-update-design.md`

---

## File Structure

### New files
- `src-tauri/src/updater.rs` — Background update check loop, Tauri commands (`check_for_update`, `install_update`, `set_auto_update`), update state management
- `src/lib/stores/updater.svelte.ts` — Reactive store listening to `update-available` and `update-progress` events
- `src/lib/stores/updater.test.ts` — Tests for UpdaterStore
- `src/lib/components/UpdateBanner.svelte` — Dashboard banner for update notification + progress

### Modified files
- `src-tauri/Cargo.toml` — Add `tauri-plugin-updater` dependency
- `package.json` — Add `@tauri-apps/plugin-updater` dependency
- `src-tauri/tauri.conf.json` — Add `createUpdaterArtifacts`, updater plugin config with pubkey + endpoint
- `src-tauri/src/lib.rs` — Register updater plugin in setup, add new commands to invoke handler, spawn background task
- `src-tauri/src/tray.rs` — Add "Check for Updates" menu item
- `src/lib/components/Settings.svelte` — Add "Updates" section with auto-update toggle, check button, version display
- `src/lib/components/Dashboard.svelte` — Import and render UpdateBanner
- `src/lib/types.ts` — Add `UpdateInfo` interface
- `.github/workflows/release.yml` — Replace manual builds with tauri-action, add signing
- `install.sh` — Update artifact names for tauri-action bundle output

---

### Task 1: Signing Setup & Config

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`

This task requires interactive steps (key generation, adding GitHub secrets) that cannot be fully automated.

- [ ] **Step 1: Generate Tauri signing key pair**

```bash
npx tauri signer generate -w ~/.tauri/jackdaw.key
```

Save the output — it will display the public key. Store the private key file path and password securely.

- [ ] **Step 2: Add GitHub repository secrets**

Go to GitHub → Settings → Secrets and variables → Actions. Add:
- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/jackdaw.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose

- [ ] **Step 3: Add tauri-plugin-updater to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 4: Add @tauri-apps/plugin-updater to package.json**

```bash
npm install @tauri-apps/plugin-updater
```

- [ ] **Step 5: Add updater config to tauri.conf.json**

Add `"createUpdaterArtifacts": true` to the `bundle` section, and add the `plugins.updater` block:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  },
  "plugins": {
    "updater": {
      "pubkey": "<YOUR_PUBLIC_KEY_HERE>",
      "endpoints": [
        "https://github.com/andybarilla/jackdaw/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Replace `<YOUR_PUBLIC_KEY_HERE>` with the public key from step 1.

- [ ] **Step 6: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json package-lock.json
git commit -m "feat(updater): add tauri-plugin-updater dependency and config"
```

---

### Task 2: Backend — updater.rs Module

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write tests for updater state and commands**

Create `src-tauri/src/updater.rs` with the test module first. The updater plugin requires a running Tauri app to actually check for updates, so we test the parts we control: the `UpdateState` wrapper and the `set_auto_update` toggle.

```rust
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::Update;
use tokio::sync::Mutex;

/// Holds the pending update between check and install invocations.
pub struct UpdateState {
    pub pending: Mutex<Option<Update>>,
    pub auto_update_enabled: AtomicBool,
}

impl UpdateState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            auto_update_enabled: AtomicBool::new(true),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    pub chunk_length: usize,
    pub content_length: Option<u64>,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(update) => {
            let info = UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
                body: update.body.clone(),
            };
            let _ = app.emit("update-available", &info);
            let state = app.state::<UpdateState>();
            *state.pending.lock().await = Some(update);
            Ok(info)
        }
        None => Ok(UpdateInfo {
            available: false,
            version: None,
            body: None,
        }),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    // Take the pending update from state, dropping the borrow before doing anything else
    let update = {
        let state = app.state::<UpdateState>();
        state.pending.lock().await.take()
    };

    let update = match update {
        Some(u) => u,
        None => {
            // No stored update — re-check
            let updater = app.updater().map_err(|e| e.to_string())?;
            match updater.check().await.map_err(|e| e.to_string())? {
                Some(u) => u,
                None => return Err("No update available".into()),
            }
        }
    };

    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_handle.emit(
                    "update-progress",
                    UpdateProgress {
                        chunk_length,
                        content_length,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

#[tauri::command]
pub fn set_auto_update(enabled: bool, state: tauri::State<'_, UpdateState>) {
    state.auto_update_enabled.store(enabled, Ordering::Relaxed);
}

/// Spawns the background update check loop. Checks immediately, then every 24 hours.
/// Reads `UpdateState` from Tauri managed state (no Arc needed).
pub fn spawn_update_check_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let interval = std::time::Duration::from_secs(24 * 60 * 60);
        loop {
            let enabled = {
                let state = app.state::<UpdateState>();
                state.auto_update_enabled.load(Ordering::Relaxed)
            };
            if enabled {
                if let Ok(updater) = app.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        let info = UpdateInfo {
                            available: true,
                            version: Some(update.version.clone()),
                            body: update.body.clone(),
                        };
                        let _ = app.emit("update-available", &info);
                        let state = app.state::<UpdateState>();
                        *state.pending.lock().await = Some(update);
                    }
                }
            }
            tokio::time::sleep(interval).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_state_defaults_to_enabled() {
        let state = UpdateState::new();
        assert!(state.auto_update_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn update_state_toggle() {
        let state = UpdateState::new();
        state.auto_update_enabled.store(false, Ordering::Relaxed);
        assert!(!state.auto_update_enabled.load(Ordering::Relaxed));
        state.auto_update_enabled.store(true, Ordering::Relaxed);
        assert!(state.auto_update_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn update_info_serializes() {
        let info = UpdateInfo {
            available: true,
            version: Some("1.0.0".into()),
            body: Some("Release notes".into()),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"version\":\"1.0.0\""));
    }

    #[test]
    fn update_info_not_available() {
        let info = UpdateInfo {
            available: false,
            version: None,
            body: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"available\":false"));
    }

    #[tokio::test]
    async fn pending_update_starts_none() {
        let state = UpdateState::new();
        assert!(state.pending.lock().await.is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd src-tauri && cargo test updater
```

Expected: all 5 tests pass. The module compiles but the Tauri commands aren't wired up yet.

- [ ] **Step 3: Register module and plugin in lib.rs**

In `src-tauri/src/lib.rs`:

1. Add `mod updater;` to the module declarations at the top.

2. In the `setup` closure (after the tray creation), register the updater plugin and spawn the background loop:

```rust
#[cfg(desktop)]
app.handle()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .expect("failed to register updater plugin");

app.manage(updater::UpdateState::new());
updater::spawn_update_check_loop(app.handle().clone());
```

**Note:** The updater plugin MUST be registered inside `setup` via `app.handle().plugin(...)` (not on the builder chain like other plugins) because it is desktop-only and requires `#[cfg(desktop)]` gating. The background loop accesses `UpdateState` from Tauri managed state, so no `Arc` wrapper is needed.

3. Add the commands to the `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    dismiss_session,
    check_hooks_status,
    install_hooks,
    uninstall_hooks,
    get_session_history,
    get_retention_days,
    set_retention_days,
    updater::check_for_update,
    updater::install_update,
    updater::set_auto_update,
])
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors.

- [ ] **Step 5: Run all backend tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat(updater): add updater module with check, install, and background loop"
```

---

### Task 3: Tray Menu — "Check for Updates"

**Files:**
- Modify: `src-tauri/src/tray.rs:18-99`

- [ ] **Step 1: Add "Check for Updates" menu item**

In `create_tray()`, add a new menu item before the quit item:

```rust
let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?;
```

Update the menu builder to include it (between `settings` and `quit`):

```rust
let menu = MenuBuilder::new(app)
    .items(&[&show, &hooks_submenu, &separator, &settings, &check_updates, &quit])
    .build()?;
```

- [ ] **Step 2: Add the menu event handler**

In the `on_menu_event` closure, add a case for `"check_updates"`:

```rust
"check_updates" => {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match handle.updater() {
            Ok(u) => u,
            Err(e) => {
                eprintln!("Jackdaw: updater error: {}", e);
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                use tauri::Emitter;
                let info = crate::updater::UpdateInfo {
                    available: true,
                    version: Some(update.version.clone()),
                    body: update.body.clone(),
                };
                let _ = handle.emit("update-available", &info);
                let state = handle.state::<crate::updater::UpdateState>();
                *state.pending.lock().await = Some(update);
            }
            Ok(None) => {
                if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                    let _ = tray.set_tooltip(Some("Jackdaw — up to date"));
                }
            }
            Err(e) => eprintln!("Jackdaw: update check failed: {}", e),
        }
    });
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors.

- [ ] **Step 4: Run all backend tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tray.rs
git commit -m "feat(updater): add Check for Updates tray menu item"
```

---

### Task 4: Frontend — UpdaterStore

**Files:**
- Create: `src/lib/stores/updater.svelte.ts`
- Create: `src/lib/stores/updater.test.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add UpdateInfo type to types.ts**

Add to `src/lib/types.ts`:

```typescript
export interface UpdateInfo {
  available: boolean;
  version: string | null;
  body: string | null;
}

export interface UpdateProgress {
  chunk_length: number;
  content_length: number | null;
}
```

- [ ] **Step 2: Write failing tests for UpdaterStore**

Create `src/lib/stores/updater.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const { updaterStore } = await import('./updater.svelte');

describe('UpdaterStore', () => {
  it('starts with no update available', () => {
    expect(updaterStore.isUpdateAvailable).toBe(false);
    expect(updaterStore.availableVersion).toBeNull();
    expect(updaterStore.releaseNotes).toBeNull();
  });

  it('starts not downloading', () => {
    expect(updaterStore.isDownloading).toBe(false);
    expect(updaterStore.downloadedBytes).toBe(0);
    expect(updaterStore.totalBytes).toBeNull();
  });

  it('setUpdateAvailable updates state', () => {
    updaterStore.setUpdateAvailable({
      available: true,
      version: '1.2.0',
      body: 'Bug fixes',
    });
    expect(updaterStore.isUpdateAvailable).toBe(true);
    expect(updaterStore.availableVersion).toBe('1.2.0');
    expect(updaterStore.releaseNotes).toBe('Bug fixes');
  });

  it('addProgress accumulates bytes', () => {
    updaterStore.startDownload();
    expect(updaterStore.isDownloading).toBe(true);

    updaterStore.addProgress({ chunk_length: 1000, content_length: 5000 });
    expect(updaterStore.downloadedBytes).toBe(1000);
    expect(updaterStore.totalBytes).toBe(5000);

    updaterStore.addProgress({ chunk_length: 2000, content_length: 5000 });
    expect(updaterStore.downloadedBytes).toBe(3000);
  });

  it('reset clears all state', () => {
    updaterStore.reset();
    expect(updaterStore.isUpdateAvailable).toBe(false);
    expect(updaterStore.availableVersion).toBeNull();
    expect(updaterStore.isDownloading).toBe(false);
    expect(updaterStore.downloadedBytes).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --run src/lib/stores/updater.test.ts
```

Expected: FAIL — module `./updater.svelte` does not exist.

- [ ] **Step 4: Implement UpdaterStore**

Create `src/lib/stores/updater.svelte.ts`:

```typescript
import { listen } from '@tauri-apps/api/event';
import type { UpdateInfo, UpdateProgress } from '$lib/types';

class UpdaterStore {
  isUpdateAvailable = $state(false);
  availableVersion = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);
  isDownloading = $state(false);
  downloadedBytes = $state(0);
  totalBytes = $state<number | null>(null);

  setUpdateAvailable(info: UpdateInfo): void {
    this.isUpdateAvailable = info.available;
    this.availableVersion = info.version;
    this.releaseNotes = info.body;
  }

  startDownload(): void {
    this.isDownloading = true;
    this.downloadedBytes = 0;
    this.totalBytes = null;
  }

  addProgress(progress: UpdateProgress): void {
    this.downloadedBytes += progress.chunk_length;
    if (progress.content_length !== null) {
      this.totalBytes = progress.content_length;
    }
  }

  reset(): void {
    this.isUpdateAvailable = false;
    this.availableVersion = null;
    this.releaseNotes = null;
    this.isDownloading = false;
    this.downloadedBytes = 0;
    this.totalBytes = null;
  }
}

export const updaterStore = new UpdaterStore();

export function initUpdaterListener(): () => void {
  let unlistenAvailable: (() => void) | undefined;
  let unlistenProgress: (() => void) | undefined;

  listen<UpdateInfo>('update-available', (event) => {
    updaterStore.setUpdateAvailable(event.payload);
  }).then((fn) => {
    unlistenAvailable = fn;
  });

  listen<UpdateProgress>('update-progress', (event) => {
    updaterStore.addProgress(event.payload);
  }).then((fn) => {
    unlistenProgress = fn;
  });

  return () => {
    unlistenAvailable?.();
    unlistenProgress?.();
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/lib/stores/updater.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/stores/updater.svelte.ts src/lib/stores/updater.test.ts
git commit -m "feat(updater): add UpdaterStore with event listeners"
```

---

### Task 5: Frontend — UpdateBanner Component

**Files:**
- Create: `src/lib/components/UpdateBanner.svelte`
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Create UpdateBanner component**

Create `src/lib/components/UpdateBanner.svelte`:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { updaterStore } from '$lib/stores/updater.svelte';

  let installing = $state(false);
  let error = $state<string | null>(null);

  async function handleInstall() {
    installing = true;
    error = null;
    updaterStore.startDownload();
    try {
      await invoke('install_update');
    } catch (e) {
      error = String(e);
      installing = false;
    }
  }

  const progressPercent = $derived(
    updaterStore.totalBytes
      ? Math.round((updaterStore.downloadedBytes / updaterStore.totalBytes) * 100)
      : null,
  );
</script>

{#if updaterStore.isUpdateAvailable}
  <div class="update-banner">
    {#if updaterStore.isDownloading}
      <span class="update-text">
        Downloading v{updaterStore.availableVersion}...
        {#if progressPercent !== null}{progressPercent}%{/if}
      </span>
      {#if progressPercent !== null}
        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
      {/if}
    {:else if error}
      <span class="update-text error">Update failed: {error}</span>
      <button class="update-btn" onclick={handleInstall}>Retry</button>
    {:else}
      <span class="update-text">Jackdaw v{updaterStore.availableVersion} is available</span>
      <button class="update-btn" onclick={handleInstall} disabled={installing}>Update Now</button>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--card-bg);
    border: 1px solid var(--active);
    border-radius: 6px;
    margin-bottom: 6px;
  }

  .update-text {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .update-text.error {
    color: var(--error, #ef4444);
  }

  .update-btn {
    background: var(--active);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .update-btn:hover {
    opacity: 0.9;
  }

  .update-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--active);
    transition: width 0.2s;
  }
</style>
```

- [ ] **Step 2: Wire up Dashboard**

In `src/lib/components/Dashboard.svelte`:

1. Add imports at the top:

```typescript
import UpdateBanner from './UpdateBanner.svelte';
import { initUpdaterListener } from '$lib/stores/updater.svelte';
```

2. In the `onMount`, add the updater listener cleanup:

```typescript
onMount(() => {
  const cleanupSessions = initSessionListener();
  const cleanupUpdater = initUpdaterListener();
  return () => {
    cleanupSessions();
    cleanupUpdater();
  };
});
```

3. Add the banner in the template, right after the `.tabs` div and before `.session-list`:

```svelte
<UpdateBanner />
```

Place it inside the dashboard div but outside session-list so it's always visible regardless of tab.

- [ ] **Step 3: Verify it compiles**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 4: Run all frontend tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/UpdateBanner.svelte src/lib/components/Dashboard.svelte
git commit -m "feat(updater): add update banner to Dashboard"
```

---

### Task 6: Frontend — Settings Updates Section

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Add auto-update toggle and check button to Settings**

In `src/lib/components/Settings.svelte`:

1. Add imports:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { updaterStore } from '$lib/stores/updater.svelte';
```

2. Add state for auto-update and version:

```typescript
let autoUpdateEnabled = $state(true);
let appVersion = $state<string | null>(null);
let checking = $state(false);
```

3. In the existing `onMount`, after loading notification prefs, load the auto-update preference and app version:

```typescript
const savedAutoUpdate = await store.get<boolean>('auto_update_enabled');
if (savedAutoUpdate !== null) {
  autoUpdateEnabled = savedAutoUpdate;
}
appVersion = await getVersion();
```

4. Add toggle and check functions:

```typescript
async function toggleAutoUpdate() {
  autoUpdateEnabled = !autoUpdateEnabled;
  if (store) {
    await store.set('auto_update_enabled', autoUpdateEnabled);
    await store.save();
  }
  await invoke('set_auto_update', { enabled: autoUpdateEnabled });
}

async function checkForUpdates() {
  checking = true;
  try {
    await invoke('check_for_update');
  } catch (e) {
    console.error('Update check failed:', e);
  } finally {
    checking = false;
  }
}
```

5. Add the "Updates" section in the template, after the Notifications section:

```svelte
<h3 class="settings-title">Updates</h3>
<label class="toggle-row">
  <input type="checkbox" checked={autoUpdateEnabled} onchange={toggleAutoUpdate} />
  <span>Check for updates automatically</span>
</label>
<div class="update-actions">
  <button class="check-btn" onclick={checkForUpdates} disabled={checking}>
    {checking ? 'Checking...' : 'Check for Updates'}
  </button>
  {#if updaterStore.isUpdateAvailable}
    <span class="update-available">v{updaterStore.availableVersion} available</span>
  {/if}
</div>
{#if appVersion}
  <div class="version-info">Current version: v{appVersion}</div>
{/if}
```

6. Add styles:

```css
.update-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.check-btn {
  background: var(--card-bg);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.check-btn:hover {
  border-color: var(--text-muted);
}

.check-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.update-available {
  font-size: 12px;
  color: var(--active);
}

.version-info {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 0;
}
```

- [ ] **Step 2: Sync auto-update setting on app start**

The backend background loop defaults to enabled. If the user previously disabled it, the frontend needs to tell the backend on mount. This is already handled: the `onMount` loads the saved value, and if it's `false`, it should call `set_auto_update`. Add after loading the saved value:

```typescript
if (savedAutoUpdate === false) {
  await invoke('set_auto_update', { enabled: false });
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat(updater): add Updates section to Settings"
```

---

### Task 7: System Notification on Update Available

**Files:**
- Modify: `src/lib/stores/updater.svelte.ts`

- [ ] **Step 1: Add notification to the update-available listener**

In `src/lib/stores/updater.svelte.ts`, add the notification import and send a notification when an update is detected:

```typescript
import {
  isPermissionGranted,
  sendNotification,
} from '@tauri-apps/plugin-notification';
```

Update the `listen` callback for `update-available`:

```typescript
listen<UpdateInfo>('update-available', async (event) => {
  updaterStore.setUpdateAvailable(event.payload);
  try {
    if (await isPermissionGranted()) {
      sendNotification({
        title: 'Jackdaw Update Available',
        body: `Version ${event.payload.version} is ready to install`,
      });
    }
  } catch {
    // Notification permission denied — banner is the fallback
  }
}).then((fn) => {
  unlistenAvailable = fn;
});
```

**Note:** Tauri's `sendNotification` does not support click-to-focus actions cross-platform. The notification serves as an alert; the user opens the app via the tray icon to see the update banner and install.

- [ ] **Step 2: Verify it compiles**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/updater.svelte.ts
git commit -m "feat(updater): show system notification when update available"
```

---

### Task 8: CI — Release Workflow with tauri-action

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace release.yml with tauri-action**

Replace the contents of `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  publish:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: linux
          - os: macos-latest
            target: macos
          - os: windows-latest
            target: windows
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install Linux dependencies
        if: matrix.target == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Jackdaw ${{ github.ref_name }}'
          releaseBody: ''
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true

  install-script:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Upload install script
        uses: softprops/action-gh-release@v2
        with:
          files: install.sh
```

Key changes:
- Build steps replaced by `tauri-apps/tauri-action@v0`
- Signing env vars passed through
- `includeUpdaterJson: true` generates and uploads `latest.json`
- `tauri-action` handles creating the release and uploading all bundles
- `install-script` job kept separate since `tauri-action` manages the release

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(updater): migrate CI to tauri-action with signed builds"
```

---

### Task 9: Update install.sh for New Artifact Names

**Files:**
- Modify: `install.sh`

With `tauri-action`, the release artifacts change from raw binaries (`jackdaw-linux-x86_64`) to Tauri bundles. The AppImage is the best fit for `install.sh` since it's a self-contained executable.

- [ ] **Step 1: Update artifact names in install.sh**

The `tauri-action` uploads artifacts with names based on the `productName` in `tauri.conf.json`. Update the artifact resolution in `install.sh`:

```sh
case "$os" in
    linux)  artifact="jackdaw_${tag#v}_amd64.AppImage" ;;
    darwin) artifact="jackdaw_${tag#v}_aarch64.dmg" ;;
    *)      echo "Unsupported OS: $os"; exit 1 ;;
esac
```

**Note:** The exact artifact names depend on `tauri-action`'s output format, which uses the pattern `{productName}_{version}_{arch}.{ext}`. Verify the actual names after the first `tauri-action` release and adjust if needed. On Linux, the AppImage should be `chmod +x` and run directly. On macOS, the `.dmg` requires different install logic (mount, copy to Applications).

For now, focus on Linux (the primary `install.sh` target). macOS users typically use `.dmg` manually.

- [ ] **Step 2: Commit**

```bash
git add install.sh
git commit -m "fix: update install.sh artifact names for tauri-action releases"
```

---

### Task 10: Manual Verification

This task is manual — verify the full feature works end-to-end.

- [ ] **Step 1: Run all backend tests**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 2: Run type checking**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Run all frontend tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Dev mode smoke test**

```bash
npm run tauri dev
```

Verify:
- App starts without errors
- Settings tab shows the "Updates" section with toggle (on by default), "Check for Updates" button, and version display
- Tray menu includes "Check for Updates" item
- Clicking "Check for Updates" (from either Settings or tray) doesn't crash (it may report no update available since there's no newer release yet)

- [ ] **Step 5: Commit any fixes**

If any adjustments were needed during smoke testing, commit them.
