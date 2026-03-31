# Notification Panel & History

## Overview

A slide-over notification panel that aggregates notification events across all sessions, with persistence, filtering, and click-to-focus navigation. Extends the existing desktop notification and `has_unread` tracking into a browsable, persistent log.

## Data Model

### Notification struct (Rust)

New file: `src-tauri/src/notification.rs` (not to be confused with `notify.rs` which handles desktop notifications and custom commands).

```rust
struct Notification {
    id: i64,
    session_id: String,
    event_type: String,   // "Notification", "Stop", "SessionEnd"
    title: String,        // "Approval Needed", "Waiting for Input", "Session Ended"
    body: String,         // "Session in {cwd} needs approval"
    cwd: String,
    is_read: bool,
    created_at: DateTime<Utc>,
}
```

`cwd` is denormalized from the session for fast display without joins.

### Database schema

New table in `db.rs`:

```sql
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    cwd TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_created ON notifications(created_at);
```

### TTL pruning

On startup and every 6 hours, delete rows where `created_at < now - 7 days`. Hardcoded initially.

## Backend

### Integration point

In `server.rs`, when handling "Notification", "Stop", or "SessionEnd" events — after the existing session state update and desktop notification logic — insert a row into the `notifications` table and emit a `notification-event` Tauri event carrying the full `Notification` struct.

### New Tauri commands

- `get_notifications(limit: i64, offset: i64, event_type_filter: Option<String>)` → `Vec<Notification>` — paginated query, optional filter by event type
- `mark_notification_read(id: i64)` — marks a single notification as read
- `mark_all_notifications_read()` — marks all notifications as read

### New Tauri event

`notification-event` — emitted when a notification is created, carrying the `Notification` struct. Separate from the existing `session-update` event.

## Frontend

### Types

New `Notification` interface in `src/lib/types.ts`:

```typescript
interface Notification {
    id: number;
    session_id: string;
    event_type: string;
    title: string;
    body: string;
    cwd: string;
    is_read: boolean;
    created_at: string;
}
```

New `relativeTime(iso: string): string` utility in `src/lib/utils.ts` — returns "just now", "2m ago", "1h ago", "3d ago". Used by NotificationPanel for display.

### NotificationStore

New file: `src/lib/stores/notifications.svelte.ts`

```typescript
class NotificationStore {
    notifications = $state<Notification[]>([]);
    unreadCount = $derived(this.notifications.filter(n => !n.is_read).length);
}
```

- Loads initial notifications via `get_notifications` (limit 50) on mount
- Listens for `notification-event` and prepends new entries
- Exposes `markRead(id)`, `markAllRead()`, `loadMore()` for pagination
- Manages active filter state (`eventTypeFilter: string | null`)
- Relative timestamps re-derive every 30 seconds via a timer

### NotificationPanel.svelte

Slide-over drawer, `position: fixed`, slides in from the right edge over the main area. ~380px wide with a subtle backdrop shadow on the left edge.

**Header**: "Notifications" title, filter toggle pills (Approval / Input / Ended), "Mark all read" button, close X button.

**Body**: Scrollable list of notification entries, newest first. Each entry shows:
- Colored event-type badge (uses existing `--state-approval`, `--state-input`, `--state-idle` CSS vars)
- Relative timestamp ("2m ago", "1h ago", "3d ago") with absolute timestamp on hover
- Project name derived from cwd
- Unread dot indicator

**Interactions**:
- Click entry → marks read, selects associated session in sidebar, closes panel
- "Mark all read" → bulk marks all read, badge disappears
- Filter pills → toggle event types on/off (all active by default, ephemeral state resets on close)
- Click outside panel / Escape → closes panel

**Empty state**: "No notifications" or "No matching notifications" when filtered.

**Pagination**: "Load more" button at bottom if older entries exist. Initial load: 50.

### Header.svelte changes

Bell icon added to the right of the existing status area. Shows unread count badge (small accent-colored circle) when `unreadCount > 0`. Click toggles notification panel.

### Dashboard.svelte changes

- Owns `notificationPanelOpen` state
- Passes toggle handler to Header
- Renders NotificationPanel conditionally
- Handles `select-session` from notification click (selects session + closes panel)

### Per-session indicators

Existing `has_unread` dot on SessionCard remains unchanged. The global panel provides the aggregated view.

## Testing

### Backend tests
- Notification insertion on each event type (Notification, Stop, SessionEnd)
- `get_notifications` with and without filters, pagination
- `mark_notification_read` and `mark_all_notifications_read`
- TTL pruning deletes old rows, preserves recent ones
- `notification-event` emission

### Frontend tests
- NotificationStore: initial load, prepend on event, markRead, markAllRead, filter
- NotificationPanel: renders entries, click-to-focus dispatches correct session ID, filter toggles, empty states
- Header: bell icon shows/hides badge based on unread count
- Relative timestamp formatting
