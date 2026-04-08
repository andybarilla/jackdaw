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
