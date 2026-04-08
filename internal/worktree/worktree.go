package worktree

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// IsGitRepo reports whether dir is inside a git repository.
func IsGitRepo(dir string) bool {
	cmd := exec.Command("git", "-C", dir, "rev-parse", "--git-dir")
	return cmd.Run() == nil
}

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
	ref := strings.TrimSpace(string(out))
	parts := strings.Split(ref, "/")
	return parts[len(parts)-1], nil
}
