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
    let created_str = created_at.to_rfc3339();
    let changed = conn
        .execute(
            "INSERT INTO notifications (session_id, event_type, title, body, cwd, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![session_id, event_type, title, body, cwd, created_str],
        )
        .unwrap_or_else(|e| {
            eprintln!("Jackdaw: failed to insert notification: {}", e);
            0
        });
    if changed == 0 {
        return None;
    }
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

pub fn load_notifications(
    conn: &Connection,
    limit: u32,
    offset: u32,
    event_type_filter: Option<&str>,
) -> Vec<Notification> {
    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match event_type_filter {
        Some(filter) => (
            "SELECT id, session_id, event_type, title, body, cwd, is_read, created_at
             FROM notifications WHERE event_type = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
                .to_string(),
            vec![
                Box::new(filter.to_string()),
                Box::new(limit),
                Box::new(offset),
            ],
        ),
        None => (
            "SELECT id, session_id, event_type, title, body, cwd, is_read, created_at
             FROM notifications
             ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
                .to_string(),
            vec![Box::new(limit), Box::new(offset)],
        ),
    };

    let mut stmt = conn.prepare(&sql).unwrap();
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    stmt.query_map(params_refs.as_slice(), |row| {
        let is_read_int: i64 = row.get(6)?;
        let created_str: String = row.get(7)?;
        Ok(Notification {
            id: row.get(0)?,
            session_id: row.get(1)?,
            event_type: row.get(2)?,
            title: row.get(3)?,
            body: row.get(4)?,
            cwd: row.get(5)?,
            is_read: is_read_int != 0,
            created_at: created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

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
    conn.execute(
        "UPDATE notifications SET is_read = 1 WHERE is_read = 0",
        [],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to mark all notifications read: {}", e);
        0
    });
}

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
        )
        .unwrap();
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
        assert_eq!(loaded[0].title, "t2");
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
            let t = format!("2026-03-30T1{}:00:00Z", i)
                .parse::<DateTime<Utc>>()
                .unwrap();
            insert_notification(&conn, "s1", "Stop", &format!("t{}", i), "b", "/tmp", &t);
        }
        let page1 = load_notifications(&conn, 2, 0, None);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].title, "t4");
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
