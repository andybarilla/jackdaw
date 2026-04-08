package worktree

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
		if out, err := git(repoDir, "merge", "--no-ff", branchName, "-m", commitMsg); err != nil {
			return nil, fmt.Errorf("merge: %s", out)
		}
	}

	return &MergeResult{Success: true, CommitMessage: commitMsg}, nil
}

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
