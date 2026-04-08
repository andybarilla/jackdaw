package worktree_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/andybarilla/jackdaw/internal/worktree"
)

func initGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	cmd := exec.Command("git", "init", dir)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", dir}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("config", "user.email", "test@test.com")
	run("config", "user.name", "Test")
	os.WriteFile(filepath.Join(dir, "README"), []byte("init"), 0644)
	run("add", ".")
	run("commit", "-m", "init")
	return dir
}

func TestIsGitRepo_GitRepo(t *testing.T) {
	dir := initGitRepo(t)
	if !worktree.IsGitRepo(dir) {
		t.Errorf("expected %q to be a git repo", dir)
	}
}

func TestIsGitRepo_NonRepo(t *testing.T) {
	dir := t.TempDir()
	if worktree.IsGitRepo(dir) {
		t.Errorf("expected %q to not be a git repo", dir)
	}
}

func TestIsGitRepo_Subdirectory(t *testing.T) {
	root := initGitRepo(t)
	sub := filepath.Join(root, "subdir")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if !worktree.IsGitRepo(sub) {
		t.Errorf("expected subdirectory %q to be recognized as inside a git repo", sub)
	}
}

func TestCreate(t *testing.T) {
	repoDir := initGitRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := worktree.Create(repoDir, wtRoot, "feature-x", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := os.Stat(wtPath); err != nil {
		t.Errorf("worktree directory does not exist: %v", err)
	}

	if filepath.Dir(wtPath) != wtRoot {
		t.Errorf("expected worktree inside %q, got %q", wtRoot, wtPath)
	}

	// verify branch exists in repo
	cmd := exec.Command("git", "-C", repoDir, "branch", "--list", "feature-x")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git branch --list: %v", err)
	}
	if len(out) == 0 {
		t.Error("expected branch feature-x to exist in repo")
	}
}

func TestCreateWithBaseBranch(t *testing.T) {
	repoDir := initGitRepo(t)
	// create develop branch
	cmd := exec.Command("git", "-C", repoDir, "branch", "develop")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git branch develop: %v\n%s", err, out)
	}
	wtRoot := t.TempDir()

	wtPath, err := worktree.Create(repoDir, wtRoot, "feature-y", "develop")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := os.Stat(wtPath); err != nil {
		t.Errorf("worktree directory does not exist: %v", err)
	}
}

func TestCreateBranchConflict(t *testing.T) {
	repoDir := initGitRepo(t)
	cmd := exec.Command("git", "-C", repoDir, "branch", "existing-branch")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git branch existing-branch: %v\n%s", err, out)
	}
	wtRoot := t.TempDir()

	_, err := worktree.Create(repoDir, wtRoot, "existing-branch", "")
	if err == nil {
		t.Error("expected error when branch already exists, got nil")
	}
}

func TestStatusClean(t *testing.T) {
	repoDir := initGitRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := worktree.Create(repoDir, wtRoot, "status-clean", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	status, err := worktree.Status(wtPath)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Branch != "status-clean" {
		t.Errorf("expected branch %q, got %q", "status-clean", status.Branch)
	}
	if status.UncommittedFiles != 0 {
		t.Errorf("expected 0 uncommitted files, got %d", status.UncommittedFiles)
	}
	if status.UnpushedCommits != 0 {
		t.Errorf("expected 0 unpushed commits, got %d", status.UnpushedCommits)
	}
}

func TestStatusDirty(t *testing.T) {
	repoDir := initGitRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := worktree.Create(repoDir, wtRoot, "status-dirty", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Add 2 untracked files
	os.WriteFile(filepath.Join(wtPath, "file1.txt"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(wtPath, "file2.txt"), []byte("b"), 0644)

	// Make 1 commit (not pushed, no upstream)
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", wtPath}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("add", "file1.txt")
	run("commit", "-m", "add file1")

	status, err := worktree.Status(wtPath)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.UncommittedFiles != 1 {
		t.Errorf("expected 1 uncommitted file (file2.txt untracked), got %d", status.UncommittedFiles)
	}
	// No upstream set, so unpushed should be 0
	if status.UnpushedCommits != 0 {
		t.Errorf("expected 0 unpushed commits (no upstream), got %d", status.UnpushedCommits)
	}
}

func TestRemove(t *testing.T) {
	repoDir := initGitRepo(t)
	wtRoot := t.TempDir()

	wtPath, err := worktree.Create(repoDir, wtRoot, "to-remove", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := worktree.Remove(repoDir, wtPath, "to-remove"); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Errorf("expected worktree directory to be gone, got: %v", err)
	}

	// Verify branch is deleted
	cmd := exec.Command("git", "-C", repoDir, "branch", "--list", "to-remove")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git branch --list: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected branch to-remove to be deleted, still exists")
	}
}

func TestRemoveMissingWorktree(t *testing.T) {
	repoDir := initGitRepo(t)
	wtRoot := t.TempDir()
	missingPath := filepath.Join(wtRoot, "nonexistent")

	if err := worktree.Remove(repoDir, missingPath, "nonexistent-branch"); err != nil {
		t.Errorf("expected no error removing missing worktree, got: %v", err)
	}
}
