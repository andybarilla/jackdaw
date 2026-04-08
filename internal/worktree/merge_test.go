package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

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

	wtPath, err := Create(repoDir, wtRoot, "feat-hello-world", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

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

	branch := gitRun(t, repoDir, "rev-parse", "--abbrev-ref", "HEAD")
	if branch != "main" {
		t.Errorf("expected to be on main, got %q", branch)
	}

	if _, err := os.Stat(filepath.Join(repoDir, "hello.txt")); err != nil {
		t.Errorf("hello.txt not found on main after merge: %v", err)
	}

	log := gitRun(t, repoDir, "log", "--oneline")
	lines := strings.Split(log, "\n")
	if len(lines) != 2 { // init + squashed
		t.Errorf("expected 2 commits on main, got %d: %s", len(lines), log)
	}
}

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

	log := gitRun(t, repoDir, "log", "--oneline")
	lines := strings.Split(log, "\n")
	if len(lines) < 3 { // init + feature commit + merge commit
		t.Errorf("expected at least 3 commits for regular merge, got %d: %s", len(lines), log)
	}
}

func TestMergeRebaseConflict(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := Create(repoDir, wtRoot, "feat-conflict", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Conflicting changes on main
	os.WriteFile(filepath.Join(repoDir, "README"), []byte("changed on main"), 0644)
	gitRun(t, repoDir, "add", ".")
	gitRun(t, repoDir, "commit", "-m", "change readme on main")

	// Conflicting changes in worktree
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

	// Verify rebase was aborted
	status := gitRun(t, wtPath, "status", "--porcelain")
	if status != "" {
		t.Errorf("worktree should be clean after abort, got: %s", status)
	}
}

func TestMergeUncommittedFiles(t *testing.T) {
	repoDir := initTestRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := Create(repoDir, wtRoot, "feat-dirty", "main")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

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
