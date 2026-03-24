# Auto-Update Design

## Overview

Add in-app auto-update to Jackdaw using Tauri's official updater plugin. The app checks GitHub Releases for newer versions on launch and every 24 hours, downloads and installs updates in-place, and restarts. Users can disable auto-update via Settings.

## Signing Setup

Tauri's updater requires artifact signing. This uses a Tauri-specific key pair (not OS code-signing).

**Local setup**:
- Generate key pair: `npx tauri signer generate -w ~/.tauri/jackdaw.key`
- Produces a password-protected private key and a public key

**GitHub Secrets**:
- `TAURI_SIGNING_PRIVATE_KEY` — private key contents
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — key password

**Config** (`tauri.conf.json`):
```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<public-key>",
      "endpoints": [
        "https://github.com/andybarilla/jackdaw/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## CI/Release Workflow

Replace manual build steps in `release.yml` with `tauri-apps/tauri-action`.

**What changes**:
- Build step uses `tauri-action` with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars
- Produces signed platform-specific update bundles:
  - Linux: `.AppImage.tar.gz` + `.AppImage.tar.gz.sig`
  - macOS: `.app.tar.gz` + `.app.tar.gz.sig`
  - Windows: `.nsis.zip` + `.nsis.zip.sig`
- Generates and uploads `latest.json` manifest to the GitHub Release
- `tauri-action` handles the GitHub Release creation/upload; `softprops/action-gh-release` is removed
- Raw binaries: `tauri-action` produces installable bundles (AppImage, .deb, .dmg, .exe) that are uploaded to the release. Update `install.sh` to download the AppImage (Linux) or platform binary from these bundles instead of the current raw binary names.

## Backend

### Dependencies

- Add `tauri-plugin-updater` to `Cargo.toml`
- Add `@tauri-apps/plugin-updater` to `package.json`

### Plugin Registration (`lib.rs`)

Register inside the `setup` closure with desktop gating:
```rust
.setup(move |app| {
    #[cfg(desktop)]
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
    // ...
})
```

### New Module: `updater.rs`

**Update state**: Store `Mutex<Option<Update>>` in Tauri managed state so the `Update` object persists between check and install invocations.

**Background task** (spawned at startup):
1. On each interval (immediately, then every 24 hours), check for updates
2. If update found, store the `Update` in managed state and emit `"update-available"` event with `{ version, body }`
3. The background task respects the auto-update setting — but this is controlled by the frontend: on settings change, the frontend calls `set_auto_update` to toggle the background loop

**Tauri commands**:
- `check_for_update` — manual check. Calls `updater.check()`, stores the `Update` object in managed state if available, returns `{ available: bool, version?: string, body?: string }`
- `install_update` — takes the stored `Update` from managed state, calls `download_and_install()`, emits `"update-progress"` events with download percentage, restarts app on completion. If no stored `Update`, re-checks first.
- `set_auto_update(enabled: bool)` — toggles the background check loop on/off. The frontend calls this when the Settings toggle changes.

### Event Flow

1. Background task or manual check → `updater.check()`
2. Update found → store `Update` in managed state, emit `"update-available"` with version and release notes
3. User triggers install → frontend invokes `install_update`
4. Backend retrieves stored `Update`, downloads, emitting `"update-progress"` events
5. Download complete → restart app

## Frontend

### New Store: `stores/updater.svelte.ts`

`UpdaterStore` class:
- Listens to `"update-available"` and `"update-progress"` Tauri events
- Reactive state: `availableVersion`, `releaseNotes`, `downloadProgress`, `isDownloading`, `isUpdateAvailable`

### System Notification

When `"update-available"` fires, attempt to show an OS notification: "Jackdaw v{version} is available". If notification permission is denied, fall back to the Dashboard banner only (no error). Clicking the notification brings the window to focus.

### Dashboard Banner

When an update is available, show a banner at the top of the Dashboard:
- Displays version number and "Update Now" button
- During download, shows progress bar
- After download, prompts to restart

### Settings.svelte Additions

New "Updates" section below existing "Notifications" section:
- **Auto-Update** toggle (default: on) — persisted to `settings.json` store as `auto_update_enabled`. On change, calls `set_auto_update` command to toggle the backend background loop.
- **Check for Updates** button — manual trigger regardless of toggle state
- **Current version** display
- Available update info if one exists

### Tray Menu (`tray.rs`)

Add "Check for Updates" menu item that triggers the same manual check flow.

## Setting Persistence

Uses the existing `tauri-plugin-store` with `settings.json`:
- Key: `auto_update_enabled`
- Default: `true`
- Frontend owns the setting value and persists it to the store
- Frontend calls `set_auto_update` command to sync the preference to the backend background task
- On app startup, the background task defaults to enabled; the frontend reads the store on mount and calls `set_auto_update(false)` if the user had disabled it

## Testing

### Backend
- `updater.rs` unit tests: verify `set_auto_update` toggles background loop, verify `Update` storage in managed state
- Integration test: verify plugin registration and command availability

### Frontend
- `UpdaterStore` tests: verify reactive state updates on event emission
- `Settings.svelte` tests: verify toggle persists setting and calls `set_auto_update`, check button invokes `check_for_update`
- Dashboard banner tests: verify banner appears/hides based on update state, progress display
