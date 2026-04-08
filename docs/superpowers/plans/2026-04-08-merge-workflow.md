# Merge Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a merge workflow that squash-merges (or regular merges) worktree branches back to the base branch, with auto-rebase, auto-generated commit messages, and auto-cleanup.

**Architecture:** New `worktree.Merge` function handles git operations (rebase, checkout, merge, commit). New `App.MergeSession` binding orchestrates merge + cleanup + session kill. Config gets `MergeMode` field. Frontend adds merge buttons to both `WorktreeCleanupDialog` and `DiffViewer`, wired through a shared `mergeSession` function in `App.svelte`.

**Tech Stack:** Go, Svelte 5 (runes), Wails v2

---

### Task 1: Add MergeMode to Config

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Add MergeMode field to Config struct**

In `internal/config/config.go`, add after `WorktreeRoot`:

```go
MergeMode string `json:"merge_mode,omitempty"` // "squash" (default) or "merge"
```

No test needed — the field is a plain string with no logic. `Defaults()` doesn't set it; empty string means "squash".

- [ ] **Step 2: Verify Go builds**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go build ./...`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add internal/config/config.go
git commit -m "feat: add MergeMode config field"
```

---

### Task 2: Implement commitMessageFromBranch Helper (TDD)

**Files:**
- Create: `internal/worktree/merge.go`
- Create: `internal/worktree/merge_test.go`

- [ ] **Step 1: Write failing tests for commitMessageFromBranch**

Create `internal/worktree/merge_test.go`:

```go
package worktree

import "testing"

func TestCommitMessageFromBranch(t *testing.T) {
	tests := []struct {
		branch string
		want   string
	}{
		{"jackdaw-add-merge-workflow", "Add merge workflow"},
		{"feat-dark-mode", "Dark mode"},
		{"fix-crash-on-startup", "Crash on startup"},
		{"add-tests", "Add tests"},
		{"my-feature", "My feature"},
		{"UPPER-case-MIX", "Upper case mix"},
		{"single", "Single"},
	}
	for _, tt := range tests {
		t.Run(tt.branch, func(t *testing.T) {
			got := commitMessageFromBranch(tt.branch)
			if got != tt.want {
				t.Errorf("commitMessageFromBranch(%q) = %q, want %q", tt.branch, got, tt.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/worktree/ -run TestCommitMessageFromBranch -v`
Expected: FAIL — function doesn't exist.

- [ ] **Step 3: Implement commitMessageFromBranch**

Create `internal/worktree/merge.go`:

```go
package worktree

import (
	"strings"
	"unicode"
)

// commitMessageFromBranch derives a commit message from a branch name.
// Strips common prefixes (jackdaw-, feat-, fix-), replaces hyphens with spaces,
// and capitalizes the first letter.
func commitMessageFromBranch(branch string) string {
	msg := branch
	for _, prefix := range []string{"jackdaw-", "feat-", "fix-"} {
		if strings.HasPrefix(msg, prefix) {
			msg = msg[len(prefix):]
			break
		}
	}
	msg = strings.ReplaceAll(msg, "-", " ")
	msg = strings.ToLower(msg)
	if len(msg) > 0 {
		runes := []rune(msg)
		runes[0] = unicode.ToUpper(runes[0])
		msg = string(runes)
	}
	return msg
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/worktree/ -run TestCommitMessageFromBranch -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/worktree/merge.go internal/worktree/merge_test.go
git commit -m "feat: add commitMessageFromBranch helper with tests"
```

---

### Task 3: Implement worktree.Merge Function (TDD)

**Files:**
- Modify: `internal/worktree/merge.go`
- Modify: `internal/worktree/merge_test.go`

The tests need to create real git repos with worktrees and branches. Use the same `initTestRepo` pattern from `diff_test.go` but note that `merge_test.go` is in the `worktree` package (not `worktree_test`), so it can use the internal `initTestRepo` helper from `diff_test.go` directly.

- [ ] **Step 1: Write failing test for squash merge happy path**

Add to `internal/worktree/merge_test.go`:

```go
import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", append([]string{"-C", dir}, args...)...)
	c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestMergeSquash(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	// Create worktree with a branch
	wtPath, err := Create(repoDir, wtRoot, "feat-hello-world", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Make a commit in the worktree
	os.WriteFile(filepath.Join(wtPath, "hello.txt"), []byte("hello"), 0644)
	gitRun(t, wtPath, "add", ".")
	gitRun(t, wtPath, "commit", "-m", "add hello")

	result, err := Merge(repoDir, wtPath, "feat-hello-world", "main", true)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.CommitMessage != "Hello world" {
		t.Errorf("CommitMessage = %q, want %q", result.CommitMessage, "Hello world")
	}

	// Verify we're on main and the file exists
	branch := gitRun(t, repoDir, "rev-parse", "--abbrev-ref", "HEAD")
	if branch != "main" {
		t.Errorf("expected to be on main, got %q", branch)
	}

	if _, err := os.Stat(filepath.Join(repoDir, "hello.txt")); err != nil {
		t.Errorf("hello.txt not found on main after merge: %v", err)
	}

	// Verify it was a squash (single commit, not a merge commit)
	log := gitRun(t, repoDir, "log", "--oneline")
	lines := strings.Split(log, "\n")
	if len(lines) != 2 { // init + squashed
		t.Errorf("expected 2 commits on main, got %d: %s", len(lines), log)
	}
}
```

- [ ] **Step 2: Write failing test for regular merge**

Add to `internal/worktree/merge_test.go`:

```go
func TestMergeRegular(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := Create(repoDir, wtRoot, "feat-regular", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	os.WriteFile(filepath.Join(wtPath, "file.txt"), []byte("content"), 0644)
	gitRun(t, wtPath, "add", ".")
	gitRun(t, wtPath, "commit", "-m", "add file")

	result, err := Merge(repoDir, wtPath, "feat-regular", "main", false)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}

	// Regular merge creates a merge commit
	log := gitRun(t, repoDir, "log", "--oneline")
	lines := strings.Split(log, "\n")
	if len(lines) < 3 { // init + feature commit + merge commit
		t.Errorf("expected at least 3 commits for regular merge, got %d: %s", len(lines), log)
	}
}
```

- [ ] **Step 3: Write failing test for rebase conflict**

Add to `internal/worktree/merge_test.go`:

```go
func TestMergeRebaseConflict(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := Create(repoDir, wtRoot, "feat-conflict", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Make conflicting changes on main
	os.WriteFile(filepath.Join(repoDir, "README"), []byte("changed on main"), 0644)
	gitRun(t, repoDir, "add", ".")
	gitRun(t, repoDir, "commit", "-m", "change readme on main")

	// Make conflicting changes in worktree
	os.WriteFile(filepath.Join(wtPath, "README"), []byte("changed in worktree"), 0644)
	gitRun(t, wtPath, "add", ".")
	gitRun(t, wtPath, "commit", "-m", "change readme in worktree")

	result, err := Merge(repoDir, wtPath, "feat-conflict", "main", true)
	if err != nil {
		t.Fatalf("Merge should return result with error, not Go error: %v", err)
	}
	if result.Success {
		t.Error("expected failure due to rebase conflict")
	}
	if result.Error == "" {
		t.Error("expected error message")
	}

	// Verify rebase was aborted — worktree should be clean
	status := gitRun(t, wtPath, "status", "--porcelain")
	if status != "" {
		t.Errorf("worktree should be clean after abort, got: %s", status)
	}
}
```

- [ ] **Step 4: Write failing test for uncommitted files**

Add to `internal/worktree/merge_test.go`:

```go
func TestMergeUncommittedFiles(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := Create(repoDir, wtRoot, "feat-dirty", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Leave uncommitted changes
	os.WriteFile(filepath.Join(wtPath, "dirty.txt"), []byte("uncommitted"), 0644)

	result, err := Merge(repoDir, wtPath, "feat-dirty", "main", true)
	if err != nil {
		t.Fatalf("Merge should return result with error, not Go error: %v", err)
	}
	if result.Success {
		t.Error("expected failure due to uncommitted files")
	}
	if !strings.Contains(result.Error, "uncommitted") {
		t.Errorf("error should mention uncommitted files, got: %s", result.Error)
	}
}
```

- [ ] **Step 5: Run tests to verify they all fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/worktree/ -run "TestMerge" -v`
Expected: FAIL — `Merge` function doesn't exist.

- [ ] **Step 6: Implement the Merge function**

Update `internal/worktree/merge.go` to add the `MergeResult` type and `Merge` function:

```go
import (
	"fmt"
	"os/exec"
	"strings"
	"unicode"
)

// MergeResult holds the outcome of a merge operation.
type MergeResult struct {
	Success       bool   `json:"success"`
	CommitMessage string `json:"commit_message,omitempty"`
	Error         string `json:"error,omitempty"`
}

// Merge merges a worktree branch into the base branch.
// If squash is true, performs a squash merge. Otherwise, a regular merge.
// Auto-rebases the worktree branch first. If rebase fails, aborts and returns error.
func Merge(repoDir, worktreePath, branchName, baseBranch string, squash bool) (*MergeResult, error) {
	git := func(dir string, args ...string) (string, error) {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		out, err := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}

	// Check for uncommitted files
	statusOut, err := git(worktreePath, "status", "--porcelain")
	if err != nil {
		return nil, fmt.Errorf("git status: %w", err)
	}
	if statusOut != "" {
		return &MergeResult{Error: "uncommitted files in worktree — commit or stash first"}, nil
	}

	// Rebase onto base branch
	if _, err := git(worktreePath, "rebase", baseBranch); err != nil {
		git(worktreePath, "rebase", "--abort") //nolint:errcheck
		return &MergeResult{Error: "rebase failed — resolve conflicts manually"}, nil
	}

	commitMsg := commitMessageFromBranch(branchName)

	// Checkout base branch in main repo
	if out, err := git(repoDir, "checkout", baseBranch); err != nil {
		return nil, fmt.Errorf("checkout %s: %s", baseBranch, out)
	}

	if squash {
		if out, err := git(repoDir, "merge", "--squash", branchName); err != nil {
			return nil, fmt.Errorf("merge --squash: %s", out)
		}
		if out, err := git(repoDir, "commit", "-m", commitMsg); err != nil {
			return nil, fmt.Errorf("commit: %s", out)
		}
	} else {
		if out, err := git(repoDir, "merge", branchName, "-m", commitMsg); err != nil {
			return nil, fmt.Errorf("merge: %s", out)
		}
	}

	return &MergeResult{Success: true, CommitMessage: commitMsg}, nil
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/worktree/ -run "TestMerge" -v`
Expected: All PASS.

- [ ] **Step 8: Run all worktree tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/worktree/ -v`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add internal/worktree/merge.go internal/worktree/merge_test.go
git commit -m "feat: implement worktree.Merge with rebase, squash, and conflict handling"
```

---

### Task 4: Add MergeSession Binding to App

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Add MergeSession method**

In `app.go`, add after the `CleanupWorktree` method:

```go
func (a *App) MergeSession(sessionID string) (*worktree.MergeResult, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled || info.WorktreePath == "" {
		return nil, fmt.Errorf("session %q is not a worktree session", sessionID)
	}

	cfg, _ := config.Load(a.configPath)
	squash := cfg.MergeMode != "merge"

	result, err := worktree.Merge(info.OriginalDir, info.WorktreePath, info.BranchName, info.BaseBranch, squash)
	if err != nil {
		return nil, err
	}
	if !result.Success {
		return result, nil
	}

	// Clean up worktree and branch — log errors but don't fail the merge
	if rmErr := worktree.Remove(info.OriginalDir, info.WorktreePath, info.BranchName); rmErr != nil {
		fmt.Fprintf(os.Stderr, "worktree cleanup after merge: %v\n", rmErr)
	}

	// Kill the session
	delete(a.patternMatchers, sessionID)
	delete(a.errorDetectors, sessionID)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(sessionID)
	}
	a.manager.Kill(sessionID) //nolint:errcheck

	return result, nil
}
```

- [ ] **Step 2: Regenerate Wails bindings**

Run: `cd /home/andy/dev/andybarilla/jackdaw && wails generate module`
Expected: `frontend/wailsjs/go/main/App.js` and `App.d.ts` regenerated with `MergeSession`.

- [ ] **Step 3: Verify the binding exists**

Check that `frontend/wailsjs/go/main/App.d.ts` contains `MergeSession`.

- [ ] **Step 4: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/... -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.go frontend/wailsjs/
git commit -m "feat: add MergeSession Wails binding"
```

---

### Task 5: Add MergeResult Type to Frontend

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add MergeResult interface**

In `frontend/src/lib/types.ts`, add after the `WorktreeStatus` interface:

```typescript
export interface MergeResult {
  success: boolean;
  commit_message?: string;
  error?: string;
}
```

- [ ] **Step 2: Run type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add MergeResult type"
```

---

### Task 6: Add Merge Button to WorktreeCleanupDialog

**Files:**
- Modify: `frontend/src/lib/WorktreeCleanupDialog.svelte`

- [ ] **Step 1: Add new props for merge**

Update the `Props` interface and destructuring:

```typescript
interface Props {
  sessionName: string;
  branchName: string;
  baseBranch: string;
  status: WorktreeStatus | null;
  onKeep: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

let { sessionName, branchName, baseBranch, status, onKeep, onMerge, onDelete }: Props = $props();
```

- [ ] **Step 2: Add merge button between Keep and Delete**

Replace the `<div class="actions">` block with:

```svelte
<div class="actions">
  <button class="keep" onclick={onKeep}>Keep worktree</button>
  <button
    class="merge"
    onclick={onMerge}
    disabled={status !== null && status.uncommitted_files > 0}
    title={status !== null && status.uncommitted_files > 0 ? "Commit or stash changes first" : `Squash merge into ${baseBranch}`}
  >Merge to {baseBranch}</button>
  <button class="delete" onclick={onDelete}>Delete worktree</button>
</div>
```

- [ ] **Step 3: Add merge button styles**

Add after the `.delete` style:

```css
.merge {
  background: var(--accent);
  color: var(--bg-primary);
  font-weight: 600;
}

.merge:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: Will fail because `App.svelte` doesn't pass the new props yet. That's expected — we'll fix it in Task 8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/WorktreeCleanupDialog.svelte
git commit -m "feat: add merge button to WorktreeCleanupDialog"
```

---

### Task 7: Add Merge Button to DiffViewer

**Files:**
- Modify: `frontend/src/lib/DiffViewer.svelte`

- [ ] **Step 1: Add merge props**

Update the `Props` interface:

```typescript
interface Props {
  sessionId: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  uncommittedFiles?: number;
  onMerge?: () => void;
}

let { sessionId, worktreeEnabled, baseBranch, uncommittedFiles, onMerge }: Props = $props();
```

- [ ] **Step 2: Add merge button to file list header**

Replace the `.file-list-header` div:

```svelte
<div class="file-list-header">
  <span>{files.length} file{files.length === 1 ? "" : "s"} changed</span>
  {#if worktreeEnabled && onMerge}
    <button
      class="merge-btn"
      onclick={onMerge}
      disabled={uncommittedFiles !== undefined && uncommittedFiles > 0}
      title={uncommittedFiles !== undefined && uncommittedFiles > 0 ? "Commit or stash changes first" : `Merge to ${baseBranch}`}
    >Merge</button>
  {/if}
</div>
```

- [ ] **Step 3: Update file-list-header styles and add merge button styles**

Replace the `.file-list-header` CSS:

```css
.file-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
}

.merge-btn {
  padding: 3px 8px;
  font-size: 11px;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

.merge-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/DiffViewer.svelte
git commit -m "feat: add merge button to DiffViewer"
```

---

### Task 8: Wire Merge Flow in App.svelte

**Files:**
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Import MergeSession binding**

Update the imports from `../../wailsjs/go/main/App` to include `MergeSession`:

```typescript
import {
  CreateSession,
  ListSessions,
  KillSession,
  RenameSession,
  CreateTerminal,
  KillTerminal,
  GetConfig,
  SetConfig,
  DismissNotification,
  GetWorktreeStatus,
  CleanupWorktree,
  MergeSession,
} from "../wailsjs/go/main/App";
```

- [ ] **Step 2: Add baseBranch to worktreeCleanup state**

Update the `worktreeCleanup` state type to include `baseBranch`:

```typescript
let worktreeCleanup = $state<{
  sessionId: string;
  sessionName: string;
  branchName: string;
  baseBranch: string;
  status: WorktreeStatus | null;
} | null>(null);
```

Update both places where `worktreeCleanup` is assigned (in the `sessions-updated` event handler) to include `baseBranch: s.base_branch || "main"`.

- [ ] **Step 3: Add mergeSession handler**

Add after `handleWorktreeDelete`:

```typescript
async function handleMergeSession(sessionId: string): Promise<void> {
  try {
    const result = await MergeSession(sessionId);
    if (result.success) {
      addNotification({
        sessionID: sessionId,
        sessionName: "",
        type: "session_exited",
        message: `Merged: ${result.commit_message}`,
        timestamp: new Date().toISOString(),
      });
      worktreeCleanup = null;
      // Close any diff pane for this session
      const diffPath = findLeafByDiffSessionId(layoutTree, sessionId);
      if (diffPath) collapsePane(diffPath);
    } else {
      addNotification({
        sessionID: sessionId,
        sessionName: "",
        type: "error_detected",
        message: `Merge failed: ${result.error}`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    addNotification({
      sessionID: sessionId,
      sessionName: "",
      type: "error_detected",
      message: `Merge error: ${e instanceof Error ? e.message : String(e)}`,
      timestamp: new Date().toISOString(),
    });
  }
}

async function handleWorktreeMerge(): Promise<void> {
  if (!worktreeCleanup) return;
  await handleMergeSession(worktreeCleanup.sessionId);
}
```

- [ ] **Step 4: Pass new props to WorktreeCleanupDialog**

Update the `WorktreeCleanupDialog` usage:

```svelte
{#if worktreeCleanup}
  <WorktreeCleanupDialog
    sessionName={worktreeCleanup.sessionName}
    branchName={worktreeCleanup.branchName}
    baseBranch={worktreeCleanup.baseBranch}
    status={worktreeCleanup.status}
    onKeep={handleWorktreeKeep}
    onMerge={handleWorktreeMerge}
    onDelete={handleWorktreeDelete}
  />
{/if}
```

- [ ] **Step 5: Pass merge props to DiffViewer via SplitPane**

The `DiffViewer` is rendered inside `SplitPane`. Find where `DiffViewer` is instantiated (likely in `SplitPane.svelte` or `PaneContainer.svelte`) and pass the new props. This requires:

1. Finding the session info for the diff's `sessionId`
2. Passing `worktreeEnabled`, `baseBranch`, `uncommittedFiles`, and `onMerge` props

Check `PaneContainer.svelte` for where `DiffViewer` is rendered and thread the props through. The `onMerge` callback should call `handleMergeSession(sessionId)`.

Note: This may require adding props to intermediate components (`SplitPane`, `PaneContainer`). The implementer should trace the component chain and add what's needed. The key data needed at `DiffViewer` is:
- `sessions` array (to look up session info)
- An `onMerge(sessionId)` callback
- Worktree status (uncommitted files count) — either fetched in DiffViewer or passed down

The simplest approach: pass an `onMerge` callback and the `sessions` array down through `SplitPane` → `PaneContainer` → `DiffViewer`. `DiffViewer` can look up the session from the array and call `GetWorktreeStatus` itself for the disabled state.

- [ ] **Step 6: Run type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: No errors.

- [ ] **Step 7: Run frontend build**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.svelte frontend/src/lib/WorktreeCleanupDialog.svelte frontend/src/lib/DiffViewer.svelte frontend/src/lib/PaneContainer.svelte frontend/src/lib/SplitPane.svelte
git commit -m "feat: wire merge flow through App.svelte to cleanup dialog and diff viewer"
```

---

### Task 9: Integration Verification

- [ ] **Step 1: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/... -v`
Expected: All tests PASS.

- [ ] **Step 2: Run frontend checks**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check && npm run build`
Expected: Both pass.

- [ ] **Step 3: Build the full app**

Run: `cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

Launch the app. Create a worktree session. Make changes and commit them in the session. Exit the session. Verify:
1. Cleanup dialog shows three buttons: Keep, Merge to main, Delete
2. Merge button is disabled when there are uncommitted files
3. Clicking Merge performs the squash merge and shows a toast
4. The worktree and branch are cleaned up
5. Opening the diff viewer for a worktree session shows the Merge button in the file list header
