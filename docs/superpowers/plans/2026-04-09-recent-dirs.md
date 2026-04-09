# Recent Directories Implementation Plan

Spec: `docs/superpowers/specs/2026-04-09-recent-dirs-design.md`

## Task 1: Backend — RecentDir struct and file path

**Files:** `app.go`

Add `RecentDir` struct and `recentDirsPath` field to `App`:

```go
type RecentDir struct {
    Path     string    `json:"path"`
    LastUsed time.Time `json:"last_used"`
}
```

In `NewApp()`, set `recentDirsPath` to `filepath.Join(jackdawDir, "recent_dirs.json")`.

Add two methods:

**`GetRecentDirs() []RecentDir`** (exported, Wails-bound):
- Read file, unmarshal JSON array. Return empty slice on any error.

**`addRecentDir(path string)`** (unexported):
- Read existing list via `GetRecentDirs()`.
- Remove any existing entry with same `path`.
- Prepend new entry with `time.Now().UTC()`.
- Truncate to 20 entries.
- Marshal and write back to file.

Call `addRecentDir(workDir)` at the start of `CreateSession`, after `expandHome` but before creating the session.

**Verification:** `go test ./internal/...` (no new tests needed — this is simple file I/O with no testable logic beyond what's covered by manual testing).

## Task 2: Frontend — Recent dirs in NewSessionDialog

**Files:** `frontend/src/lib/NewSessionDialog.svelte`

- Import `GetRecentDirs` from wailsjs bindings.
- Add `recentDirs` state, populated via `onMount` calling `GetRecentDirs()`.
- Add `filteredDirs` derived state: when `workDir` is empty, show all; when `workDir` has text, filter to dirs whose path starts with `workDir` (case-insensitive). Hide when `workDir` exactly matches a recent dir path.
- Render the list between the directory input label and the git repo checkbox section.
- Each item is a button/clickable div with the path in monospace. On click, set `workDir` to that path (the existing `$effect` will trigger `checkGitRepo`).
- Style: compact list, `var(--text-secondary)` color, `var(--bg-tertiary)` hover background, max-height with overflow-y auto for scrollability.

## Task 3: Regenerate Wails bindings

Run `wails generate module` to generate the TS wrapper for `GetRecentDirs`.

## Verification

After all tasks:
- `go test ./internal/...`
- `cd frontend && npm run check`
