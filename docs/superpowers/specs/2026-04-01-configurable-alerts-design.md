# Configurable Sound/Visual Alerts

## Overview

Replace the current per-event boolean notification toggles with an urgency-tier system. Each event type maps to an urgency level (High/Medium/Low/Off) that controls which alert channels fire: sound, tray icon animation, session card pulse, OS dock/taskbar bounce, and desktop notification.

## Urgency Tiers

| Tier | Sound | Tray Animation | Card Pulse | Dock Bounce | Desktop Notif |
|------|-------|---------------|------------|-------------|---------------|
| High | Sharp chime | Red pulse (3-4 frames) | Yes | Yes | Yes |
| Medium | Softer tone | Amber pulse (3-4 frames) | Yes | No | Yes |
| Low | Subtle click | None | Yes | No | No |
| Off | — | — | — | — | — |

Default mapping:
- **Approval Needed** → High
- **Waiting for Input** → Medium
- **Session Ended** → Low

## Alert Channels

### Sound

Bundled audio files, one per urgency tier. Played from the frontend via the Web Audio API when a `session-update` event arrives with a state change that warrants an alert.

Three sound files shipped in `src/lib/assets/sounds/`:
- `alert-high.wav` — short, sharp chime
- `alert-medium.wav` — softer two-tone
- `alert-low.wav` — subtle click/pop

Sound playback is frontend-only. The backend determines the urgency tier and includes it in the session-update event payload. The frontend maps tier to sound file and plays it.

A volume slider in settings controls alert sound volume (0–100, default 80). A "Sound theme" dropdown shows "Default" for now — the data model supports future themes by swapping the file set.

### Tray Icon Animation

Animated tray icon using pre-rendered frames cycled on a timer. Two animation sets:
- **Red pulse**: 3-4 frames at varying glow intensity, used for High urgency
- **Amber pulse**: 3-4 frames at varying glow intensity, used for Medium urgency

Frames are embedded at compile time alongside existing tray icons. Animation runs at ~500ms per frame (~2s cycle). The animation loop runs in `tray.rs` via a `tokio::spawn` task that swaps the tray icon on an interval.

Animation stops when:
- The user opens the Jackdaw window (focus event)
- The triggering session is dismissed
- A higher-urgency alert replaces it (highest urgency wins)
- The session state changes (e.g., approval given, new prompt submitted)

When multiple sessions have active alerts, the tray shows the animation for the highest urgency.

### Session Card Pulse

CSS animation on the `SessionCard` component. A brief colored border/glow pulse when the alert fires:
- High: red pulse
- Medium: amber pulse
- Low: blue pulse

The animation plays once (~1.5s) when the state change arrives. The card retains a subtle left-border accent in the urgency color until acknowledged (clicked or session state changes).

### Dock/Taskbar Bounce

Uses Tauri's `window.request_user_attention(RequestUserAttention::Critical)` on macOS (dock bounce) and Windows (taskbar flash). Linux behavior depends on the window manager.

Fires **only for High urgency**. Called from the backend in `server.rs` after determining the alert tier.

### Desktop Notification

Existing `tauri-plugin-notification` behavior, unchanged. Fires for High and Medium tiers. The notification title and body remain the same as today.

## Data Model Changes

### Backend

New enum in `notify.rs`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum AlertTier {
    High,
    Medium,
    Low,
    Off,
}
```

Replace `NotificationPrefs` with `AlertPrefs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertPrefs {
    pub on_approval_needed: AlertTier,  // default: High
    pub on_session_end: AlertTier,      // default: Low
    pub on_stop: AlertTier,             // default: Medium
}
```

The store key remains `"notifications"` for backward compatibility. On load, if the stored value has the old boolean format, migrate it: `true` → the event's default tier, `false` → Off.

Volume and sound theme are frontend-only concerns stored as separate keys in the settings store: `"alert_volume"` (u8, default 80) and `"alert_sound_theme"` (string, default "default").

### Session-Update Event

Add an `alert_tier` field to the session update payload so the frontend knows which sound/animation to play. This is an `Option<AlertTier>` — `None` means no alert on this update, `Some(tier)` means play the alert.

## Settings UI

Replace the current three checkboxes with a preset-based layout:

```
Alerts
─────────────────────────────
Approval Needed          [High ▾]
Waiting for Input        [Medium ▾]
Session Ended            [Low ▾]

Volume                   [────●──] 80%
Sound theme              [Default ▾]
```

Each dropdown offers: High, Medium, Low, Off.

The existing "Run command on notification" text field stays below the new alert settings — it still fires for any tier except Off.

## Backend Changes

### `notify.rs`

- Add `AlertTier` enum and `AlertPrefs` struct
- Replace `should_notify` with `resolve_alert_tier(event_name: &str, is_visible: bool, prefs: &AlertPrefs) -> AlertTier` — returns `Off` if window is visible
- Add `alert_channels(tier: AlertTier)` → struct describing which channels to fire
- Migrate old boolean prefs on load

### `server.rs`

In `handle_event()`, after updating session state:
1. Call `resolve_alert_tier` to determine the tier
2. If tier != Off:
   - Include `alert_tier` in the emitted session-update event
   - If tier is High, call `window.request_user_attention(Critical)`
   - Start/update tray animation if tier is High or Medium
   - Fire desktop notification if tier is High or Medium
   - Run notification command if configured

### `tray.rs`

- Embed animation frames (red pulse × 4, amber pulse × 4) alongside existing icons
- Add `start_tray_animation(tier: AlertTier)` and `stop_tray_animation()` functions
- Animation task: `tokio::spawn` loop that cycles frames every 500ms
- Track current animation state to handle priority (High > Medium) and stop conditions
- Stop animation on window focus (listen to window focus event)

### `state.rs`

Add `alert_tier: Option<AlertTier>` to the `Session` struct for the frontend to consume.

## Frontend Changes

### `types.ts`

Add `AlertTier` type and update `Session` interface with optional `alert_tier` field.

### `SessionCard.svelte`

- Add CSS classes for pulse animation per tier: `.alert-high`, `.alert-medium`, `.alert-low`
- Apply class when `session.alert_tier` is set
- Keyframe animation: border-color + box-shadow pulse, plays once, then holds subtle accent

### `stores/sessions.svelte.ts`

- On session-update, check `alert_tier` field
- If present, play the corresponding sound file via Web Audio API
- Clear `alert_tier` from local state after playing (it's a one-shot signal)

### `Settings.svelte`

- Replace checkbox toggles with dropdown selects per event type
- Add volume slider
- Add sound theme dropdown (single "Default" option)
- Read/write `AlertPrefs` to store under `"notifications"` key

### Sound Assets

Create `src/lib/assets/sounds/` with three `.wav` files. These should be short (< 1s), distinct, and appropriate for a professional tool. Generate or source royalty-free sounds.

### Tray Icon Frames

Create animation frames in `src-tauri/icons/`:
- `tray-red-1.png` through `tray-red-4.png`
- `tray-amber-1.png` through `tray-amber-4.png`

Same dimensions as existing tray icons. Each set shows the base icon with a progressively intensifying colored glow, then fading back.

## Migration

On first load with the new code, `AlertPrefs` deserialization from the store will fail if the old boolean format is present. The backend handles this by:
1. Attempting to deserialize as `AlertPrefs`
2. On failure, attempting to deserialize as the old `NotificationPrefs`
3. Converting: `true` → default tier for that event, `false` → Off
4. Saving the migrated prefs back to the store

## Testing

### Backend (cargo test)

- `resolve_alert_tier` — all combinations of event type, visibility, and tier setting
- `alert_channels` — verify correct channels per tier
- Migration from old boolean prefs to new tier prefs
- Tray animation state management (priority, start/stop conditions)

### Frontend (vitest)

- Settings component: dropdown changes persist to store
- Session card: correct CSS class applied per alert tier
- Sound playback: correct file selected per tier (mock Audio API)
