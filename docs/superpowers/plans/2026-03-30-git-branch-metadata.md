# Git Branch Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current git branch on each session card, refreshed on every hook event.

**Architecture:** On each hook event, run `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. Store as `git_branch: Option<String>` on `Session`. Persist to DB. Display below header in SessionCard.

**Tech Stack:** Rust (tokio::process::Command), Svelte 5, SQLite

---

### Task 1: Add `git_branch` to Session Struct

**Files:**
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/server.rs` (existing test module)

- [ ] **Step 1: Write failing test**

In `src-tauri/src/server.rs`, add to the `tests` module:

```rust
#[test]
fn session_has_git_branch_field() {
    use crate::state::Session;
    let session = Session::new("s1".into(), "/tmp".into());
    assert_eq!(session.git_branch, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test session_has_git_branch_field`
Expected: FAIL — `git_branch` field doesn't exist on `Session`

- [ ] **Step 3: Add `git_branch` field to Session**

In `src-tauri/src/state.rs`, add to the `Session` struct after `processing`:

```rust
pub git_branch: Option<String>,
```

In the `Session::new()` constructor (wherever `processing: false` is set), add:

```rust
git_branch: None,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test session_has_git_branch_field`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/server.rs
git commit -m "feat: add git_branch field to Session struct"
```

---

### Task 2: Implement `resolve_git_branch` Helper

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing test**

In `src-tauri/src/state.rs`, add to or create the `tests` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_git_branch_returns_branch_in_git_repo() {
        // The jackdaw repo itself is a git repo, so cwd "." should return a branch
        let branch = resolve_git_branch(".").await;
        assert!(branch.is_some());
        assert!(!branch.unwrap().is_empty());
    }

    #[tokio::test]
    async fn resolve_git_branch_returns_none_for_non_git_dir() {
        let branch = resolve_git_branch("/tmp").await;
        assert!(branch.is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test resolve_git_branch`
Expected: FAIL — `resolve_git_branch` doesn't exist

- [ ] **Step 3: Implement `resolve_git_branch`**

In `src-tauri/src/state.rs`, add:

```rust
pub async fn resolve_git_branch(cwd: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test resolve_git_branch`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add resolve_git_branch async helper"
```

---

### Task 3: Call `resolve_git_branch` in Event Handler

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Add branch resolution after state mutation**

In `src-tauri/src/server.rs`, in `handle_event`, after the `match event_name.as_str()` block and before the session-update emission block (before line 198 `// Emit updated session list`), add:

```rust
// Resolve git branch (non-blocking, runs git in cwd)
if event_name != "SessionEnd" {
    if let Some(session) = sessions.get_mut(&session_id) {
        let cwd = session.cwd.clone();
        // Drop lock to run async git command
        drop(sessions);
        let branch = crate::state::resolve_git_branch(&cwd).await;
        sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.git_branch = branch;
        }
    }
}
```

Note: The `sessions` variable is already dropped later at line 201, so we need to re-acquire it. But there's a subtlety — `sessions` is used between the match block and the emit block. The cleanest approach: add the branch resolution right after the match block, before the emit code. Since we need to drop and re-acquire the lock, restructure so `sessions` is re-acquired:

Actually, looking at the code more carefully, the existing code at line 198 already uses `sessions` which was locked at line 79. We need to insert branch resolution between the match block (ends at line 196) and the emit block (starts at line 198). We'll drop and re-acquire:

```rust
// After the match block (line 196), before emit block:

// Resolve git branch for non-end events
if event_name != "SessionEnd" {
    let cwd_for_git = sessions.get(&session_id).map(|s| s.cwd.clone());
    drop(sessions);
    let branch = if let Some(cwd) = cwd_for_git {
        crate::state::resolve_git_branch(&cwd).await
    } else {
        None
    };
    sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.git_branch = branch;
    }
}
```

- [ ] **Step 2: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — existing tests still work, git_branch is now populated

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: resolve git branch on every hook event"
```

---

### Task 4: Persist `git_branch` to DB

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing test**

In `src-tauri/src/db.rs` test module:

```rust
#[test]
fn save_session_stores_git_branch() {
    let conn = init_memory();
    save_session(&conn, "s1", "/tmp", "2026-03-30T00:00:00Z");
    update_git_branch(&conn, "s1", Some("feat-test"));

    let history = load_history(&conn, 50, 0);
    // History only shows ended sessions, so end it first
    end_session(&conn, "s1", "2026-03-30T01:00:00Z");
    let history = load_history(&conn, 50, 0);
    assert_eq!(history.len(), 1);
    // git_branch should be accessible on HistorySession
}
```

Actually, the simplest approach: add `git_branch` column to the sessions table and a function to update it.

```rust
#[test]
fn update_git_branch_persists() {
    let conn = init_memory();
    save_session(&conn, "s1", "/tmp", "2026-03-30T00:00:00Z");
    update_git_branch(&conn, "s1", Some("feat-test"));

    let branch: Option<String> = conn
        .query_row(
            "SELECT git_branch FROM sessions WHERE session_id = ?1",
            rusqlite::params!["s1"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(branch, Some("feat-test".to_string()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test update_git_branch_persists`
Expected: FAIL — `update_git_branch` doesn't exist, `git_branch` column doesn't exist

- [ ] **Step 3: Add column and function**

In `src-tauri/src/db.rs`, add to the schema setup (the CREATE TABLE for sessions):

```sql
ALTER TABLE sessions ADD COLUMN git_branch TEXT;
```

Since this is SQLite with `CREATE TABLE IF NOT EXISTS`, the best approach is to add the column to the original CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    git_branch TEXT
);
```

And add a migration for existing databases. Add after the CREATE TABLE statements:

```rust
// Migration: add git_branch column if missing
let _ = conn.execute("ALTER TABLE sessions ADD COLUMN git_branch TEXT", []);
```

Add the `update_git_branch` function:

```rust
pub fn update_git_branch(conn: &Connection, session_id: &str, branch: Option<&str>) {
    conn.execute(
        "UPDATE sessions SET git_branch = ?1 WHERE session_id = ?2",
        rusqlite::params![branch, session_id],
    )
    .unwrap_or_else(|e| {
        eprintln!("Jackdaw: failed to update git_branch: {}", e);
        0
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test update_git_branch_persists`
Expected: PASS

- [ ] **Step 5: Add DB persistence call in server.rs**

In `src-tauri/src/server.rs`, in the DB persistence section at the end of `handle_event`, add branch persistence. After the session save calls, add:

```rust
// Persist git branch
if event_name != "SessionEnd" {
    let branch = sessions_for_branch; // We need to capture this before drop
    // Actually, we need the branch from the session. Capture it earlier.
}
```

The cleanest approach: capture `git_branch` from the session right after the emit block (after line 201 where sessions is dropped). Actually, we should capture it before dropping sessions. Add right before `drop(sessions)` at line 201:

```rust
let db_git_branch = sessions.get(&session_id).and_then(|s| s.git_branch.clone());
```

Then in the DB persistence section, after the existing spawn_blocking calls:

```rust
if event_name != "SessionEnd" {
    if let Some(branch) = db_git_branch {
        let sc = state.clone();
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || {
            let db = sc.db.lock().unwrap();
            crate::db::update_git_branch(&db, &sid, Some(&branch));
        });
    }
}
```

- [ ] **Step 6: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/server.rs
git commit -m "feat: persist git_branch to database"
```

---

### Task 5: Add `git_branch` to HistorySession and Frontend Types

**Files:**
- Modify: `src-tauri/src/db.rs` (HistorySession struct, load_history query)
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add `git_branch` to HistorySession**

In `src-tauri/src/db.rs`, find the `HistorySession` struct and add:

```rust
pub git_branch: Option<String>,
```

Update `load_history` query to include `git_branch`:

```sql
SELECT session_id, cwd, started_at, ended_at, git_branch FROM sessions WHERE ended_at IS NOT NULL ...
```

And the row mapping:

```rust
git_branch: row.get(4)?,
```

- [ ] **Step 2: Add `git_branch` to TypeScript types**

In `src/lib/types.ts`, add to `Session` interface:

```typescript
git_branch: string | null;
```

Add to `HistorySession` interface:

```typescript
git_branch: string | null;
```

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: PASS (or errors only in SessionCard where we'll use it next)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db.rs src/lib/types.ts
git commit -m "feat: add git_branch to HistorySession and frontend types"
```

---

### Task 6: Display Git Branch in SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add metadata row to SessionCard**

In `src/lib/components/SessionCard.svelte`, after the `row-header` div (after line 50's closing `</div>`) and before the tool row `{#if isActive || isPending}`, add:

```svelte
<!-- Branch metadata row -->
{#if session.git_branch}
  <div class="metadata-row">
    <span class="branch-icon">⎇</span>
    <span class="branch-name">{session.git_branch}</span>
  </div>
{/if}
```

Add styles:

```css
.metadata-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 6px;
}

.branch-icon {
  font-size: 11px;
  color: var(--text-muted);
}

.branch-name {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: display git branch below session card header"
```

---

### Task 7: Verify End-to-End

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 2: Run frontend checks**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Run frontend tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`
- Start a Claude Code session in a git repo
- Verify branch name appears below the project name on the session card
- Switch branches in the repo, trigger another hook event, verify it updates
- Check a session in a non-git directory shows no branch row
