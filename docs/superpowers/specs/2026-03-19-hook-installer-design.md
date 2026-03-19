# Jackdaw Hook Installer — Design Spec

**Date:** 2026-03-19
**Status:** Approved

## Overview

One-click installation of Claude Code HTTP hooks that point at Jackdaw's event server. Eliminates the need for users to manually edit `settings.json` with curl commands or HTTP hook configurations.

## Hook Configuration

Jackdaw installs native HTTP hooks (not command/curl hooks) for four events:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ]
  }
}
```

- 5-second timeout so hooks don't block Claude Code if Jackdaw is down
- Non-2xx responses are non-blocking in Claude Code, so sessions continue normally when Jackdaw is closed

**Pre-existing bug fix:** The server handler in `server.rs` currently matches on `"SessionStop"`, but the actual Claude Code hook event name is `"Stop"`. This must be fixed as part of this work — rename the match arm from `"SessionStop"` to `"Stop"`.

## Scope Options

- **User-level** (`~/.claude/settings.json`) — hooks apply globally to all Claude Code sessions. This is the default.
- **Project-level** (`<cwd>/.claude/settings.json`) — per-project hooks. Available in the dashboard UI only (not tray menu, since there's no good way to pick a path from a tray context menu).

## Architecture: Rust `hooks.rs` Module

### Core Functions

- `get_settings_path(scope, cwd)` — resolves `~/.claude/settings.json` (user) or `<cwd>/.claude/settings.json` (project). Project scope requires `cwd` to be `Some`; passing `None` with project scope is an error.
- `read_settings(path)` — reads and parses existing settings; returns empty object if file doesn't exist
- `check_hooks_status(path)` — returns `NotInstalled`, `Installed`, or `Outdated` (wrong port or missing events)
- `install_hooks(path)` — merges Jackdaw hooks into existing settings, preserving all other hooks and settings
- `uninstall_hooks(path)` — removes only Jackdaw hooks, preserving everything else

### Merge Strategy

- For each event (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`), check if a matcher group with Jackdaw's HTTP hook already exists
- Identify Jackdaw hooks by matching on the URL pattern `http://localhost:{port}/events`
- If found, update in place (e.g., port changed). If not, append a new matcher group alongside existing ones
- Never touch hooks that aren't Jackdaw's

### Tauri Commands

- `check_hooks_status(scope: "user" | "project", cwd: Option<String>)` — returns status enum
- `install_hooks(scope: "user" | "project", cwd: Option<String>)` — installs/updates, returns success/error
- `uninstall_hooks(scope: "user" | "project", cwd: Option<String>)` — removes Jackdaw hooks

## Frontend: Dashboard Integration

### Empty State Onboarding

When `sessionStore.count === 0`, the Dashboard shows an onboarding card:

- Default selection is user-level
- Project-level option shows a text input for the project path
- After install, card shows success state: "Hooks installed. Start a Claude Code session to see it here."
- If hooks already installed, shows status with Update/Reinstall option if outdated

### New Component: `HookSetup.svelte`

Self-contained card component handling scope toggle, install action, and status display.

## Tray Menu Integration

```
Show Dashboard
Install Claude Hooks  →  submenu:
                           ├─ User-level (global)
                           └─ Uninstall
─────────────
Settings
Quit
```

- Submenu with "User-level (global)" and "Uninstall"
- No project-level in tray (dashboard-only for that)
- After install/uninstall, tooltip update confirms the action

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File doesn't exist | Create it with just the hooks config. Create `.claude/` directory if missing. |
| Invalid JSON | Return error to UI. Don't overwrite. User must fix manually. |
| Permission errors | Surface OS error message in UI. |
| Port mismatch | `check_hooks_status` detects hooks pointing at wrong port as `Outdated`. Hook URL uses `AppState.port`. |
| Jackdaw not running | Claude Code continues normally (non-blocking HTTP hooks). Sessions just won't be tracked. |
| Concurrent writes | No locking needed. User-initiated action on personal machine; concurrent write risk is negligible. |
| Project scope without cwd | Return error. Project scope requires a path to be provided. |

## Implementation Notes

- **Atomic writes:** Write to a temp file in the same directory, then rename to the target path. Prevents corruption if the process is interrupted mid-write.
- **JSON5/JSONC:** Claude Code settings files may contain comments. Use strict JSON parsing (`serde_json`). If parsing fails due to comments, surface a clear error suggesting the user remove comments or install hooks manually. Document this as a known limitation.
- **Tray menu:** Static submenu labels ("User-level (global)" and "Uninstall") — no dynamic status reflection in the tray. Status checking is dashboard-only.
- **TypeScript types:** Add `HookStatus` (`"not_installed" | "installed" | "outdated"`) and `HookScope` (`"user" | "project"`) types to `src/lib/types.ts`.
- **Port:** Currently hardcoded to 9876. The hooks module reads from `AppState.port` for forward-compatibility, but port mismatch detection is only relevant if port becomes configurable in the future.
