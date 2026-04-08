# Git Worktree Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each Claude Code session to optionally run in its own git worktree for branch isolation.

**Architecture:** New `internal/worktree` package wraps git CLI commands. Session creation flow gains an optional worktree step. Frontend's NewSessionDialog gets a worktree checkbox and branch name input. Cleanup dialog prompts on session exit.

**Tech Stack:** Go (git CLI exec), Svelte 5, Wails v2 event system

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `internal/worktree/worktree.go` | Git worktree operations (Create, Remove, Status, IsGitRepo) |
| Create | `internal/worktree/worktree_test.go` | Tests for worktree package |
| Modify | `internal/session/manager.go` | Add worktree fields to SessionInfo, worktree-aware Create/Kill/Recover |
| Modify | `internal/manifest/manifest.go` | Add worktree fields to Manifest struct |
| Modify | `internal/manifest/manifest_test.go` | Test worktree field persistence |
| Modify | `internal/config/config.go` | Add WorktreeRoot field |
| Modify | `internal/config/config_test.go` | Test WorktreeRoot config |
| Modify | `app.go` | Update CreateSession signature, add IsGitRepo/WorktreeStatus/CleanupWorktree bindings |
| Modify | `frontend/src/lib/types.ts` | Add worktree fields to SessionInfo, add WorktreeStatus type |
| Modify | `frontend/src/lib/NewSessionDialog.svelte` | Add worktree checkbox + branch name input |
| Create | `frontend/src/lib/WorktreeCleanupDialog.svelte` | Cleanup prompt on session exit |
| Modify | `frontend/src/lib/Sidebar.svelte` | Branch indicator for worktree sessions |
| Modify | `frontend/src/App.svelte` | Wire cleanup dialog, update CreateSession call |

---

### Task 1: `internal/worktree` — IsGitRepo

**Files:**
- Create: `internal/worktree/worktree.go`
- Create: `internal/worktree/worktree_test.go`

- [ ] **Step 1: Write failing tests for IsGitRepo**

```go
// internal/worktree/worktree_test.go
package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func initGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	cmd := exec.Command("git", "init", dir)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	// Configure user for commits
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", dir}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("config", "user.email", "test@test.com")
	run("config", "user.name", "Test")
	// Create initial commit so branches work
	os.WriteFile(filepath.Join(dir, "README"), []byte("init"), 0644)
	run("add", ".")
	run("commit", "-m", "init")
	return dir
}

func TestIsGitRepo(t *testing.T) {
	repo := initGitRepo(t)
	if !IsGitRepo(repo) {
		t.Error("expected true for git repo")
	}
}

func TestIsGitRepoNonRepo(t *testing.T) {
	dir := t.TempDir()
	if IsGitRepo(dir) {
		t.Error("expected false for non-repo directory")
	}
}

func TestIsGitRepoSubdir(t *testing.T) {
	repo := initGitRepo(t)
	sub := filepath.Join(repo, "subdir")
	os.MkdirAll(sub, 0755)
	if !IsGitRepo(sub) {
		t.Error("expected true for subdirectory of git repo")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/worktree/ -v -run TestIsGitRepo`
Expected: FAIL — package does not exist yet.

- [ ] **Step 3: Implement IsGitRepo**

```go
// internal/worktree/worktree.go
package worktree

import (
	"os/exec"
)

// IsGitRepo returns true if dir is inside a git repository.
func IsGitRepo(dir string) bool {
	cmd := exec.Command("git", "-C", dir, "rev-parse", "--git-dir")
	return cmd.Run() == nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/worktree/ -v -run TestIsGitRepo`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add internal/worktree/worktree.go internal/worktree/worktree_test.go
git commit -m "feat(worktree): add IsGitRepo function"
```

---

### Task 2: `internal/worktree` — Create

**Files:**
- Modify: `internal/worktree/worktree.go`
- Modify: `internal/worktree/worktree_test.go`

- [ ] **Step 1: Write failing tests for Create**

Add to `internal/worktree/worktree_test.go`:

```go
func TestCreate(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	wtPath, err := Create(repo, wtRoot, "test-branch", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Worktree directory should exist
	if _, err := os.Stat(wtPath); os.IsNotExist(err) {
		t.Error("worktree directory does not exist")
	}

	// Should be inside wtRoot
	rel, err := filepath.Rel(wtRoot, wtPath)
	if err != nil || rel != "test-branch" {
		t.Errorf("worktree path = %q, expected to be inside %q", wtPath, wtRoot)
	}

	// Branch should exist in the repo
	cmd := exec.Command("git", "-C", repo, "branch", "--list", "test-branch")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git branch --list: %v", err)
	}
	if len(out) == 0 {
		t.Error("branch 'test-branch' not found in repo")
	}
}

func TestCreateWithBaseBranch(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	// Create a second branch to use as base
	cmd := exec.Command("git", "-C", repo, "branch", "develop")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git branch: %v\n%s", err, out)
	}

	wtPath, err := Create(repo, wtRoot, "feature-x", "develop")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := os.Stat(wtPath); os.IsNotExist(err) {
		t.Error("worktree directory does not exist")
	}
}

func TestCreateBranchConflict(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	// Create branch first
	cmd := exec.Command("git", "-C", repo, "branch", "existing-branch")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git branch: %v\n%s", err, out)
	}

	_, err := Create(repo, wtRoot, "existing-branch", "")
	if err == nil {
		t.Error("expected error when branch already exists")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/worktree/ -v -run TestCreate`
Expected: FAIL — `Create` not defined.

- [ ] **Step 3: Implement Create**

Add to `internal/worktree/worktree.go`:

```go
import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// Create makes a new git worktree with a new branch in the given repo.
// worktreeRoot is the parent directory for worktrees. branchName is the new branch.
// baseBranch is the branch to base off; if empty, HEAD is used.
// Returns the absolute path to the created worktree.
func Create(repoDir, worktreeRoot, branchName, baseBranch string) (string, error) {
	if !IsGitRepo(repoDir) {
		return "", fmt.Errorf("%q is not a git repository", repoDir)
	}

	if baseBranch == "" {
		detected, err := detectDefaultBranch(repoDir)
		if err != nil {
			baseBranch = "HEAD"
		} else {
			baseBranch = detected
		}
	}

	wtPath := filepath.Join(worktreeRoot, branchName)

	cmd := exec.Command("git", "-C", repoDir, "worktree", "add", "-b", branchName, wtPath, baseBranch)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git worktree add: %w\n%s", err, out)
	}

	return wtPath, nil
}

func detectDefaultBranch(repoDir string) (string, error) {
	cmd := exec.Command("git", "-C", repoDir, "symbolic-ref", "refs/remotes/origin/HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	// Output like "refs/remotes/origin/main\n"
	ref := strings.TrimSpace(string(out))
	parts := strings.Split(ref, "/")
	return parts[len(parts)-1], nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/worktree/ -v -run TestCreate`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add internal/worktree/worktree.go internal/worktree/worktree_test.go
git commit -m "feat(worktree): add Create function"
```

---

### Task 3: `internal/worktree` — Status and Remove

**Files:**
- Modify: `internal/worktree/worktree.go`
- Modify: `internal/worktree/worktree_test.go`

- [ ] **Step 1: Write failing tests for Status**

Add to `internal/worktree/worktree_test.go`:

```go
func TestStatusClean(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	wtPath, err := Create(repo, wtRoot, "status-test", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	st, err := Status(wtPath)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.Branch != "status-test" {
		t.Errorf("Branch = %q, want %q", st.Branch, "status-test")
	}
	if st.UncommittedFiles != 0 {
		t.Errorf("UncommittedFiles = %d, want 0", st.UncommittedFiles)
	}
	if st.UnpushedCommits != 0 {
		t.Errorf("UnpushedCommits = %d, want 0", st.UnpushedCommits)
	}
}

func TestStatusDirty(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	wtPath, err := Create(repo, wtRoot, "dirty-test", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Create uncommitted files
	os.WriteFile(filepath.Join(wtPath, "new.txt"), []byte("new"), 0644)
	os.WriteFile(filepath.Join(wtPath, "another.txt"), []byte("another"), 0644)

	// Create an unpushed commit
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", wtPath}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	os.WriteFile(filepath.Join(wtPath, "committed.txt"), []byte("committed"), 0644)
	run("add", "committed.txt")
	run("commit", "-m", "a commit")

	st, err := Status(wtPath)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.UncommittedFiles != 2 {
		t.Errorf("UncommittedFiles = %d, want 2", st.UncommittedFiles)
	}
	// No upstream set, so unpushed should be 0
	if st.UnpushedCommits != 0 {
		t.Errorf("UnpushedCommits = %d, want 0 (no upstream)", st.UnpushedCommits)
	}
}
```

- [ ] **Step 2: Write failing tests for Remove**

Add to `internal/worktree/worktree_test.go`:

```go
func TestRemove(t *testing.T) {
	repo := initGitRepo(t)
	wtRoot := filepath.Join(t.TempDir(), ".jackdaw-worktrees", "testrepo")

	wtPath, err := Create(repo, wtRoot, "remove-test", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := Remove(repo, wtPath, "remove-test"); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	// Worktree directory should be gone
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Error("worktree directory should not exist after Remove")
	}

	// Branch should be gone
	cmd := exec.Command("git", "-C", repo, "branch", "--list", "remove-test")
	out, _ := cmd.Output()
	if len(strings.TrimSpace(string(out))) > 0 {
		t.Error("branch should be deleted after Remove")
	}
}

func TestRemoveMissingWorktree(t *testing.T) {
	repo := initGitRepo(t)

	// Remove a worktree that doesn't exist — should not error
	err := Remove(repo, "/nonexistent/path", "nonexistent-branch")
	if err != nil {
		t.Errorf("Remove of missing worktree should not error, got: %v", err)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `go test ./internal/worktree/ -v -run "TestStatus|TestRemove"`
Expected: FAIL — `Status`, `WorktreeStatus`, `Remove` not defined.

- [ ] **Step 4: Implement Status and Remove**

Add to `internal/worktree/worktree.go`:

```go
// WorktreeStatus holds git state information for a worktree.
type WorktreeStatus struct {
	Branch           string
	UncommittedFiles int
	UnpushedCommits  int
}

// Status returns the git status of a worktree directory.
func Status(worktreePath string) (WorktreeStatus, error) {
	var st WorktreeStatus

	// Get current branch
	cmd := exec.Command("git", "-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return st, fmt.Errorf("get branch: %w", err)
	}
	st.Branch = strings.TrimSpace(string(out))

	// Count uncommitted files
	cmd = exec.Command("git", "-C", worktreePath, "status", "--porcelain")
	out, err = cmd.Output()
	if err != nil {
		return st, fmt.Errorf("git status: %w", err)
	}
	if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
		st.UncommittedFiles = len(strings.Split(trimmed, "\n"))
	}

	// Count unpushed commits (only if upstream exists)
	cmd = exec.Command("git", "-C", worktreePath, "log", "@{upstream}..HEAD", "--oneline")
	out, err = cmd.Output()
	if err == nil {
		if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
			st.UnpushedCommits = len(strings.Split(trimmed, "\n"))
		}
	}
	// If no upstream, leave UnpushedCommits as 0

	return st, nil
}

// Remove deletes a worktree and its branch. If the worktree directory doesn't
// exist, it cleans up the git worktree record and deletes the branch.
func Remove(repoDir, worktreePath, branchName string) error {
	// Remove worktree (--force handles dirty worktrees)
	cmd := exec.Command("git", "-C", repoDir, "worktree", "remove", "--force", worktreePath)
	if out, err := cmd.CombinedOutput(); err != nil {
		// If worktree is already gone, prune and continue
		pruneCmd := exec.Command("git", "-C", repoDir, "worktree", "prune")
		pruneCmd.Run()
		// Check if the directory is actually gone — if so, not an error
		if _, statErr := os.Stat(worktreePath); !os.IsNotExist(statErr) {
			return fmt.Errorf("git worktree remove: %w\n%s", err, out)
		}
	}

	// Delete the branch (best-effort)
	cmd = exec.Command("git", "-C", repoDir, "branch", "-D", branchName)
	cmd.Run() // ignore error — branch may already be deleted

	return nil
}
```

Update the imports at the top of `worktree.go` to include `"os"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/worktree/ -v -run "TestStatus|TestRemove"`
Expected: PASS (all four tests)

- [ ] **Step 6: Run all worktree tests**

Run: `go test ./internal/worktree/ -v`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add internal/worktree/worktree.go internal/worktree/worktree_test.go
git commit -m "feat(worktree): add Status and Remove functions"
```

---

### Task 4: Data model — Manifest and SessionInfo worktree fields

**Files:**
- Modify: `internal/manifest/manifest.go:13-23`
- Modify: `internal/manifest/manifest_test.go`
- Modify: `internal/session/manager.go:22-31`

- [ ] **Step 1: Write failing test for manifest worktree fields**

Add to `internal/manifest/manifest_test.go`:

```go
func TestWriteAndReadWithWorktreeFields(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID:       "wt-1",
		PID:             12345,
		Command:         "claude",
		WorkDir:         "/tmp/worktrees/my-branch",
		SocketPath:      "/tmp/jackdaw/wt-1.sock",
		StartedAt:       time.Date(2026, 4, 8, 12, 0, 0, 0, time.UTC),
		Name:            "my-project",
		WorktreeEnabled: true,
		WorktreePath:    "/tmp/worktrees/my-branch",
		OriginalDir:     "/home/user/my-project",
		BranchName:      "jackdaw-my-project-a3f8b1",
		BaseBranch:      "main",
	}

	path := filepath.Join(dir, "wt-1.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !got.WorktreeEnabled {
		t.Error("WorktreeEnabled = false, want true")
	}
	if got.WorktreePath != "/tmp/worktrees/my-branch" {
		t.Errorf("WorktreePath = %q, want %q", got.WorktreePath, "/tmp/worktrees/my-branch")
	}
	if got.OriginalDir != "/home/user/my-project" {
		t.Errorf("OriginalDir = %q, want %q", got.OriginalDir, "/home/user/my-project")
	}
	if got.BranchName != "jackdaw-my-project-a3f8b1" {
		t.Errorf("BranchName = %q, want %q", got.BranchName, "jackdaw-my-project-a3f8b1")
	}
	if got.BaseBranch != "main" {
		t.Errorf("BaseBranch = %q, want %q", got.BaseBranch, "main")
	}
}

func TestReadLegacyManifestWithoutWorktreeFields(t *testing.T) {
	dir := t.TempDir()
	legacy := `{"session_id":"old-2","pid":100,"command":"claude","work_dir":"/tmp/foo","started_at":"2026-04-06T12:00:00Z"}`
	path := filepath.Join(dir, "old-2.json")
	os.WriteFile(path, []byte(legacy), 0600)

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.WorktreeEnabled {
		t.Error("WorktreeEnabled should be false for legacy manifest")
	}
	if got.WorktreePath != "" {
		t.Errorf("WorktreePath should be empty for legacy manifest, got %q", got.WorktreePath)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/manifest/ -v -run "TestWriteAndReadWithWorktreeFields|TestReadLegacyManifestWithoutWorktreeFields"`
Expected: FAIL — fields don't exist on Manifest struct.

- [ ] **Step 3: Add worktree fields to Manifest**

In `internal/manifest/manifest.go`, update the Manifest struct:

```go
type Manifest struct {
	SessionID   string    `json:"session_id"`
	PID         int       `json:"pid"`
	Command     string    `json:"command"`
	Args        []string  `json:"args"`
	WorkDir     string    `json:"work_dir"`
	SocketPath  string    `json:"socket_path"`
	StartedAt   time.Time `json:"started_at"`
	Name        string    `json:"name,omitempty"`
	HistoryPath string    `json:"history_path,omitempty"`
	WorktreeEnabled bool   `json:"worktree_enabled,omitempty"`
	WorktreePath    string `json:"worktree_path,omitempty"`
	OriginalDir     string `json:"original_dir,omitempty"`
	BranchName      string `json:"branch_name,omitempty"`
	BaseBranch      string `json:"base_branch,omitempty"`
}
```

- [ ] **Step 4: Add worktree fields to SessionInfo**

In `internal/session/manager.go`, update SessionInfo:

```go
type SessionInfo struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	WorkDir         string    `json:"work_dir"`
	Command         string    `json:"command"`
	Status          Status    `json:"status"`
	PID             int       `json:"pid"`
	StartedAt       time.Time `json:"started_at"`
	ExitCode        int       `json:"exit_code"`
	WorktreeEnabled bool      `json:"worktree_enabled,omitempty"`
	WorktreePath    string    `json:"worktree_path,omitempty"`
	OriginalDir     string    `json:"original_dir,omitempty"`
	BranchName      string    `json:"branch_name,omitempty"`
	BaseBranch      string    `json:"base_branch,omitempty"`
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/manifest/ -v -run "TestWriteAndReadWithWorktreeFields|TestReadLegacyManifestWithoutWorktreeFields"`
Expected: PASS

Run: `go test ./internal/... -v`
Expected: PASS (all existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add internal/manifest/manifest.go internal/manifest/manifest_test.go internal/session/manager.go
git commit -m "feat(worktree): add worktree fields to Manifest and SessionInfo"
```

---

### Task 5: Config — WorktreeRoot setting

**Files:**
- Modify: `internal/config/config.go:10-19`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Write failing test**

Add to `internal/config/config_test.go`:

```go
func TestWorktreeRootConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := Defaults()
	cfg.WorktreeRoot = "/custom/worktree/root"
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.WorktreeRoot != "/custom/worktree/root" {
		t.Errorf("WorktreeRoot = %q, want %q", loaded.WorktreeRoot, "/custom/worktree/root")
	}
}

func TestWorktreeRootDefaultEmpty(t *testing.T) {
	cfg := Defaults()
	if cfg.WorktreeRoot != "" {
		t.Errorf("WorktreeRoot default = %q, want empty", cfg.WorktreeRoot)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/config/ -v -run TestWorktreeRoot`
Expected: FAIL — `WorktreeRoot` field doesn't exist.

- [ ] **Step 3: Add WorktreeRoot to Config**

In `internal/config/config.go`, add field to Config struct:

```go
type Config struct {
	Theme                string            `json:"theme"`
	Keybindings          map[string]string `json:"keybindings"`
	Layout               json.RawMessage   `json:"layout,omitempty"`
	HistoryMaxBytes      int               `json:"history_max_bytes,omitempty"`
	NotificationsEnabled bool              `json:"notifications_enabled"`
	DesktopNotifications bool              `json:"desktop_notifications"`
	ToastDurationSeconds int               `json:"toast_duration_seconds,omitempty"`
	ErrorDetectionEnabled bool             `json:"error_detection_enabled"`
	WorktreeRoot         string            `json:"worktree_root,omitempty"`
}
```

No change to `Defaults()` — empty string means "use sibling directory default".

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/config/ -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(worktree): add WorktreeRoot config field"
```

---

### Task 6: Backend — Worktree-aware session creation

**Files:**
- Modify: `app.go:191-227`
- Modify: `internal/session/manager.go:96-153`

- [ ] **Step 1: Update Manager.Create to accept worktree options**

In `internal/session/manager.go`, add a `WorktreeOptions` type and update `Create`:

```go
// WorktreeOptions configures optional worktree isolation for a session.
type WorktreeOptions struct {
	Enabled      bool
	BranchName   string
	WorktreeRoot string // empty = use default sibling directory
}
```

Update `Manager.Create` signature and add worktree logic at the top:

```go
func (m *Manager) Create(id string, workDir string, command string, args []string, env []string, onOutput func([]byte), wtOpts WorktreeOptions) (*SessionInfo, error) {
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}

	var wtPath, originalDir, branchName, baseBranch string

	if wtOpts.Enabled {
		wtRoot := wtOpts.WorktreeRoot
		if wtRoot == "" {
			// Default: sibling .jackdaw-worktrees/<repo-basename>/
			repoBase := filepath.Base(workDir)
			wtRoot = filepath.Join(filepath.Dir(workDir), ".jackdaw-worktrees", repoBase)
		}

		detected, err := worktree.Create(workDir, wtRoot, wtOpts.BranchName, "")
		if err != nil {
			return nil, fmt.Errorf("create worktree: %w", err)
		}
		originalDir = workDir
		wtPath = detected
		branchName = wtOpts.BranchName

		// Detect base branch for future diff/merge
		baseBranch = detectBaseBranch(workDir)

		workDir = wtPath // relay runs in the worktree
	}

	historyPath := filepath.Join(m.historyDir, id+".log")

	s, err := New(id, workDir, command, args, m.socketDir, historyPath, m.historyMaxBytes, env)
	if err != nil {
		// Clean up worktree if session creation fails
		if wtOpts.Enabled && wtPath != "" {
			worktree.Remove(originalDir, wtPath, branchName)
		}
		return nil, err
	}

	name := m.generateName(workDir)

	info := &SessionInfo{
		ID:              id,
		Name:            name,
		WorkDir:         workDir,
		Command:         command,
		Status:          StatusRunning,
		PID:             s.PID(),
		StartedAt:       s.StartedAt,
		WorktreeEnabled: wtOpts.Enabled,
		WorktreePath:    wtPath,
		OriginalDir:     originalDir,
		BranchName:      branchName,
		BaseBranch:      baseBranch,
	}

	s.OnExit = func(exitCode int) {
		m.mu.Lock()
		if si, ok := m.sessionInfo[id]; ok {
			si.Status = StatusExited
			si.ExitCode = exitCode
		}
		m.mu.Unlock()
		m.notifyUpdate()
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.sessionInfo[id] = info
	m.mu.Unlock()

	mf := &manifest.Manifest{
		SessionID:       id,
		PID:             s.PID(),
		Command:         command,
		Args:            args,
		WorkDir:         workDir,
		SocketPath:      s.SocketPath,
		StartedAt:       s.StartedAt,
		Name:            name,
		HistoryPath:     historyPath,
		WorktreeEnabled: wtOpts.Enabled,
		WorktreePath:    wtPath,
		OriginalDir:     originalDir,
		BranchName:      branchName,
		BaseBranch:      baseBranch,
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	if onOutput != nil {
		s.OnOutput = onOutput
	}
	m.notifyUpdate()

	return info, nil
}
```

Add the import for the worktree package and the helper:

```go
import (
	"github.com/andybarilla/jackdaw/internal/worktree"
)

func detectBaseBranch(repoDir string) string {
	cmd := exec.Command("git", "-C", repoDir, "symbolic-ref", "refs/remotes/origin/HEAD")
	out, err := cmd.Output()
	if err != nil {
		// Fallback: try rev-parse HEAD
		cmd2 := exec.Command("git", "-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD")
		out2, err2 := cmd2.Output()
		if err2 != nil {
			return "main"
		}
		return strings.TrimSpace(string(out2))
	}
	ref := strings.TrimSpace(string(out))
	parts := strings.Split(ref, "/")
	return parts[len(parts)-1]
}
```

Add `"os/exec"` to the imports of `manager.go`.

- [ ] **Step 2: Update App.CreateSession in app.go**

Update the signature and pass worktree options:

```go
func (a *App) CreateSession(workDir string, worktreeEnabled bool, branchName string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/%s", a.hookListener.Addr(), id)
		env = append(env, session.BuildClaudeHookEnv(hookURL))
	}

	cfg, _ := config.Load(a.configPath)

	wtOpts := session.WorktreeOptions{
		Enabled:      worktreeEnabled,
		BranchName:   branchName,
		WorktreeRoot: cfg.WorktreeRoot,
	}

	info, err := a.manager.Create(id, workDir, "claude", nil, env, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		if pm, ok := a.patternMatchers[id]; ok {
			if a.hookListener == nil || !a.hookListener.HasSession(id) {
				pm.Feed(data)
			}
		}
		if ed, ok := a.errorDetectors[id]; ok {
			ed.Feed(data)
		}
	}, wtOpts)
	if err != nil {
		return nil, err
	}

	a.patternMatchers[info.ID] = notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)
	if a.errorDetectionEnabled {
		a.errorDetectors[info.ID] = notification.NewErrorDetector(a.notifSvc, info.ID, info.Name)
	}

	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)
	return info, nil
}
```

- [ ] **Step 3: Add IsGitRepo binding to app.go**

```go
func (a *App) IsGitRepo(dir string) bool {
	dir = expandHome(dir)
	return worktree.IsGitRepo(dir)
}
```

Add `"github.com/andybarilla/jackdaw/internal/worktree"` to app.go imports.

- [ ] **Step 4: Run all Go tests**

Run: `go test ./internal/...`
Expected: PASS — existing tests may need the new `wtOpts` parameter added. If `manager_test.go` tests call `Create` with the old signature, they'll fail at compile time. The fix is to pass `session.WorktreeOptions{}` (zero value, worktree disabled) as the last argument to each `Create` call in existing tests. There is currently no direct `Create` call in `manager_test.go` tests (they build sessions manually), so this should compile clean.

- [ ] **Step 5: Commit**

```bash
git add app.go internal/session/manager.go
git commit -m "feat(worktree): wire worktree creation into session flow"
```

---

### Task 7: Backend — Worktree cleanup and status bindings

**Files:**
- Modify: `app.go`
- Modify: `internal/session/manager.go`

- [ ] **Step 1: Add GetWorktreeStatus binding**

Add to `app.go`:

```go
// WorktreeStatusResult is the JSON-friendly status returned to frontend.
type WorktreeStatusResult struct {
	Branch           string `json:"branch"`
	UncommittedFiles int    `json:"uncommitted_files"`
	UnpushedCommits  int    `json:"unpushed_commits"`
}

func (a *App) GetWorktreeStatus(sessionID string) (*WorktreeStatusResult, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled || info.WorktreePath == "" {
		return nil, fmt.Errorf("session %q is not a worktree session", sessionID)
	}

	st, err := worktree.Status(info.WorktreePath)
	if err != nil {
		return nil, err
	}
	return &WorktreeStatusResult{
		Branch:           st.Branch,
		UncommittedFiles: st.UncommittedFiles,
		UnpushedCommits:  st.UnpushedCommits,
	}, nil
}
```

- [ ] **Step 2: Add CleanupWorktree binding**

Add to `app.go`:

```go
func (a *App) CleanupWorktree(sessionID string, deleteWorktree bool) error {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled {
		return nil
	}

	if deleteWorktree {
		if err := worktree.Remove(info.OriginalDir, info.WorktreePath, info.BranchName); err != nil {
			return fmt.Errorf("remove worktree: %w", err)
		}
	}

	return a.manager.Kill(sessionID)
}
```

- [ ] **Step 3: Add Manager.GetSessionInfo helper**

Add to `internal/session/manager.go`:

```go
func (m *Manager) GetSessionInfo(id string) *SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if info, ok := m.sessionInfo[id]; ok {
		cp := *info
		return &cp
	}
	return nil
}
```

- [ ] **Step 4: Update Recover to handle worktree sessions**

In `internal/session/manager.go`, update the `Recover` method. In the loop over manifests, after `if !manifest.IsProcessAlive(mf.PID)`, add a worktree directory check:

```go
// For worktree sessions, check that the worktree directory still exists
if mf.WorktreeEnabled && mf.WorktreePath != "" {
	if _, err := os.Stat(mf.WorktreePath); os.IsNotExist(err) {
		if mf.HistoryPath != "" {
			os.Remove(mf.HistoryPath)
		}
		manifest.Remove(path)
		continue
	}
}
```

Add this check right after the alive PID check (before the `Reconnect` call).

Also populate worktree fields when building SessionInfo in Recover:

```go
info := &SessionInfo{
	ID:              mf.SessionID,
	Name:            name,
	WorkDir:         mf.WorkDir,
	Command:         mf.Command,
	Status:          StatusRunning,
	PID:             mf.PID,
	StartedAt:       mf.StartedAt,
	WorktreeEnabled: mf.WorktreeEnabled,
	WorktreePath:    mf.WorktreePath,
	OriginalDir:     mf.OriginalDir,
	BranchName:      mf.BranchName,
	BaseBranch:      mf.BaseBranch,
}
```

- [ ] **Step 5: Run all Go tests**

Run: `go test ./internal/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app.go internal/session/manager.go
git commit -m "feat(worktree): add cleanup/status bindings and recovery support"
```

---

### Task 8: Frontend — Types and NewSessionDialog

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/NewSessionDialog.svelte`

- [ ] **Step 1: Update TypeScript types**

In `frontend/src/lib/types.ts`, add worktree fields to SessionInfo and add WorktreeStatus:

```ts
export interface SessionInfo {
  id: string;
  name: string;
  work_dir: string;
  command: string;
  status: "running" | "stopped" | "exited";
  pid: number;
  started_at: string;
  exit_code: number;
  worktree_enabled?: boolean;
  worktree_path?: string;
  original_dir?: string;
  branch_name?: string;
  base_branch?: string;
}

export interface WorktreeStatus {
  branch: string;
  uncommitted_files: number;
  unpushed_commits: number;
}
```

- [ ] **Step 2: Update NewSessionDialog with worktree controls**

Replace `frontend/src/lib/NewSessionDialog.svelte`:

```svelte
<script lang="ts">
  import { IsGitRepo, PickDirectory } from "../../wailsjs/go/main/App";

  interface Props {
    onSubmit: (workDir: string, worktreeEnabled: boolean, branchName: string) => void;
    onCancel: () => void;
  }

  let { onSubmit, onCancel }: Props = $props();
  let workDir = $state("");
  let isGitRepo = $state(false);
  let worktreeEnabled = $state(false);
  let branchName = $state("");
  let checkingGit = $state(false);
  let error = $state("");

  function generateBranchName(dir: string): string {
    const basename = dir.split("/").pop() || "project";
    const short = Date.now().toString(36).slice(-6);
    return `jackdaw-${basename}-${short}`;
  }

  async function checkGitRepo(dir: string): Promise<void> {
    if (!dir.trim()) {
      isGitRepo = false;
      return;
    }
    checkingGit = true;
    try {
      isGitRepo = await IsGitRepo(dir);
      if (isGitRepo && !branchName) {
        branchName = generateBranchName(dir);
      }
    } catch {
      isGitRepo = false;
    }
    checkingGit = false;
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    const trimmed = workDir.trim();
    if (trimmed) {
      onSubmit(trimmed, worktreeEnabled, branchName.trim());
    }
  }

  async function handleBrowse() {
    const dir = await PickDirectory();
    if (dir) {
      workDir = dir;
      await checkGitRepo(dir);
    }
  }

  // Check git repo when workDir changes via typing
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (checkTimer) clearTimeout(checkTimer);
    const dir = workDir;
    checkTimer = setTimeout(() => checkGitRepo(dir), 300);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onCancel} onkeydown={(e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }} role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <form
    class="dialog"
    onsubmit={handleSubmit}
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <h3>New Claude Code Session</h3>
    <label>
      Working Directory
      <div class="input-row">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={workDir}
          placeholder="/path/to/project"
          autofocus
        />
        <button type="button" class="browse" onclick={handleBrowse}>Browse</button>
      </div>
    </label>

    {#if isGitRepo}
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={worktreeEnabled} />
        Create isolated worktree
      </label>

      {#if worktreeEnabled}
        <label>
          Branch name
          <input
            type="text"
            bind:value={branchName}
            placeholder="jackdaw-project-abc123"
            class="branch-input"
          />
        </label>
      {/if}
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel}>Cancel</button>
      <button type="submit" class="submit" disabled={!workDir.trim() || (worktreeEnabled && !branchName.trim())}>
        Launch
      </button>
    </div>
  </form>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    width: 400px;
  }

  h3 {
    margin-bottom: 16px;
    font-size: 16px;
  }

  label {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  .input-row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  input[type="text"] {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 14px;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .branch-input {
    width: 100%;
    margin-top: 6px;
  }

  .browse {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .error {
    color: var(--error);
    font-size: 12px;
    margin-bottom: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }

  .cancel {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .submit {
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 600;
  }

  .submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: May fail because Wails bindings haven't been regenerated yet. Note any errors for the next task.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/NewSessionDialog.svelte
git commit -m "feat(worktree): add worktree controls to NewSessionDialog"
```

---

### Task 9: Frontend — App.svelte wiring

**Files:**
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Update handleNewSession to pass worktree params**

In `App.svelte`, update the `handleNewSession` function signature and call:

```ts
async function handleNewSession(workDir: string, worktreeEnabled: boolean, branchName: string): Promise<void> {
  showNewDialog = false;
  const info = await CreateSession(workDir, worktreeEnabled, branchName);

  if (pendingQuickPickPath) {
    layoutTree = setLeafContent(layoutTree, asPath(pendingQuickPickPath), {
      type: "session",
      sessionId: info.id,
    });
    focusedPath = pendingQuickPickPath;
    pendingQuickPickPath = null;
  } else {
    const content = getFocusedContent();
    if (content === null) {
      layoutTree = setLeafContent(layoutTree, asPath(focusedPath), {
        type: "session",
        sessionId: info.id,
      });
    }
  }
  requestAnimationFrame(() => terminalApis[info.id]?.focus());
}
```

- [ ] **Step 2: Regenerate Wails bindings**

Run: `wails generate module`

This regenerates `frontend/wailsjs/go/main/App.js` with the new `IsGitRepo`, `GetWorktreeStatus`, and `CleanupWorktree` methods, and updates `CreateSession` to accept the new parameters.

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.svelte frontend/wailsjs/
git commit -m "feat(worktree): wire worktree params through App.svelte"
```

---

### Task 10: Frontend — WorktreeCleanupDialog and session exit handling

**Files:**
- Create: `frontend/src/lib/WorktreeCleanupDialog.svelte`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Create WorktreeCleanupDialog component**

```svelte
<!-- frontend/src/lib/WorktreeCleanupDialog.svelte -->
<script lang="ts">
  import type { WorktreeStatus } from "./types";

  interface Props {
    sessionName: string;
    branchName: string;
    status: WorktreeStatus | null;
    onKeep: () => void;
    onDelete: () => void;
  }

  let { sessionName, branchName, status, onKeep, onDelete }: Props = $props();
</script>

<div class="overlay" role="presentation">
  <div class="dialog">
    <h3>Session ended</h3>
    <p class="session-name">{sessionName}</p>
    <p class="branch">Branch: <code>{branchName}</code></p>

    {#if status}
      <div class="status">
        {#if status.uncommitted_files > 0}
          <span class="warning">{status.uncommitted_files} uncommitted file{status.uncommitted_files === 1 ? "" : "s"}</span>
        {/if}
        {#if status.unpushed_commits > 0}
          <span class="warning">{status.unpushed_commits} unpushed commit{status.unpushed_commits === 1 ? "" : "s"}</span>
        {/if}
        {#if status.uncommitted_files === 0 && status.unpushed_commits === 0}
          <span class="clean">Clean — no unsaved changes</span>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <button class="keep" onclick={onKeep}>Keep worktree</button>
      <button class="delete" onclick={onDelete}>Delete worktree</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    width: 380px;
  }

  h3 {
    margin: 0 0 12px;
    font-size: 16px;
  }

  .session-name {
    font-weight: 600;
    margin: 0 0 4px;
  }

  .branch {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }

  .status {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
    font-size: 13px;
  }

  .warning {
    color: var(--warning);
  }

  .clean {
    color: var(--success);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }

  .keep {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .delete {
    background: var(--error);
    color: white;
    font-weight: 600;
  }
</style>
```

- [ ] **Step 2: Wire cleanup dialog into App.svelte**

Add imports and state to `App.svelte`:

```ts
import { GetWorktreeStatus, CleanupWorktree } from "../wailsjs/go/main/App";
import WorktreeCleanupDialog from "./lib/WorktreeCleanupDialog.svelte";
import type { WorktreeStatus } from "./lib/types";

// Add to state declarations
let worktreeCleanup = $state<{
  sessionId: string;
  sessionName: string;
  branchName: string;
  status: WorktreeStatus | null;
} | null>(null);
```

Update the `sessions-updated` event handler in `onMount` — replace the existing exited-session collapse logic:

```ts
const cancelSessions = EventsOn("sessions-updated", (updated: unknown) => {
  const newSessions = (updated || []) as SessionInfo[];
  sessions = newSessions;

  for (const s of newSessions) {
    if (s.status === "exited") {
      const path = findLeafBySessionId(layoutTree, s.id);
      if (path) {
        delete terminalApis[s.id];

        // If worktree session, show cleanup dialog instead of collapsing immediately
        if (s.worktree_enabled && s.worktree_path) {
          GetWorktreeStatus(s.id).then((status) => {
            worktreeCleanup = {
              sessionId: s.id,
              sessionName: s.name,
              branchName: s.branch_name || "",
              status,
            };
          }).catch(() => {
            worktreeCleanup = {
              sessionId: s.id,
              sessionName: s.name,
              branchName: s.branch_name || "",
              status: null,
            };
          });
        }

        collapsePane(path);
      }
    }
  }
});
```

Add cleanup dialog handlers:

```ts
async function handleWorktreeKeep(): Promise<void> {
  if (!worktreeCleanup) return;
  await CleanupWorktree(worktreeCleanup.sessionId, false);
  worktreeCleanup = null;
}

async function handleWorktreeDelete(): Promise<void> {
  if (!worktreeCleanup) return;
  await CleanupWorktree(worktreeCleanup.sessionId, true);
  worktreeCleanup = null;
}
```

Add the dialog to the template, after the `ToastContainer`:

```svelte
{#if worktreeCleanup}
  <WorktreeCleanupDialog
    sessionName={worktreeCleanup.sessionName}
    branchName={worktreeCleanup.branchName}
    status={worktreeCleanup.status}
    onKeep={handleWorktreeKeep}
    onDelete={handleWorktreeDelete}
  />
{/if}
```

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/WorktreeCleanupDialog.svelte frontend/src/App.svelte
git commit -m "feat(worktree): add cleanup dialog on session exit"
```

---

### Task 11: Frontend — Sidebar branch indicator

**Files:**
- Modify: `frontend/src/lib/Sidebar.svelte`

- [ ] **Step 1: Add branch indicator to sidebar**

In `Sidebar.svelte`, add a branch indicator after the session name. Update the session item markup inside the `{:else}` block (the non-editing state):

```svelte
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="session-name"
    ondblclick={(e: MouseEvent) => startEditing(session, e)}
  >{session.name}</span>
  {#if session.worktree_enabled}
    <span class="branch-badge" title={session.branch_name}>&#9741;</span>
  {/if}
  <button
    class="edit-btn"
    onclick={(e: MouseEvent) => startEditing(session, e)}
    title="Rename session"
  >&#9998;</button>
{/if}
```

Add the CSS for the branch badge:

```css
.branch-badge {
  color: var(--accent);
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}
```

- [ ] **Step 2: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/Sidebar.svelte
git commit -m "feat(worktree): add branch indicator in sidebar"
```

---

### Task 12: Integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run all Go tests**

Run: `go test ./internal/...`
Expected: PASS

- [ ] **Step 2: Run frontend checks**

Run: `cd frontend && npm run check && npm run build`
Expected: PASS

- [ ] **Step 3: Build the full app**

Run: `GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: BUILD SUCCESS

- [ ] **Step 4: Manual smoke test**

1. Launch the app
2. Create a new session pointing at a git repo — verify the worktree checkbox appears
3. Enable worktree, accept default branch name, launch
4. Verify the session runs in the worktree directory (check sidebar branch indicator)
5. Kill the session — verify the cleanup dialog appears with git status
6. Test both "Keep" and "Delete" paths
7. Create a non-worktree session — verify existing behavior unchanged

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for worktree isolation"
```
