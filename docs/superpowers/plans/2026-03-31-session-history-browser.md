# Session History Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search, filtering, infinite scroll, and session actions (open terminal, resume) to the History tab.

**Architecture:** New `search_history` DB function with SQL LIKE + date range filtering, exposed via a Tauri command. Frontend enhances the History tab with a search bar, filter chips, infinite scroll via IntersectionObserver, and action buttons in the detail view. A `resume_session` Tauri command spawns `claude --resume` in a PTY with fallback to plain `spawn_terminal`.

**Tech Stack:** Rust (rusqlite, Tauri commands, portable-pty), Svelte 5 (runes), TypeScript, Vitest

---

### Task 1: Backend — `DateFilter` enum and `search_history` DB function

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing tests for `search_history`**

Add these tests to the `#[cfg(test)] mod tests` block in `src-tauri/src/db.rs`:

```rust
#[test]
fn search_history_no_filters_returns_all_ended() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/alpha", "2026-03-20T00:00:00Z");
    end_session(&conn, "s1", "2026-03-20T01:00:00Z");
    save_session(&conn, "s2", "/home/user/beta", "2026-03-21T00:00:00Z");
    end_session(&conn, "s2", "2026-03-21T01:00:00Z");
    save_session(&conn, "s3", "/home/user/gamma", "2026-03-22T00:00:00Z");
    // s3 not ended — should not appear
    let results = search_history(&conn, None, None, 50, 0);
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].session_id, "s2"); // newest first
    assert_eq!(results[1].session_id, "s1");
}

#[test]
fn search_history_query_matches_cwd() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/jackdaw", "2026-03-20T00:00:00Z");
    end_session(&conn, "s1", "2026-03-20T01:00:00Z");
    save_session(&conn, "s2", "/home/user/sparrow", "2026-03-21T00:00:00Z");
    end_session(&conn, "s2", "2026-03-21T01:00:00Z");
    let results = search_history(&conn, Some("jackdaw"), None, 50, 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, "s1");
}

#[test]
fn search_history_query_matches_git_branch() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/project", "2026-03-20T00:00:00Z");
    update_git_branch(&conn, "s1", Some("feat-auth"));
    end_session(&conn, "s1", "2026-03-20T01:00:00Z");
    save_session(&conn, "s2", "/home/user/project", "2026-03-21T00:00:00Z");
    update_git_branch(&conn, "s2", Some("main"));
    end_session(&conn, "s2", "2026-03-21T01:00:00Z");
    let results = search_history(&conn, Some("feat-auth"), None, 50, 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, "s1");
}

#[test]
fn search_history_query_is_case_insensitive() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/Jackdaw", "2026-03-20T00:00:00Z");
    end_session(&conn, "s1", "2026-03-20T01:00:00Z");
    let results = search_history(&conn, Some("jackdaw"), None, 50, 0);
    assert_eq!(results.len(), 1);
}

#[test]
fn search_history_date_filter_today() {
    let conn = init_memory();
    // "Today" uses SQLite's date('now','start of day') which is UTC-based.
    // We insert one session ended "now" and one ended 2 days ago.
    save_session(&conn, "old", "/tmp", "2026-03-28T00:00:00Z");
    end_session(&conn, "old", "2026-03-28T01:00:00Z");
    save_session(&conn, "recent", "/tmp", "2026-03-31T10:00:00Z");
    end_session(&conn, "recent", &chrono::Utc::now().to_rfc3339());
    let results = search_history(&conn, None, Some(DateFilter::Today), 50, 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, "recent");
}

#[test]
fn search_history_query_plus_date_filter() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/jackdaw", "2026-03-31T10:00:00Z");
    end_session(&conn, "s1", &chrono::Utc::now().to_rfc3339());
    save_session(&conn, "s2", "/home/user/sparrow", "2026-03-31T11:00:00Z");
    end_session(&conn, "s2", &chrono::Utc::now().to_rfc3339());
    let results = search_history(&conn, Some("jackdaw"), Some(DateFilter::Today), 50, 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, "s1");
}

#[test]
fn search_history_pagination() {
    let conn = init_memory();
    for i in 0..5 {
        let id = format!("s{}", i);
        save_session(&conn, &id, "/tmp", &format!("2026-03-21T0{}:00:00Z", i));
        end_session(&conn, &id, &format!("2026-03-21T0{}:30:00Z", i));
    }
    let page1 = search_history(&conn, None, None, 2, 0);
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].session_id, "s4");
    let page2 = search_history(&conn, None, None, 2, 2);
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].session_id, "s2");
}

#[test]
fn search_history_no_matches() {
    let conn = init_memory();
    save_session(&conn, "s1", "/home/user/project", "2026-03-20T00:00:00Z");
    end_session(&conn, "s1", "2026-03-20T01:00:00Z");
    let results = search_history(&conn, Some("nonexistent"), None, 50, 0);
    assert!(results.is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test search_history`
Expected: compilation errors — `search_history` and `DateFilter` don't exist yet.

- [ ] **Step 3: Implement `DateFilter` and `search_history`**

Add to `src-tauri/src/db.rs`, above the `setup_connection` function:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateFilter {
    Today,
    ThisWeek,
    ThisMonth,
}

pub fn search_history(
    conn: &Connection,
    query: Option<&str>,
    date_filter: Option<DateFilter>,
    limit: u32,
    offset: u32,
) -> Vec<HistorySession> {
    let mut sql = String::from(
        "SELECT session_id, cwd, started_at, ended_at, git_branch FROM sessions WHERE ended_at IS NOT NULL",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(q) = query {
        let pattern = format!("%{}%", q);
        sql.push_str(" AND (cwd LIKE ?1 COLLATE NOCASE OR git_branch LIKE ?2 COLLATE NOCASE)");
        params.push(Box::new(pattern.clone()));
        params.push(Box::new(pattern));
    }

    let param_offset = params.len();
    match date_filter {
        Some(DateFilter::Today) => {
            sql.push_str(&format!(
                " AND ended_at >= datetime('now', 'start of day')"
            ));
        }
        Some(DateFilter::ThisWeek) => {
            sql.push_str(&format!(" AND ended_at >= datetime('now', '-7 days')"));
        }
        Some(DateFilter::ThisMonth) => {
            sql.push_str(&format!(" AND ended_at >= datetime('now', '-30 days')"));
        }
        None => {}
    }

    let limit_idx = param_offset + 1;
    let offset_idx = param_offset + 2;
    sql.push_str(&format!(
        " ORDER BY ended_at DESC LIMIT ?{} OFFSET ?{}",
        limit_idx, offset_idx
    ));
    params.push(Box::new(limit));
    params.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql).unwrap();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let sessions: Vec<(String, String, String, String, Option<String>)> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut tool_stmt = conn
        .prepare(
            "SELECT tool_name, summary, timestamp FROM tool_events
             WHERE session_id = ?1
             ORDER BY timestamp ASC
             LIMIT 50",
        )
        .unwrap();

    sessions
        .into_iter()
        .map(|(session_id, cwd, started_at, ended_at, git_branch)| {
            let tool_history: Vec<HistoryToolEvent> = tool_stmt
                .query_map(rusqlite::params![&session_id], |row| {
                    Ok(HistoryToolEvent {
                        tool_name: row.get(0)?,
                        summary: row.get(1)?,
                        timestamp: row.get(2)?,
                    })
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            HistorySession {
                session_id,
                cwd,
                started_at,
                ended_at,
                git_branch,
                tool_history,
            }
        })
        .collect()
}
```

Add `use serde::Deserialize;` to the top of `db.rs` (already has `use serde::Serialize;`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test search_history`
Expected: all 8 `search_history` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add search_history with query and date filtering"
```

---

### Task 2: Backend — `search_session_history` Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs:52-60` (near `get_session_history`)

- [ ] **Step 1: Add `search_session_history` command**

Add this command to `src-tauri/src/lib.rs`, below the existing `get_session_history` function:

```rust
#[tauri::command]
fn search_session_history(
    query: Option<String>,
    date_filter: Option<db::DateFilter>,
    limit: u32,
    offset: u32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Vec<db::HistorySession> {
    let db = state.db.lock().unwrap();
    db::search_history(&db, query.as_deref(), date_filter, limit, offset)
}
```

- [ ] **Step 2: Register the command in the invoke handler**

In `src-tauri/src/lib.rs`, add `search_session_history` to the `tauri::generate_handler!` macro, after `get_session_history`:

```rust
get_session_history,
search_session_history,
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add search_session_history Tauri command"
```

---

### Task 3: Backend — `resume_session` Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `ResumeResult` struct and `resume_session` command**

Add below the `spawn_terminal` function in `src-tauri/src/lib.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
struct ResumeResult {
    pty_id: String,
    resumed: bool,
}

#[tauri::command]
async fn resume_session(
    session_id: String,
    cwd: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<ResumeResult, String> {
    let pty_id = uuid::Uuid::new_v4().to_string();

    // Pre-create the session so it appears immediately
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new(pty_id.clone(), cwd.clone());
        session.source = SessionSource::Spawned;
        sessions.insert(pty_id.clone(), session);
    }

    // Emit updated session list
    {
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let _ = app.emit("session-update", &session_list);
        crate::tray::update_tray(&app, &session_list);
    }

    // Try claude --resume first
    let pty_mgr_inner = pty_mgr.inner().clone();
    let cwd_clone = cwd.clone();
    let pty_id_for_spawn = pty_id.clone();
    let session_id_clone = session_id.clone();

    let resume_result = tokio::task::spawn_blocking(move || {
        pty_mgr_inner.spawn(pty::SpawnConfig {
            id: pty_id_for_spawn,
            cwd: &cwd_clone,
            cols: 80,
            rows: 24,
            program: "claude",
            args: &["--resume", &session_id_clone],
            env: &[],
        })
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))?;

    let (reader, resumed) = match resume_result {
        Ok(reader) => (reader, true),
        Err(_) => {
            // Fallback: spawn claude without --resume
            let pty_mgr_inner = pty_mgr.inner().clone();
            let cwd_clone = cwd.clone();
            let pty_id_for_spawn = pty_id.clone();

            let reader = tokio::task::spawn_blocking(move || {
                pty_mgr_inner.spawn(pty::SpawnConfig {
                    id: pty_id_for_spawn,
                    cwd: &cwd_clone,
                    cols: 80,
                    rows: 24,
                    program: "claude",
                    args: &[],
                    env: &[],
                })
            })
            .await
            .map_err(|e| format!("spawn task failed: {}", e))??;

            (reader, false)
        }
    };

    // Spawn background reader thread (same pattern as spawn_terminal)
    let app_clone = app.clone();
    let pty_id_for_reader = pty_id.clone();
    let pty_mgr_for_exit = pty_mgr.inner().clone();

    std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let engine = base64::engine::general_purpose::STANDARD;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded = engine.encode(&buf[..n]);
                    let _ = app_clone.emit(
                        "terminal-output",
                        serde_json::json!({
                            "session_id": pty_id_for_reader,
                            "data": encoded,
                        }),
                    );
                }
                Err(_) => break,
            }
        }

        let exit_code = pty_mgr_for_exit.try_wait(&pty_id_for_reader).ok().flatten();

        let _ = app_clone.emit(
            "terminal-exited",
            serde_json::json!({
                "session_id": pty_id_for_reader,
                "exit_code": exit_code,
            }),
        );
    });

    Ok(ResumeResult {
        pty_id,
        resumed,
    })
}
```

- [ ] **Step 2: Register the command**

Add `resume_session` to the `tauri::generate_handler!` macro:

```rust
search_session_history,
resume_session,
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add resume_session Tauri command with --resume fallback"
```

---

### Task 4: Frontend — Add `ResumeResult` type and `DateFilter` type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add types**

Add to the bottom of `src/lib/types.ts`:

```typescript
export type DateFilter = 'today' | 'this_week' | 'this_month';

export interface ResumeResult {
  pty_id: string;
  resumed: boolean;
}
```

- [ ] **Step 2: Verify type checking**

Run: `npm run check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add DateFilter and ResumeResult frontend types"
```

---

### Task 5: Frontend — Search bar and filter chips in History tab

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Replace `loadHistory` with `searchHistory` and add search/filter state**

In `Dashboard.svelte`, update the imports and state variables. Replace the `loadHistory` function and add search/filter state:

Replace this import line:
```typescript
import type { HistorySession } from '$lib/types';
```
with:
```typescript
import type { HistorySession, DateFilter } from '$lib/types';
```

Add these state variables after the existing `historyLoading` declaration:

```typescript
let historySearchQuery = $state('');
let historyDateFilter = $state<DateFilter | null>(null);
let historyHasMore = $state(true);
let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
```

Replace the `loadHistory` function with:

```typescript
async function searchHistory(append: boolean = false) {
    if (!append) {
        historyLoading = true;
        historyHasMore = true;
    }
    const offset = append ? historySessions.length : 0;
    try {
        const results = await invoke<HistorySession[]>('search_session_history', {
            query: historySearchQuery || null,
            dateFilter: historyDateFilter,
            limit: 50,
            offset,
        });
        if (append) {
            historySessions = [...historySessions, ...results];
        } else {
            historySessions = results;
        }
        historyHasMore = results.length === 50;
    } catch (e) {
        console.error('Failed to search history:', e);
    } finally {
        historyLoading = false;
    }
}
```

Update `switchTab` to call `searchHistory` instead of `loadHistory`:

```typescript
async function switchTab(tab: 'active' | 'history' | 'settings') {
    activeTab = tab;
    if (tab === 'history') {
        await searchHistory();
    }
}
```

Add debounced search handler:

```typescript
function handleSearchInput(value: string) {
    historySearchQuery = value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchHistory(), 300);
}

function toggleDateFilter(filter: DateFilter) {
    historyDateFilter = historyDateFilter === filter ? null : filter;
    searchHistory();
}
```

- [ ] **Step 2: Add search bar and filter chips to the History tab markup**

Replace the history tab section in the `session-list` div. Find this block:

```svelte
{:else if activeTab === 'history'}
    {#if historyLoading}
        <div class="empty"><span class="loading-text">Loading...</span></div>
    {:else if historySessions.length === 0}
```

Replace the entire `{:else if activeTab === 'history'}` block with:

```svelte
{:else if activeTab === 'history'}
    <div class="history-controls">
        <input
            class="history-search"
            type="text"
            placeholder="Search projects, branches..."
            value={historySearchQuery}
            oninput={(e) => handleSearchInput(e.currentTarget.value)}
        />
        <div class="filter-chips">
            <button
                class="chip"
                class:active={historyDateFilter === 'today'}
                onclick={() => toggleDateFilter('today')}
            >Today</button>
            <button
                class="chip"
                class:active={historyDateFilter === 'this_week'}
                onclick={() => toggleDateFilter('this_week')}
            >This Week</button>
            <button
                class="chip"
                class:active={historyDateFilter === 'this_month'}
                onclick={() => toggleDateFilter('this_month')}
            >This Month</button>
        </div>
    </div>
    {#if historyLoading}
        <div class="empty"><span class="loading-text">Loading...</span></div>
    {:else if historySessions.length === 0}
        <div class="empty"><span class="empty-text">No matching sessions</span></div>
    {:else}
        {#each historySessions as session (session.session_id)}
            <div
                class="sidebar-session"
                class:selected={selectedSessionId === session.session_id}
                onclick={() => { selectedSessionId = session.session_id; }}
                role="button"
                tabindex="0"
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (selectedSessionId = session.session_id)}
            >
                <SessionCard session={{
                    session_id: session.session_id,
                    cwd: session.cwd,
                    started_at: session.started_at,
                    git_branch: session.git_branch,
                    current_tool: null,
                    tool_history: session.tool_history.map(t => ({
                        tool_name: t.tool_name,
                        summary: t.summary,
                        timestamp: t.timestamp,
                    })),
                    active_subagents: 0,
                    pending_approval: false,
                    processing: false,
                    has_unread: false,
                    source: 'external',
                    display_name: null,
                    metadata: {},
                    shell_pty_id: null,
                }} onDismiss={handleDismiss} historyMode={true} endedAt={session.ended_at} compact />
            </div>
        {/each}
        {#if historyHasMore}
            <div class="load-sentinel" use:observeIntersection></div>
        {/if}
    {/if}
```

- [ ] **Step 3: Add IntersectionObserver action**

Add this Svelte action function inside the `<script>` block:

```typescript
function observeIntersection(node: HTMLElement) {
    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting && !historyLoading && historyHasMore) {
                searchHistory(true);
            }
        },
        { rootMargin: '100px' }
    );
    observer.observe(node);
    return {
        destroy() {
            observer.disconnect();
        },
    };
}
```

- [ ] **Step 4: Add CSS for search controls**

Add these styles to the `<style>` block in `Dashboard.svelte`:

```css
.history-controls {
    padding: 8px 8px 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.history-search {
    width: 100%;
    padding: 6px 10px;
    background: var(--tool-bg);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
}

.history-search:focus {
    border-color: var(--active);
}

.history-search::placeholder {
    color: var(--text-muted);
}

.filter-chips {
    display: flex;
    gap: 4px;
}

.chip {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 8px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.chip:hover {
    color: var(--text-secondary);
    border-color: var(--text-muted);
}

.chip.active {
    background: var(--active);
    color: var(--bg);
    border-color: var(--active);
}

.load-sentinel {
    height: 1px;
}
```

- [ ] **Step 5: Verify type checking and visual test**

Run: `npm run check`
Expected: passes.

Run: `npm run tauri dev`
Expected: History tab shows search bar and filter chips. Typing in search filters results after 300ms debounce. Clicking chips toggles date filter. Scrolling to the bottom loads more.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add search, filter chips, and infinite scroll to History tab"
```

---

### Task 6: Frontend — History detail view with action buttons

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add `selectedHistorySession` derived state and action handlers**

Add this derived state in the `<script>` block:

```typescript
let selectedHistorySession = $derived(
    historySessions.find(s => s.session_id === selectedSessionId) ?? null
);
```

Add action handlers:

```typescript
async function handleHistoryOpenTerminal(cwd: string) {
    try {
        const sessionId = await invoke<string>('spawn_terminal', { cwd });
        selectedSessionId = sessionId;
        activeTab = 'active';
    } catch (e) {
        console.error('Failed to spawn terminal:', e);
    }
}

async function handleResumeSession(sessionId: string, cwd: string) {
    try {
        const result = await invoke<{ pty_id: string; resumed: boolean }>('resume_session', {
            sessionId,
            cwd,
        });
        selectedSessionId = result.pty_id;
        activeTab = 'active';
    } catch (e) {
        console.error('Failed to resume session:', e);
    }
}
```

- [ ] **Step 2: Add history detail view to the main area**

In the main area section of the template, after the existing `{#if selectedSession?.source !== 'spawned'}` block and before the closing `</div>` of `.main-area`, the logic needs updating.

Replace the entire `.main-area` div content with:

```svelte
{#each sessionStore.sessions as session (session.session_id)}
    {#if session.source === 'spawned'}
        <div class="terminal-pane" class:active={selectedSessionId === session.session_id}>
            <Terminal ptyId={session.session_id} />
        </div>
    {/if}
{/each}

{#each sessionStore.sessions as session (session.session_id)}
    {#if session.shell_pty_id}
        <div class="terminal-pane" class:active={selectedSessionId === session.session_id && tabState[session.session_id] === 'terminal'}>
            <Terminal ptyId={session.shell_pty_id} />
        </div>
    {/if}
{/each}

{#if selectedSession?.source !== 'spawned'}
    {#if selectedSession}
        {#if selectedSession.shell_pty_id}
            <div class="tab-bar">
                <button
                    class="tab-btn"
                    class:active={tabState[selectedSession.session_id] !== 'terminal'}
                    onclick={() => { tabState[selectedSession.session_id] = 'detail'; }}
                >Detail</button>
                <button
                    class="tab-btn"
                    class:active={tabState[selectedSession.session_id] === 'terminal'}
                    onclick={() => { tabState[selectedSession.session_id] = 'terminal'; }}
                >Terminal</button>
            </div>
        {/if}
        {#if tabState[selectedSession.session_id] !== 'terminal'}
            <div class="detail-view">
                <SessionCard session={selectedSession} onDismiss={handleDismiss} onOpenShell={openShell} />
            </div>
        {/if}
    {:else if activeTab === 'history' && selectedHistorySession}
        <div class="detail-view">
            <div class="history-actions">
                <button class="action-btn" onclick={() => handleHistoryOpenTerminal(selectedHistorySession.cwd)}>
                    Open Terminal
                </button>
                <button class="action-btn action-btn-primary" onclick={() => handleResumeSession(selectedHistorySession.session_id, selectedHistorySession.cwd)}>
                    Resume Session
                </button>
            </div>
            <SessionCard session={{
                session_id: selectedHistorySession.session_id,
                cwd: selectedHistorySession.cwd,
                started_at: selectedHistorySession.started_at,
                git_branch: selectedHistorySession.git_branch,
                current_tool: null,
                tool_history: selectedHistorySession.tool_history.map(t => ({
                    tool_name: t.tool_name,
                    summary: t.summary,
                    timestamp: t.timestamp,
                })),
                active_subagents: 0,
                pending_approval: false,
                processing: false,
                has_unread: false,
                source: 'external',
                display_name: null,
                metadata: {},
                shell_pty_id: null,
            }} onDismiss={handleDismiss} historyMode={true} endedAt={selectedHistorySession.ended_at} />
        </div>
    {:else}
        <div class="no-selection">
            <span class="no-selection-text">Select a session</span>
        </div>
    {/if}
{/if}
```

- [ ] **Step 3: Add CSS for action buttons**

Add to the `<style>` block:

```css
.history-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.action-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 14px;
    transition: background 0.1s, color 0.1s;
}

.action-btn:hover {
    background: var(--tool-bg);
    color: var(--text-primary);
}

.action-btn-primary {
    background: var(--active);
    color: var(--bg);
    border-color: var(--active);
}

.action-btn-primary:hover {
    opacity: 0.9;
}
```

- [ ] **Step 4: Verify type checking and visual test**

Run: `npm run check`
Expected: passes.

Run: `npm run tauri dev`
Expected: Selecting a history session in the sidebar shows its detail in the main area with "Open Terminal" and "Resume Session" buttons at the top.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add history detail view with open terminal and resume actions"
```

---

### Task 7: Run all tests and verify

**Files:** none (verification only)

- [ ] **Step 1: Run backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass, including the new `search_history` tests.

- [ ] **Step 2: Run frontend type check**

Run: `npm run check`
Expected: passes with no errors.

- [ ] **Step 3: Run frontend tests**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`
Verify:
1. History tab shows search bar and filter chips
2. Typing "jackdaw" in search filters to matching sessions
3. Clicking "Today" chip shows only today's sessions
4. Clicking active chip again deselects it (shows all)
5. Scrolling past 50 results loads more
6. Clicking a history session shows detail view with action buttons
7. "Open Terminal" opens a terminal in the session's cwd and switches to Active tab
8. "Resume Session" attempts `claude --resume`, falls back to plain launch
9. Active tab still works normally — no regressions
