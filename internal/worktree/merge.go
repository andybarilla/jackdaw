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
