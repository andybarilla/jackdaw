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
