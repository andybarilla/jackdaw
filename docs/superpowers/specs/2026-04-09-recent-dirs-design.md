# Recent Directories — Design Spec

## Overview
Track directories used to create sessions and surface them in the new session dialog for quick selection.

## Data Format
`~/.jackdaw/recent_dirs.json` — JSON array of objects, ordered most-recent-first, capped at 20 entries.
```json
[
  {"path": "/home/andy/dev/jackdaw", "last_used": "2026-04-09T10:30:00Z"},
  {"path": "/home/andy/dev/other-project", "last_used": "2026-04-01T08:00:00Z"}
]
```
Deduplication by `path`. When a directory is reused, it moves to the top with an updated timestamp.

## Backend
Add to `app.go` directly — no new package. Two methods:
- **`GetRecentDirs() []RecentDir`** — reads and returns the file contents. Returns empty slice if file missing/corrupt.
- **`addRecentDir(path string)`** — unexported, called internally from `CreateSession`. Reads file, upserts entry, truncates to 20, writes back.

`RecentDir` struct:
```go
type RecentDir struct {
    Path     string    `json:"path"`
    LastUsed time.Time `json:"last_used"`
}
```
File path derived from existing `jackdawDir` in `NewApp()`. Store as field on `App`.

## Frontend
Changes to `NewSessionDialog.svelte`:
- On mount, call `GetRecentDirs()` to fetch the list.
- Display recent dirs as clickable list below directory input (only when input is empty or matches prefix of a recent dir).
- Clicking a recent dir populates `workDir` input and triggers existing git repo check.
- Style as simple list with monospace paths, subtle hover highlight using existing CSS variables.

## Wails Bindings
One new exported method: `GetRecentDirs`. After adding, run `wails generate module`.
