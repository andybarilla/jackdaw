package worktree

import (
	"fmt"
	"os"
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

// WorktreeStatus holds the current state of a worktree.
type WorktreeStatus struct {
	Branch           string
	UncommittedFiles int
	UnpushedCommits  int
}

// Status returns the current status of the worktree at the given path.
func Status(worktreePath string) (WorktreeStatus, error) {
	var s WorktreeStatus

	branchOut, err := exec.Command("git", "-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return s, fmt.Errorf("git rev-parse: %w", err)
	}
	s.Branch = strings.TrimSpace(string(branchOut))

	statusOut, err := exec.Command("git", "-C", worktreePath, "status", "--porcelain").Output()
	if err != nil {
		return s, fmt.Errorf("git status: %w", err)
	}
	for _, line := range strings.Split(string(statusOut), "\n") {
		if line != "" {
			s.UncommittedFiles++
		}
	}

	logOut, err := exec.Command("git", "-C", worktreePath, "log", "@{upstream}..HEAD", "--oneline").Output()
	if err == nil {
		for _, line := range strings.Split(string(logOut), "\n") {
			if line != "" {
				s.UnpushedCommits++
			}
		}
	}
	// If err != nil (e.g. no upstream configured), leave UnpushedCommits as 0.

	return s, nil
}

// Remove removes the worktree at worktreePath and deletes branchName from repoDir.
func Remove(repoDir, worktreePath, branchName string) error {
	out, err := exec.Command("git", "-C", repoDir, "worktree", "remove", "--force", worktreePath).CombinedOutput()
	if err != nil {
		if _, statErr := os.Stat(worktreePath); os.IsNotExist(statErr) {
			// Directory already gone; prune stale entries and continue.
			exec.Command("git", "-C", repoDir, "worktree", "prune").Run() //nolint:errcheck
		} else {
			return fmt.Errorf("git worktree remove: %w\n%s", err, out)
		}
	}

	// Best effort: delete the branch.
	exec.Command("git", "-C", repoDir, "branch", "-D", branchName).Run() //nolint:errcheck

	return nil
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
