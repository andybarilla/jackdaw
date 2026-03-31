# Session History Browser Design

## Problem

The History tab shows a flat list of 50 sessions with no search, filtering, pagination, or actions. Users can't find past sessions by project or date, and can't act on them once found.

## Goals

1. Search history by project name (cwd) and git branch
2. Filter by date range (today, this week, this month)
3. Infinite scroll pagination
4. Open a terminal in a past session's cwd
5. Resume a past Claude Code session (with fallback)

## Approach

Enhance the existing History tab within the sidebar/detail layout. No new pages or layout modes.

## Backend

### New DB function: `search_history`

Replaces `load_history` as the primary history query.

```rust
pub enum DateFilter {
    Today,
    ThisWeek,
    ThisMonth,
    Custom { start: String, end: String },
}

pub fn search_history(
    conn: &Connection,
    query: Option<&str>,
    date_filter: Option<DateFilter>,
    limit: u32,
    offset: u32,
) -> Vec<HistorySession>
```

- `query` matches against the last path segment of `cwd` (project name) and `git_branch` using SQL `LIKE '%term%'`
- `date_filter` constrains `ended_at` to a computed range
- `None, None` gives the same flat list as the current `load_history`
- Results ordered by `ended_at DESC`

### New Tauri commands

**`search_session_history`** — exposes `search_history` to the frontend. Parameters: `query: Option<String>`, `date_filter: Option<String>` (serialized as "today"/"this_week"/"this_month"), `limit: u32`, `offset: u32`. Returns `Vec<HistorySession>`.

**`resume_session`** — attempts to resume a Claude Code session. Parameters: `session_id: String`, `cwd: String`.
- Tries `claude --resume <session_id>` in a new PTY at `cwd`
- If `--resume` fails (unrecognized flag or non-zero exit), falls back to `spawn_terminal(cwd)`
- Returns `{ pty_id: String, resumed: bool }` so the frontend knows which path was taken and can inform the user if resume wasn't available

### Existing command changes

`get_session_history` can be removed or kept as a thin wrapper — `search_session_history` with no query/filter is equivalent.

## Frontend

### History tab sidebar layout

Three zones stacked vertically below the tab row:

1. **Search bar** — text input, debounced at 300ms. Placeholder: "Search projects, branches..."
2. **Filter chips** — horizontal row: `Today`, `This Week`, `This Month`. Single-select toggle (clicking active chip deselects it). No custom date range in v1.
3. **Results list** — infinite-scroll list of history session cards. Loads 50 per page. `IntersectionObserver` on a sentinel element at the bottom triggers next page load.

### Search/filter behavior

- Any change to search text or filter chips resets `offset` to 0 and replaces the results list
- Empty search + no filter shows all history (default)
- Debounce prevents excessive backend calls while typing

### History session cards (sidebar)

Reuse existing `SessionCard` with `historyMode` and `compact` props. Shows: project name (from cwd), git branch, relative ended_at time, tool count.

### Detail view (main area)

Selecting a history session shows its detail in the main area:
- Full tool history with timestamps
- Session metadata: cwd, branch, started_at, ended_at, duration
- **Action bar** at the top with two buttons:
  - **Open Terminal** — `invoke('spawn_terminal', { cwd })`, switches to Active tab
  - **Resume Session** — `invoke('resume_session', { sessionId, cwd })`, switches to Active tab

### Data flow

```
Search input / filter change
  → debounced invoke('search_session_history', { query, dateFilter, limit: 50, offset: 0 })
  → replaces historySessions, resets scroll

Scroll to bottom
  → IntersectionObserver fires
  → invoke('search_session_history', { ..., offset: current })
  → appends to historySessions

Select history session
  → detail view in main area (read-only + action bar)

"Open Terminal" click
  → invoke('spawn_terminal', { cwd })
  → switch to Active tab, select new session

"Resume Session" click
  → invoke('resume_session', { sessionId, cwd })
  → backend tries --resume, falls back to spawn_terminal
  → switch to Active tab, select new session
```

## What stays the same

- Active tab behavior unchanged
- In-memory session state unchanged
- Existing `SessionCard` component reused via `historyMode` prop
- `load_history` can remain for internal use but frontend calls `search_session_history`

## Testing

### Backend (cargo test)

- `search_history` with no filters returns all ended sessions newest first
- `search_history` with query matches cwd substring
- `search_history` with query matches git_branch
- `search_history` with date filter constrains to range
- `search_history` with query + date filter combines both
- `search_history` pagination with offset/limit
- `search_history` returns empty vec for no matches

### Frontend (vitest)

- Debounce fires after 300ms of no input
- Filter chips toggle correctly (single-select, re-click deselects)
- Infinite scroll triggers load at sentinel element
- Search/filter change resets offset to 0 and replaces results
- Action buttons invoke correct Tauri commands
