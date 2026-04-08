# Git Worktree Isolation Per Session

## Overview

Each session can optionally run in its own git worktree, giving parallel Claude Code agents isolated branches that don't clobber each other. Opt-in per session via a checkbox in the New Session dialog.

## Data Model

### SessionInfo / Manifest additions

```go
WorktreeEnabled bool   `json:"worktree_enabled"`
WorktreePath    string `json:"worktree_path,omitempty"`
OriginalDir     string `json:"original_dir,omitempty"`
BranchName      string `json:"branch_name,omitempty"`
BaseBranch      string `json:"base_branch,omitempty"`
```

- `WorkDir` continues to hold the actual directory the session runs in (worktree path for isolated sessions, user-provided path otherwise).
- `OriginalDir` preserves the source repo path (for future diff/merge features).
- `BaseBranch` stored at creation time (for future `git diff <baseBranch>...<branchName>`).

### Config addition

```go
WorktreeRoot string `json:"worktree_root,omitempty"`
```

Default: `<repo-parent>/.jackdaw-worktrees/<repo-name>/`. User-configurable in settings.

## `internal/worktree` Package

Thin wrapper around git CLI. Four functions:

### `Create(repoDir, worktreeRoot, branchName, baseBranch string) (string, error)`

1. Validate dir is a git repo (`git rev-parse --git-dir`)
2. If `baseBranch` empty, detect default branch (`git symbolic-ref refs/remotes/origin/HEAD`)
3. Determine worktree root — configured root or default sibling directory
4. `git worktree add -b <branchName> <worktreePath> <baseBranch>`
5. Return absolute worktree path

### `Remove(repoDir, worktreePath, branchName string) error`

1. `git -C <repoDir> worktree remove --force <worktreePath>`
2. `git -C <repoDir> branch -D <branchName>`

### `Status(worktreePath string) (WorktreeStatus, error)`

```go
type WorktreeStatus struct {
    Branch           string
    UncommittedFiles int
    UnpushedCommits  int
}
```

1. `git -C <path> status --porcelain` → count lines
2. `git -C <path> log @{upstream}..HEAD --oneline` → count lines (0 if no upstream)

### `IsGitRepo(dir string) bool`

`git -C <dir> rev-parse --git-dir` — returns true if exit code 0.

## Session Creation Flow

### Frontend (NewSessionDialog)

- After user enters/browses a directory, call `IsGitRepo(dir)` binding
- If git repo: show "Create isolated worktree" checkbox (unchecked by default)
- When checked: show branch name input, pre-filled with `jackdaw-<basename>-<short-timestamp>`
- User can edit or accept the default

### Backend (App.CreateSession)

Signature: `CreateSession(workDir string, worktreeEnabled bool, branchName string) → SessionInfo`

If `worktreeEnabled`:
1. `worktree.Create(workDir, configuredRoot, branchName, "")` — auto-detects base branch
2. Use returned worktree path as the relay's working directory
3. Populate `OriginalDir`, `WorktreePath`, `BranchName`, `BaseBranch` in SessionInfo and Manifest

If not: current behavior unchanged.

### Sidebar

Worktree sessions show a branch indicator next to the session name. Tooltip shows branch name.

## Session Cleanup Flow

When a worktree session ends:

1. Manager calls `worktree.Status(worktreePath)` for git state summary
2. Emits `worktree-cleanup-{id}` event to frontend with status
3. Frontend shows dialog:
   ```
   Session "my-project" ended.
   Branch: jackdaw-myproject-a3f8b1

   2 uncommitted files, 1 unpushed commit

   [Keep worktree]  [Delete worktree]
   ```
4. User response via `worktree-cleanup-response-{id}` event
5. Delete: `worktree.Remove()` + remove manifest
6. Keep: manifest stays (exited status), worktree persists on disk

### Recovery edge cases

- Worktree directory no longer exists on disk: clean up manifest, skip recovery
- Worktree still exists: recover normally, metadata preserved

## Error Handling

- **Branch name conflict:** If the branch already exists, `Create` returns an error. Frontend shows the error and lets the user pick a different name.
- **Not a git repo:** Worktree checkbox doesn't appear, so this path isn't reachable.
- **Worktree creation fails:** Session creation aborts, error shown to user. No partial state left behind.
- **Worktree removal fails** (e.g., directory already deleted externally): `Remove` treats missing worktree as success, still attempts branch deletion.

## Future-Proofing

`BaseBranch` and `OriginalDir` are stored now but unused until the diff viewer and merge workflow features are built. Those features will add UI and backend methods but won't need data model changes.
