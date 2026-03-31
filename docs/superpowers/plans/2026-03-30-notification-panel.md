# Notification Panel & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent notification panel that aggregates events across all sessions, with filtering, click-to-focus, and 7-day TTL pruning.

**Architecture:** New `notifications` table in SQLite. Backend inserts notification rows on Stop/Notification/SessionEnd events and emits a `notification-event` Tauri event. Frontend has a dedicated `NotificationStore` and a slide-over `NotificationPanel` triggered by a bell icon in the header.

**Tech Stack:** Rust (rusqlite, tokio, serde, chrono), Svelte 5 runes, Tauri v2 commands/events, Vitest

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/notification.rs` | `Notification` struct, DB functions (insert, query, mark read, prune) |
| Modify | `src-tauri/src/db.rs` | Add `notifications` table to `setup_connection` |
| Modify | `src-tauri/src/lib.rs` | Register 3 new Tauri commands, start prune timer |
| Modify | `src-tauri/src/server.rs` | Insert notification + emit event after Stop/Notification/SessionEnd |
| Create | `src/lib/stores/notifications.svelte.ts` | `NotificationStore` class with reactive state |
| Create | `src/lib/components/NotificationPanel.svelte` | Slide-over panel UI |
| Modify | `src/lib/types.ts` | Add `Notification` interface |
| Modify | `src/lib/utils.ts` | Add `relativeTime()` utility |
| Modify | `src/lib/components/Header.svelte` | Add bell icon with unread badge |
| Modify | `src/lib/components/Dashboard.svelte` | Own panel open state, wire up event handlers |

---

### Task 1: Notifications table schema

**Files:**
- Modify: `src-tauri/src/db.rs:227-254` (setup_connection)

- [ ] **Step 1: Write failing test for notifications table**

In `src-tauri/src/db.rs`, add to the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn init_creates_notifications_table() {
    let conn = init_memory();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test init_creates_notifications_table`
Expected: FAIL — "no such table: notifications"

- [ ] **Step 3: Add notifications table to setup_connection**

In `src-tauri/src/db.rs`, inside `setup_connection`, add after the existing `CREATE TABLE IF NOT EXISTS config` block (before the closing `").unwrap();`):

```rust
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
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test init_creates_notifications_table`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add notifications table schema"
```

---

### Task 2: Notification struct and DB functions

**Files:**
- Create: `src-tauri/src/notification.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod notification;`)

- [ ] **Step 1: Write failing tests for insert and query**

Create `src-tauri/src/notification.rs`:

```rust
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: i64,
    pub session_id: String,
    pub event_type: String,
    pub title: String,
    pub body: String,
    pub cwd: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

pub fn insert_notification(
    conn: &Connection,
    session_id: &str,
    event_type: &str,
    title: &str,
    body: &str,
    cwd: &str,
    created_at: &DateTime<Utc>,
) -> Option<Notification> {
    todo!()
}

pub fn load_notifications(
    conn: &Connection,
    limit: u32,
    offset: u32,
    event_type_filter: Option<&str>,
) -> Vec<Notification> {
    todo!()
}

pub fn mark_read(conn: &Connection, id: i64) {
    todo!()
}

pub fn mark_all_read(conn: &Connection) {
    todo!()
}

pub fn prune_old_notifications(conn: &Connection, retention_days: u32) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn insert_and_load_notification() {
        let conn = db::init_memory();
        let now = Utc::now();
        let notif = insert_notification(
            &conn, "s1", "Stop", "Waiting for Input", "Session in /tmp is waiting", "/tmp", &now,
        ).unwrap();

        assert_eq!(notif.session_id, "s1");
        assert_eq!(notif.event_type, "Stop");
        assert_eq!(notif.title, "Waiting for Input");
        assert!(!notif.is_read);

        let loaded = load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, notif.id);
    }

    #[test]
    fn load_notifications_newest_first() {
        let conn = db::init_memory();
        let t1 = "2026-03-30T10:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let t2 = "2026-03-30T11:00:00Z".parse::<DateTime<Utc>>().unwrap();
        insert_notification(&conn, "s1", "Stop", "t1", "b1", "/tmp", &t1);
        insert_notification(&conn, "s1", "Notification", "t2", "b2", "/tmp", &t2);

        let loaded = load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].title, "t2"); // newer first
        assert_eq!(loaded[1].title, "t1");
    }

    #[test]
    fn load_notifications_with_filter() {
        let conn = db::init_memory();
        let now = Utc::now();
        insert_notification(&conn, "s1", "Stop", "t", "b", "/tmp", &now);
        insert_notification(&conn, "s1", "Notification", "t", "b", "/tmp", &now);
        insert_notification(&conn, "s1", "SessionEnd", "t", "b", "/tmp", &now);

        let filtered = load_notifications(&conn, 50, 0, Some("Notification"));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].event_type, "Notification");
    }

    #[test]
    fn load_notifications_pagination() {
        let conn = db::init_memory();
        for i in 0..5 {
            let t = format!("2026-03-30T1{}:00:00Z", i).parse::<DateTime<Utc>>().unwrap();
            insert_notification(&conn, "s1", "Stop", &format!("t{}", i), "b", "/tmp", &t);
        }

        let page1 = load_notifications(&conn, 2, 0, None);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].title, "t4"); // newest

        let page2 = load_notifications(&conn, 2, 2, None);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].title, "t2");
    }

    #[test]
    fn mark_read_sets_flag() {
        let conn = db::init_memory();
        let now = Utc::now();
        let notif = insert_notification(&conn, "s1", "Stop", "t", "b", "/tmp", &now).unwrap();
        assert!(!notif.is_read);

        mark_read(&conn, notif.id);
        let loaded = load_notifications(&conn, 50, 0, None);
        assert!(loaded[0].is_read);
    }

    #[test]
    fn mark_all_read_sets_all_flags() {
        let conn = db::init_memory();
        let now = Utc::now();
        insert_notification(&conn, "s1", "Stop", "t1", "b", "/tmp", &now);
        insert_notification(&conn, "s1", "Notification", "t2", "b", "/tmp", &now);

        mark_all_read(&conn);
        let loaded = load_notifications(&conn, 50, 0, None);
        assert!(loaded.iter().all(|n| n.is_read));
    }

    #[test]
    fn prune_deletes_old_notifications() {
        let conn = db::init_memory();
        let old = "2026-01-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let recent = Utc::now();
        insert_notification(&conn, "s1", "Stop", "old", "b", "/tmp", &old);
        insert_notification(&conn, "s1", "Stop", "recent", "b", "/tmp", &recent);

        prune_old_notifications(&conn, 7);
        let loaded = load_notifications(&conn, 50, 0, None);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "recent");
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add near the other `mod` declarations:

```rust
mod notification;
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test notification::tests`
Expected: FAIL — all functions have `todo!()`

- [ ] **Step 4: Implement insert_notification**

Replace the `todo!()` in `insert_notification`:

```rust
pub fn insert_notification(
    conn: &Connection,
    session_id: &str,
    event_type: &str,
    title: &str,
    body: &str,
    cwd: &str,
    created_at: &DateTime<Utc>,
) -> Option<Notification> {
    let created_str = created_at.to_rfc3339();
    conn.execute(
        "INSERT INTO notifications (session_id, event_type, title, body, cwd, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![session_id, event_type, title, body, cwd, created_str],
    ).unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to insert notification: {}", e);
        return 0;
    });
    let id = conn.last_insert_rowid();
    Some(Notification {
        id,
        session_id: session_id.to_string(),
        event_type: event_type.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        cwd: cwd.to_string(),
        is_read: false,
        created_at: *created_at,
    })
}
```

- [ ] **Step 5: Implement load_notifications**

Replace the `todo!()` in `load_notifications`:

```rust
pub fn load_notifications(
    conn: &Connection,
    limit: u32,
    offset: u32,
    event_type_filter: Option<&str>,
) -> Vec<Notification> {
    let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match event_type_filter {
        Some(et) => (
            "SELECT id, session_id, event_type, title, body, cwd, is_read, created_at
             FROM notifications
             WHERE event_type = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3",
            vec![
                Box::new(et.to_string()),
                Box::new(limit),
                Box::new(offset),
            ],
        ),
        None => (
            "SELECT id, session_id, event_type, title, body, cwd, is_read, created_at
             FROM notifications
             ORDER BY created_at DESC
             LIMIT ?1 OFFSET ?2",
            vec![Box::new(limit), Box::new(offset)],
        ),
    };

    let mut stmt = conn.prepare(sql).unwrap();
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    stmt.query_map(params_refs.as_slice(), |row| {
        let is_read_int: i32 = row.get(6)?;
        let created_str: String = row.get(7)?;
        Ok(Notification {
            id: row.get(0)?,
            session_id: row.get(1)?,
            event_type: row.get(2)?,
            title: row.get(3)?,
            body: row.get(4)?,
            cwd: row.get(5)?,
            is_read: is_read_int != 0,
            created_at: created_str
                .parse::<DateTime<Utc>>()
                .unwrap_or_else(|_| Utc::now()),
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}
```

- [ ] **Step 6: Implement mark_read and mark_all_read**

Replace the `todo!()` bodies:

```rust
pub fn mark_read(conn: &Connection, id: i64) {
    conn.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to mark notification read: {}", e);
        0
    });
}

pub fn mark_all_read(conn: &Connection) {
    conn.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0", [])
        .unwrap_or_else(|e| {
            eprintln!("Jackdaw: failed to mark all notifications read: {}", e);
            0
        });
}
```

- [ ] **Step 7: Implement prune_old_notifications**

Replace the `todo!()`:

```rust
pub fn prune_old_notifications(conn: &Connection, retention_days: u32) {
    conn.execute(
        "DELETE FROM notifications WHERE created_at < datetime('now', ?1)",
        rusqlite::params![format!("-{} days", retention_days)],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to prune notifications: {}", e);
        0
    });
}
```

- [ ] **Step 8: Run all notification tests**

Run: `cd src-tauri && cargo test notification::tests`
Expected: All 7 tests PASS

- [ ] **Step 9: Run full backend test suite**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/notification.rs src-tauri/src/lib.rs
git commit -m "feat: notification struct and DB functions"
```

---

### Task 3: Tauri commands for notifications

**Files:**
- Modify: `src-tauri/src/lib.rs` (add 3 commands + register + prune timer)

- [ ] **Step 1: Add Tauri commands**

In `src-tauri/src/lib.rs`, add these command functions (near the existing `mark_session_read`):

```rust
#[tauri::command]
fn get_notifications(
    limit: u32,
    offset: u32,
    event_type_filter: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Vec<notification::Notification> {
    let db = state.db.lock().unwrap();
    notification::load_notifications(&db, limit, offset, event_type_filter.as_deref())
}

#[tauri::command]
fn mark_notification_read(id: i64, state: tauri::State<'_, Arc<AppState>>) {
    let db = state.db.lock().unwrap();
    notification::mark_read(&db, id);
}

#[tauri::command]
fn mark_all_notifications_read(state: tauri::State<'_, Arc<AppState>>) {
    let db = state.db.lock().unwrap();
    notification::mark_all_read(&db);
}
```

- [ ] **Step 2: Register commands in invoke_handler**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![]` list:

```rust
get_notifications,
mark_notification_read,
mark_all_notifications_read,
```

- [ ] **Step 3: Add prune timer in setup**

In `src-tauri/src/lib.rs`, inside the `.setup()` closure, after the existing prune and server start, add:

```rust
// Prune old notifications on startup
{
    let db = app_state.db.lock().unwrap();
    notification::prune_old_notifications(&db, 7);
}

// Prune notifications every 6 hours
let prune_state = app_state.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 3600));
    interval.tick().await; // skip immediate tick
    loop {
        interval.tick().await;
        let db = prune_state.db.lock().unwrap();
        notification::prune_old_notifications(&db, 7);
    }
});
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS (commands compile but aren't invoked in tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: tauri commands and prune timer for notifications"
```

---

### Task 4: Emit notification events from server

**Files:**
- Modify: `src-tauri/src/server.rs:343-390` (notification section)

- [ ] **Step 1: Write failing test for notification insertion**

In `src-tauri/src/server.rs`, add to the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn notification_event_inserts_db_row() {
    let conn = db::init_memory();
    let now = chrono::Utc::now();

    // Insert directly using the notification module
    let notif = crate::notification::insert_notification(
        &conn, "s1", "Notification", "Approval Needed",
        "Session in /tmp needs approval", "/tmp", &now,
    );
    assert!(notif.is_some());

    let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].event_type, "Notification");
}

#[test]
fn stop_event_inserts_notification_row() {
    let conn = db::init_memory();
    let now = chrono::Utc::now();

    let notif = crate::notification::insert_notification(
        &conn, "s1", "Stop", "Waiting for Input",
        "Session in /tmp is waiting", "/tmp", &now,
    );
    assert!(notif.is_some());

    let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].event_type, "Stop");
}

#[test]
fn session_end_inserts_notification_row() {
    let conn = db::init_memory();
    let now = chrono::Utc::now();

    let notif = crate::notification::insert_notification(
        &conn, "s1", "SessionEnd", "Session Ended",
        "Session in /tmp has ended", "/tmp", &now,
    );
    assert!(notif.is_some());

    let loaded = crate::notification::load_notifications(&conn, 50, 0, None);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].event_type, "SessionEnd");
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd src-tauri && cargo test notification_event_inserts_db_row stop_event_inserts_notification_row session_end_inserts_notification_row`
Expected: PASS (these test the notification module directly)

- [ ] **Step 3: Add notification insertion to handle_event**

In `src-tauri/src/server.rs`, in the desktop notification section (around line 363, inside the `if crate::notify::should_notify(...)` block), **after** the desktop notification is shown and **after** the custom command spawn, add notification DB insertion. But we also want to insert even when the window IS visible (the panel should log all events, not just ones that triggered desktop notifications). So add this as a separate block after the entire desktop notification block (after line 390):

```rust
    // Persist notification to DB and emit event
    if let Some((title, body)) = crate::notify::notification_content(&event_name, &cwd) {
        let now = chrono::Utc::now();
        let sc = state.clone();
        let sid = session_id.clone();
        let evt = event_name.clone();
        let cwd_clone = cwd.clone();
        let app = app_handle.clone();
        let t = title.to_string();
        let b = body;
        tokio::task::spawn_blocking(move || {
            let db = sc.db.lock().unwrap();
            if let Some(notif) = crate::notification::insert_notification(
                &db, &sid, &evt, &t, &b, &cwd_clone, &now,
            ) {
                drop(db);
                let _ = app.emit("notification-event", &notif);
            }
        });
    }
```

- [ ] **Step 4: Verify compilation and tests**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: persist notifications and emit notification-event"
```

---

### Task 5: Frontend Notification type and relativeTime utility

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Add Notification interface to types.ts**

In `src/lib/types.ts`, add at the end:

```typescript
export interface Notification {
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

- [ ] **Step 2: Write failing test for relativeTime**

In `src/lib/utils.test.ts`, add:

```typescript
import { relativeTime } from './utils';

describe('relativeTime', () => {
  it('returns "just now" for less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('just now');
  });

  it('returns minutes for less than 1 hour', () => {
    const d = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(d)).toBe('5m ago');
  });

  it('returns hours for less than 24 hours', () => {
    const d = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(d)).toBe('3h ago');
  });

  it('returns days for 1+ days', () => {
    const d = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(relativeTime(d)).toBe('2d ago');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run utils.test`
Expected: FAIL — `relativeTime` is not exported

- [ ] **Step 4: Implement relativeTime**

In `src/lib/utils.ts`, add:

```typescript
/** Format an ISO timestamp as a relative time: "just now", "5m ago", "3h ago", "2d ago" */
export function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run utils.test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: notification type and relativeTime utility"
```

---

### Task 6: NotificationStore

**Files:**
- Create: `src/lib/stores/notifications.svelte.ts`
- Create: `src/lib/stores/notifications.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/stores/notifications.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

const { notificationStore } = await import('./notifications.svelte');

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    session_id: 'test-session',
    event_type: 'Stop',
    title: 'Waiting for Input',
    body: 'Session in /tmp is waiting',
    cwd: '/tmp',
    is_read: false,
    created_at: '2026-03-30T12:00:00Z',
    ...overrides,
  };
}

describe('NotificationStore', () => {
  it('unreadCount reflects unread notifications', () => {
    notificationStore.notifications = [
      makeNotification({ id: 1, is_read: false }),
      makeNotification({ id: 2, is_read: true }),
      makeNotification({ id: 3, is_read: false }),
    ];
    expect(notificationStore.unreadCount).toBe(2);
  });

  it('unreadCount is 0 when all read', () => {
    notificationStore.notifications = [
      makeNotification({ id: 1, is_read: true }),
    ];
    expect(notificationStore.unreadCount).toBe(0);
  });

  it('unreadCount is 0 when empty', () => {
    notificationStore.notifications = [];
    expect(notificationStore.unreadCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run notifications.test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement NotificationStore**

Create `src/lib/stores/notifications.svelte.ts`:

```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Notification } from '$lib/types';

class NotificationStore {
  notifications = $state<Notification[]>([]);

  get unreadCount(): number {
    return this.notifications.filter(n => !n.is_read).length;
  }

  async load(limit: number = 50, offset: number = 0, eventTypeFilter?: string): Promise<void> {
    const result = await invoke<Notification[]>('get_notifications', {
      limit,
      offset,
      eventTypeFilter: eventTypeFilter ?? null,
    });
    if (offset === 0) {
      this.notifications = result;
    } else {
      this.notifications = [...this.notifications, ...result];
    }
  }

  prepend(notification: Notification): void {
    this.notifications = [notification, ...this.notifications];
  }

  async markRead(id: number): Promise<void> {
    await invoke('mark_notification_read', { id });
    this.notifications = this.notifications.map(n =>
      n.id === id ? { ...n, is_read: true } : n
    );
  }

  async markAllRead(): Promise<void> {
    await invoke('mark_all_notifications_read');
    this.notifications = this.notifications.map(n => ({ ...n, is_read: true }));
  }
}

export const notificationStore = new NotificationStore();

export function initNotificationListener(): () => void {
  let unlisten: (() => void) | undefined;

  listen<Notification>('notification-event', (event) => {
    notificationStore.prepend(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run notifications.test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/notifications.svelte.ts src/lib/stores/notifications.test.ts
git commit -m "feat: NotificationStore with event listener"
```

---

### Task 7: Bell icon in Header

**Files:**
- Modify: `src/lib/components/Header.svelte`

- [ ] **Step 1: Add bell icon with badge**

Update `src/lib/components/Header.svelte`. Add to the Props interface:

```typescript
interface Props {
  sessionCount: number;
  globalState: 'approval' | 'input' | 'running' | 'idle';
  unreadCount: number;
  onToggleNotifications: () => void;
}
```

Update the destructuring:

```typescript
let { sessionCount, globalState, unreadCount, onToggleNotifications }: Props = $props();
```

Add `Bell` to the lucide import:

```typescript
import { ShieldAlert, MessageSquare, Play, Circle, Bell } from 'lucide-svelte';
```

Add the bell button in the template, inside `.header-right`, after the status text span:

```svelte
    <button class="bell-btn" onclick={onToggleNotifications} title="Notifications">
      <Bell size={14} strokeWidth={2} />
      {#if unreadCount > 0}
        <span class="bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {/if}
    </button>
```

Add CSS for the bell:

```css
.bell-btn {
  position: relative;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 4px;
  transition: color 0.15s;
}

.bell-btn:hover {
  color: var(--text-primary);
}

.bell-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  background: var(--active);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: Type errors in Dashboard.svelte because it doesn't pass the new props yet. That's expected — we'll fix it in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Header.svelte
git commit -m "feat: bell icon with unread badge in header"
```

---

### Task 8: NotificationPanel component

**Files:**
- Create: `src/lib/components/NotificationPanel.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/NotificationPanel.svelte`:

```svelte
<script lang="ts">
  import { notificationStore } from '$lib/stores/notifications.svelte';
  import { relativeTime, getProjectName } from '$lib/utils';
  import type { Notification } from '$lib/types';

  interface Props {
    open: boolean;
    onClose: () => void;
    onSelectSession: (sessionId: string) => void;
  }

  let { open, onClose, onSelectSession }: Props = $props();

  let filters = $state<Set<string>>(new Set(['Notification', 'Stop', 'SessionEnd']));
  let now = $state(Date.now());

  // Refresh relative timestamps every 30 seconds
  $effect(() => {
    if (!open) return;
    const timer = setInterval(() => { now = Date.now(); }, 30000);
    return () => clearInterval(timer);
  });

  // Load notifications when panel opens
  $effect(() => {
    if (open) {
      notificationStore.load();
      filters = new Set(['Notification', 'Stop', 'SessionEnd']);
    }
  });

  let filtered = $derived(
    notificationStore.notifications.filter(n => filters.has(n.event_type))
  );

  function toggleFilter(eventType: string): void {
    const next = new Set(filters);
    if (next.has(eventType)) {
      next.delete(eventType);
    } else {
      next.add(eventType);
    }
    filters = next;
  }

  function handleClick(notification: Notification): void {
    notificationStore.markRead(notification.id);
    onSelectSession(notification.session_id);
    onClose();
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }

  async function loadMore(): Promise<void> {
    await notificationStore.load(50, notificationStore.notifications.length);
  }

  // Force re-evaluation of relativeTime by referencing `now`
  function timeAgo(isoDate: string): string {
    void now;
    return relativeTime(isoDate);
  }

  const eventTypeLabel: Record<string, string> = {
    Notification: 'Approval',
    Stop: 'Input',
    SessionEnd: 'Ended',
  };

  const eventTypeColorVar: Record<string, string> = {
    Notification: 'var(--state-approval)',
    Stop: 'var(--state-input)',
    SessionEnd: 'var(--state-idle)',
  };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel-backdrop" onclick={handleBackdropClick}>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Notifications</span>
        <div class="panel-actions">
          <button class="mark-all-btn" onclick={() => notificationStore.markAllRead()}>Mark all read</button>
          <button class="close-btn" onclick={onClose}>×</button>
        </div>
      </div>

      <div class="filter-bar">
        {#each ['Notification', 'Stop', 'SessionEnd'] as eventType}
          <button
            class="filter-pill"
            class:active={filters.has(eventType)}
            style="--pill-color: {eventTypeColorVar[eventType]}"
            onclick={() => toggleFilter(eventType)}
          >
            {eventTypeLabel[eventType]}
          </button>
        {/each}
      </div>

      <div class="notification-list">
        {#if filtered.length === 0}
          <div class="empty-state">
            {notificationStore.notifications.length === 0 ? 'No notifications' : 'No matching notifications'}
          </div>
        {:else}
          {#each filtered as notification (notification.id)}
            <button class="notification-entry" class:unread={!notification.is_read} onclick={() => handleClick(notification)}>
              <span class="event-badge" style="background: {eventTypeColorVar[notification.event_type]}">
                {eventTypeLabel[notification.event_type]}
              </span>
              <div class="entry-content">
                <span class="entry-project">{getProjectName(notification.cwd)}</span>
                <span class="entry-body">{notification.body}</span>
              </div>
              <div class="entry-meta">
                <span class="entry-time" title={notification.created_at}>{timeAgo(notification.created_at)}</span>
                {#if !notification.is_read}
                  <span class="unread-dot"></span>
                {/if}
              </div>
            </button>
          {/each}
          <button class="load-more-btn" onclick={loadMore}>Load more</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 380px;
    background: var(--bg);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mark-all-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 4px 8px;
    transition: color 0.15s;
  }

  .mark-all-btn:hover {
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .filter-bar {
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }

  .filter-pill {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 12px;
    transition: all 0.15s;
  }

  .filter-pill.active {
    border-color: var(--pill-color);
    color: var(--pill-color);
  }

  .filter-pill:hover {
    border-color: var(--text-secondary);
  }

  .notification-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .notification-entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    width: 100%;
  }

  .notification-entry:hover {
    background: var(--card-bg);
  }

  .notification-entry.unread {
    background: rgba(255, 255, 255, 0.02);
  }

  .event-badge {
    font-size: 10px;
    font-weight: 600;
    color: #000;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-project {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .entry-body {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }

  .entry-time {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .unread-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--active);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-muted);
    font-size: 13px;
    padding: 40px;
  }

  .load-more-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 12px;
    text-align: center;
    transition: color 0.15s;
  }

  .load-more-btn:hover {
    color: var(--text-primary);
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: May have errors about Dashboard not passing new Header props — expected, fixed in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/NotificationPanel.svelte
git commit -m "feat: notification slide-over panel component"
```

---

### Task 9: Wire everything together in Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Integrate notification store and panel**

In `src/lib/components/Dashboard.svelte`, add imports:

```typescript
import NotificationPanel from './NotificationPanel.svelte';
import { notificationStore, initNotificationListener } from '$lib/stores/notifications.svelte';
```

Add state:

```typescript
let notificationPanelOpen = $state(false);
```

In `onMount`, add the notification listener initialization alongside the existing ones:

```typescript
const cleanupNotifications = initNotificationListener();
```

And add to the cleanup return:

```typescript
cleanupNotifications();
```

Add handler functions:

```typescript
function toggleNotificationPanel() {
  notificationPanelOpen = !notificationPanelOpen;
}

function handleNotificationSelect(sessionId: string) {
  selectSession(sessionId);
  notificationPanelOpen = false;
}
```

Update the Header component usage to pass new props:

```svelte
<Header
  sessionCount={sessionStore.count}
  globalState={sessionStore.globalState}
  unreadCount={notificationStore.unreadCount}
  onToggleNotifications={toggleNotificationPanel}
/>
```

Add NotificationPanel before the closing `</div>` of `.app-layout`:

```svelte
<NotificationPanel
  open={notificationPanelOpen}
  onClose={() => { notificationPanelOpen = false; }}
  onSelectSession={handleNotificationSelect}
/>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Run all frontend tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: wire notification panel into dashboard"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 2: Run full frontend test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: No errors

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`

Verify:
1. Bell icon appears in the header (no badge when no notifications)
2. Start a Claude Code session — observe "Stop" events create notification entries
3. Click bell — panel slides in from right
4. Notification entries show event badge, project name, relative time, unread dot
5. Click a notification — panel closes, session is selected
6. "Mark all read" clears unread dots and badge
7. Filter pills toggle event types
8. Click outside panel to close
9. Restart app — notifications persist (within 7 days)

- [ ] **Step 5: Final commit if any manual adjustments needed**

```bash
git add -A
git commit -m "feat: notification panel polish"
```
