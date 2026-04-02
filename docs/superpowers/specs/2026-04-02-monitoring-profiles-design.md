# Monitoring Profiles Design

Per-project alert configuration via user-assigned profiles. Sessions in directories associated with a profile use that profile's alert settings; unmatched sessions fall back to global defaults.

## Data Model

New `profiles` key in Tauri Store (`settings.json`):

```typescript
interface MonitoringProfile {
  id: string;            // UUID
  name: string;          // user-assigned label
  directories: string[]; // associated cwds, exact match
  alerts: AlertPrefs;    // on_approval_needed, on_session_end, on_stop
  alert_volume: number;  // 0-100
  notification_command: string; // shell command, empty = none
}
```

Global settings remain as-is and serve as the default. No "default" profile object. One directory can belong to at most one profile.

## Backend Changes

### Profile Resolution

In `notify.rs`, a new function loads profiles from Tauri Store and finds the matching profile for a given `cwd`. If no match, returns `None` — caller falls back to global settings.

The existing alert resolution path (`resolve_alert_tier` or its caller) checks for a profile match first before using global settings. No structural changes to the notification dispatch pipeline.

### Session Annotation

On SessionStart, the backend resolves the matching profile and stores the profile name on the `Session` struct as `profile_name: Option<String>`. Emitted to the frontend with every `session-update` event.

### New Tauri Commands

- `get_profiles() -> Vec<MonitoringProfile>` — reads from store
- `save_profiles(profiles: Vec<MonitoringProfile>)` — writes full profile list to store

Full-list write (not individual CRUD) — frontend owns list state, profile count is small.

## Frontend Changes

### Settings Tab

New "Monitoring Profiles" section in the existing Settings tab.

**Profile list:** Each profile as a card/row showing name, directory count, and alert level summary. Click to expand/edit. Button to add new profile.

**Profile editor** (inline expand): name, directories (list with add/remove), alert tiers (same 3 dropdowns as global), volume slider, notification command input. Delete button with confirmation.

Global settings section gets a note: "These settings apply to sessions not matched by any profile."

### Session Indicator

`SessionCard` shows a small badge with the profile name when `profile_name` is present on the session.

### No Changes To

Grouping, sidebar, tabs, dashboard layout.

## Matching Flow

1. Hook event arrives at `server.rs` with `session_id` and `cwd`
2. Session state updated in `state.rs` as usual
3. On alert-triggering events (Stop, Notification, SessionEnd): load profiles from store, linear scan for `cwd` in `profile.directories`
4. Match found → use profile's alert settings. No match → global settings.
5. On SessionStart: resolve profile, store `profile_name` on Session struct

No caching needed — profile list is small and changes rarely.

## Testing

### Backend (Rust)

- Profile matching: exact cwd match, no match fallback, one-directory-one-profile
- Alert resolution with profile overrides vs global defaults
- `profile_name` set on Session when profile matches, None when not

### Frontend (Vitest)

- Profile editor: add/edit/delete, validation (name required, no duplicate directories across profiles)
- Profile list rendering and expansion
- SessionCard profile badge presence/absence

### Integration

- Manual: create profile, start session in matched directory, verify alert behavior
