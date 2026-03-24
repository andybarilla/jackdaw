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
- Raw binaries continue to be uploaded for `install.sh` compatibility

## Backend

### Dependencies

- Add `tauri-plugin-updater` to `Cargo.toml`
- Add `@tauri-apps/plugin-updater` to `package.json`

### Plugin Registration (`lib.rs`)

Register `.plugin(tauri_plugin_updater::Builder::new().build())` in Tauri setup.

### New Module: `updater.rs`

**Background task** (spawned at startup):
1. Read `auto_update_enabled` from the store (default: `true`)
2. If enabled, check for updates immediately, then every 24 hours
3. On update found, emit `"update-available"` event with `{ version, body }`

**Tauri commands**:
- `check_for_update` — manual check, returns `{ available: bool, version?: string, body?: string }` or error
- `install_update` — downloads and installs the update, emits `"update-progress"` events with download percentage, restarts app on completion

### Event Flow

1. Background task or manual check → `updater.check()`
2. Update found → emit `"update-available"` with version and release notes
3. User triggers install → frontend invokes `install_update`
4. Backend downloads, emitting `"update-progress"` events
5. Download complete → restart app

## Frontend

### New Store: `stores/updater.svelte.ts`

`UpdaterStore` class:
- Listens to `"update-available"` and `"update-progress"` Tauri events
- Reactive state: `availableVersion`, `releaseNotes`, `downloadProgress`, `isDownloading`, `isUpdateAvailable`

### System Notification

When `"update-available"` fires, use the notification plugin to show: "Jackdaw v{version} is available". Clicking it brings the window to focus.

### Dashboard Banner

When an update is available, show a banner at the top of the Dashboard:
- Displays version number and "Update Now" button
- During download, shows progress bar
- After download, prompts to restart

### Settings.svelte Additions

New "Updates" section below existing "Notifications" section:
- **Auto-Update** toggle (default: on) — persisted to `settings.json` store as `auto_update_enabled`
- **Check for Updates** button — manual trigger regardless of toggle state
- **Current version** display
- Available update info if one exists

### Tray Menu (`tray.rs`)

Add "Check for Updates" menu item that triggers the same manual check flow.

## Setting Persistence

Uses the existing `tauri-plugin-store` with `settings.json`:
- Key: `auto_update_enabled`
- Default: `true`
- Read by the backend background task to decide whether to auto-check
- Toggled by the Settings UI

## Testing

### Backend
- `updater.rs` unit tests: mock update check responses, verify event emission, verify setting controls behavior
- Integration test: verify plugin registration and command availability

### Frontend
- `UpdaterStore` tests: verify reactive state updates on event emission
- `Settings.svelte` tests: verify toggle persists setting, check button invokes command
- Dashboard banner tests: verify banner appears/hides based on update state, progress display
