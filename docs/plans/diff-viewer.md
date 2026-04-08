# Built-in Diff Viewer

## Overview

Show file changes per session without leaving the app. For worktree sessions, diff the worktree branch against its base branch. For non-worktree sessions, diff the working directory's current branch against its default branch. Opens in a pane alongside the terminal.

## Data Flow

```
User clicks "View Diff" on session in sidebar
  → Frontend calls GetSessionDiff(sessionID) binding
    → Go runs `git diff <baseBranch>..HEAD` + `git diff` (unstaged) in session's WorkDir
    → Returns structured diff data (list of file changes with hunks)
  → Frontend renders diff in a new pane (or replaces current pane content)
```

## Backend

### New Go functions in `internal/worktree/worktree.go`

```go
type FileDiff struct {
    Path      string     `json:"path"`
    OldPath   string     `json:"old_path,omitempty"` // for renames
    Status    string     `json:"status"`             // added, modified, deleted, renamed
    Hunks     []DiffHunk `json:"hunks"`
    Binary    bool       `json:"binary"`
}

type DiffHunk struct {
    Header  string     `json:"header"`   // @@ -1,3 +1,5 @@
    Lines   []DiffLine `json:"lines"`
}

type DiffLine struct {
    Type    string `json:"type"`    // context, add, delete
    Content string `json:"content"`
    OldLine int    `json:"old_line,omitempty"`
    NewLine int    `json:"new_line,omitempty"`
}

// Diff returns structured diff data for a working directory.
// If baseBranch is non-empty, includes committed changes (baseBranch..HEAD).
// Always includes uncommitted changes (staged + unstaged).
func Diff(workDir string, baseBranch string) ([]FileDiff, error)
```

Implementation: run `git diff --no-color -U3 <baseBranch>..HEAD` (committed) and `git diff --no-color -U3` (uncommitted), parse the unified diff output into the structured types. Combine results, deduplicating files that appear in both.

### New binding in `app.go`

```go
func (a *App) GetSessionDiff(sessionID string) ([]worktree.FileDiff, error)
```

Looks up the session, determines the appropriate base branch:
- Worktree session: uses stored `BaseBranch`
- Non-worktree session: runs `detectBaseBranch(workDir)` or falls back to diffing uncommitted only

### New binding: `GetFileDiff`

For viewing a single file's diff (lazy loading for large repos):

```go
func (a *App) GetFileDiff(sessionID string, filePath string) (*worktree.FileDiff, error)
```

Runs `git diff <baseBranch>..HEAD -- <filePath>` + `git diff -- <filePath>`.

## Frontend

### Layout extension

Add a new `PaneContent` variant:

```typescript
export type PaneContent =
  | { type: "session"; sessionId: string }
  | { type: "terminal"; id: string; workDir: string }
  | { type: "diff"; sessionId: string }
  | null;
```

Add `findLeafByDiff` and `collectDiffSessionIds` helpers to `layout.ts` for cleanup.

### New component: `DiffViewer.svelte`

Two-panel layout within the pane:
1. **File list** (left, ~200px): scrollable list of changed files with status indicators (green +, red -, blue M). Click to select.
2. **Diff content** (right, flex): renders the selected file's hunks.

Styling: monospace, dark theme, line-number gutters. Added lines green background, deleted lines red background, context lines default. Match the terminal aesthetic.

No external diff library — the backend returns pre-parsed structured data. The frontend just renders `DiffLine` objects with appropriate CSS classes.

### Update `PaneContainer.svelte`

```svelte
{#if content === null}
  <QuickPicker onSelect={onQuickPick} />
{:else if content.type === "diff"}
  <DiffViewer sessionId={content.sessionId} />
{:else if contentId}
  <Terminal ... />
{/if}
```

### Trigger: sidebar context action

Add a "View Diff" button to session items in the sidebar (next to edit/kill). Only visible for sessions with `status === "running"` or `status === "exited"`.

Clicking it:
1. If an adjacent pane is empty, open the diff there
2. Otherwise, split the current session's pane vertically and open the diff in the new right pane

### Keyboard shortcut

Add `session.viewDiff` action mapped to `Ctrl+Shift+D` (configurable via keybindings).

### Auto-refresh

When the diff pane is open and the session's terminal receives output, debounce-refresh the diff after 2 seconds of quiet. This keeps the diff view current as the agent works.

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `internal/worktree/worktree.go` | Add `Diff`, diff parsing functions |
| Create | `internal/worktree/diff.go` | Diff parsing logic (keep worktree.go focused) |
| Create | `internal/worktree/diff_test.go` | Tests for diff parsing |
| Modify | `app.go` | Add `GetSessionDiff`, `GetFileDiff` bindings |
| Modify | `frontend/src/lib/layout.ts` | Add `diff` PaneContent variant, helpers |
| Modify | `frontend/src/lib/types.ts` | Add `FileDiff`, `DiffHunk`, `DiffLine` types |
| Create | `frontend/src/lib/DiffViewer.svelte` | Diff rendering component |
| Modify | `frontend/src/lib/PaneContainer.svelte` | Route `diff` content to DiffViewer |
| Modify | `frontend/src/lib/Sidebar.svelte` | Add "View Diff" button |
| Modify | `frontend/src/App.svelte` | Wire diff action, keyboard shortcut, auto-refresh |

## Error Handling

- **Not a git repo:** "View Diff" button hidden. `GetSessionDiff` returns error if called anyway.
- **No changes:** DiffViewer shows "No changes" empty state.
- **Binary files:** Shown in file list with "binary" badge, no hunk content rendered.
- **Large diffs:** File list loads first (summary only from `git diff --stat`). Individual file diffs loaded on click via `GetFileDiff`. Cap hunk rendering at 5000 lines per file with a "Show all" button.
- **Git errors:** Surface error message in the diff pane, allow retry.

## Non-goals (deferred to merge/integration workflow)

- Staging/unstaging individual files or hunks
- Committing from the diff viewer
- Merging branches
- Three-way merge conflict resolution
- PR creation

These belong in the next roadmap item: "Merge/integration workflow."
