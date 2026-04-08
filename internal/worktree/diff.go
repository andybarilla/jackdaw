package worktree

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// FileDiff represents the diff for a single file.
type FileDiff struct {
	Path    string     `json:"path"`
	OldPath string     `json:"old_path,omitempty"`
	Status  string     `json:"status"` // added, modified, deleted, renamed
	Hunks   []DiffHunk `json:"hunks"`
	Binary  bool       `json:"binary"`
}

// DiffHunk represents a single hunk in a diff.
type DiffHunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

// DiffLine represents a single line in a diff hunk.
type DiffLine struct {
	Type    string `json:"type"` // context, add, delete
	Content string `json:"content"`
	OldLine int    `json:"old_line,omitempty"`
	NewLine int    `json:"new_line,omitempty"`
}

// Diff returns structured diff data for a working directory.
// If baseBranch is non-empty, includes committed changes (baseBranch..HEAD).
// Always includes uncommitted changes (staged + unstaged).
func Diff(workDir string, baseBranch string) ([]FileDiff, error) {
	var allFiles []FileDiff
	seen := make(map[string]bool)

	// Committed changes against base branch
	if baseBranch != "" {
		out, err := exec.Command("git", "-C", workDir, "diff", "--no-color", "-U3", baseBranch+"..HEAD").Output()
		if err == nil && len(out) > 0 {
			files, parseErr := parseDiff(string(out))
			if parseErr != nil {
				return nil, fmt.Errorf("parse committed diff: %w", parseErr)
			}
			for _, f := range files {
				allFiles = append(allFiles, f)
				seen[f.Path] = true
			}
		}
	}

	// Uncommitted changes (staged + unstaged combined)
	out, err := exec.Command("git", "-C", workDir, "diff", "--no-color", "-U3", "HEAD").Output()
	if err == nil && len(out) > 0 {
		files, parseErr := parseDiff(string(out))
		if parseErr != nil {
			return nil, fmt.Errorf("parse uncommitted diff: %w", parseErr)
		}
		for _, f := range files {
			if !seen[f.Path] {
				allFiles = append(allFiles, f)
				seen[f.Path] = true
			}
		}
	}

	// Untracked files show up as new files
	untrackedOut, err := exec.Command("git", "-C", workDir, "ls-files", "--others", "--exclude-standard").Output()
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(untrackedOut)), "\n") {
			if line != "" && !seen[line] {
				allFiles = append(allFiles, FileDiff{
					Path:   line,
					Status: "added",
				})
			}
		}
	}

	return allFiles, nil
}

// DiffFile returns the diff for a single file in the working directory.
func DiffFile(workDir string, baseBranch string, filePath string) (*FileDiff, error) {
	var result *FileDiff

	// Committed changes for this file
	if baseBranch != "" {
		out, err := exec.Command("git", "-C", workDir, "diff", "--no-color", "-U3", baseBranch+"..HEAD", "--", filePath).Output()
		if err == nil && len(out) > 0 {
			files, parseErr := parseDiff(string(out))
			if parseErr != nil {
				return nil, fmt.Errorf("parse committed diff: %w", parseErr)
			}
			if len(files) > 0 {
				result = &files[0]
			}
		}
	}

	// Uncommitted changes for this file
	out, err := exec.Command("git", "-C", workDir, "diff", "--no-color", "-U3", "HEAD", "--", filePath).Output()
	if err == nil && len(out) > 0 {
		files, parseErr := parseDiff(string(out))
		if parseErr != nil {
			return nil, fmt.Errorf("parse uncommitted diff: %w", parseErr)
		}
		if len(files) > 0 {
			if result == nil {
				result = &files[0]
			} else {
				// Merge hunks from uncommitted into committed
				result.Hunks = append(result.Hunks, files[0].Hunks...)
			}
		}
	}

	return result, nil
}

// parseDiff parses unified diff output into structured FileDiff slices.
func parseDiff(raw string) ([]FileDiff, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	var files []FileDiff
	lines := strings.Split(raw, "\n")
	i := 0

	for i < len(lines) {
		// Find next "diff --git" header
		if !strings.HasPrefix(lines[i], "diff --git ") {
			i++
			continue
		}

		file := FileDiff{Status: "modified"}

		// Parse "diff --git a/path b/path"
		header := lines[i]
		parts := strings.SplitN(header, " b/", 2)
		if len(parts) == 2 {
			file.Path = parts[1]
		}
		i++

		// Parse extended headers until we hit --- or another diff or hunk
		for i < len(lines) {
			line := lines[i]
			if strings.HasPrefix(line, "new file mode") {
				file.Status = "added"
			} else if strings.HasPrefix(line, "deleted file mode") {
				file.Status = "deleted"
			} else if strings.HasPrefix(line, "rename from ") {
				file.OldPath = strings.TrimPrefix(line, "rename from ")
				file.Status = "renamed"
			} else if strings.HasPrefix(line, "rename to ") {
				file.Path = strings.TrimPrefix(line, "rename to ")
			} else if strings.HasPrefix(line, "Binary files") {
				file.Binary = true
				i++
				break
			} else if strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "diff --git ") {
				break
			}
			i++
		}

		// Skip --- and +++ lines
		if i < len(lines) && strings.HasPrefix(lines[i], "--- ") {
			i++
		}
		if i < len(lines) && strings.HasPrefix(lines[i], "+++ ") {
			i++
		}

		// Parse hunks
		for i < len(lines) && !strings.HasPrefix(lines[i], "diff --git ") {
			if !strings.HasPrefix(lines[i], "@@") {
				i++
				continue
			}

			hunk := DiffHunk{}
			// Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
			hunk.Header = parseHunkHeader(lines[i])
			oldLine, newLine := parseHunkStartLines(hunk.Header)
			i++

			for i < len(lines) {
				line := lines[i]
				if strings.HasPrefix(line, "diff --git ") || strings.HasPrefix(line, "@@") {
					break
				}

				dl := DiffLine{}
				if strings.HasPrefix(line, "+") {
					dl.Type = "add"
					dl.Content = line[1:]
					dl.NewLine = newLine
					newLine++
				} else if strings.HasPrefix(line, "-") {
					dl.Type = "delete"
					dl.Content = line[1:]
					dl.OldLine = oldLine
					oldLine++
				} else if strings.HasPrefix(line, " ") {
					dl.Type = "context"
					dl.Content = line[1:]
					dl.OldLine = oldLine
					dl.NewLine = newLine
					oldLine++
					newLine++
				} else if line == `\ No newline at end of file` {
					i++
					continue
				} else {
					// Empty line or unexpected content — treat as end of hunk
					i++
					break
				}

				hunk.Lines = append(hunk.Lines, dl)
				i++
			}

			if len(hunk.Lines) > 0 {
				file.Hunks = append(file.Hunks, hunk)
			}
		}

		files = append(files, file)
	}

	return files, nil
}

// parseHunkHeader extracts the @@ ... @@ portion of a hunk line.
func parseHunkHeader(line string) string {
	// @@ -1,3 +1,4 @@ optional section heading
	if idx := strings.Index(line[2:], "@@"); idx >= 0 {
		return strings.TrimSpace(line[:idx+4])
	}
	return line
}

// parseHunkStartLines extracts old and new start line numbers from a hunk header.
func parseHunkStartLines(header string) (oldStart int, newStart int) {
	// @@ -oldStart,oldCount +newStart,newCount @@
	header = strings.TrimPrefix(header, "@@ ")
	header = strings.TrimSuffix(header, " @@")
	parts := strings.Fields(header)
	if len(parts) >= 2 {
		oldStart = parseStartLine(parts[0])
		newStart = parseStartLine(parts[1])
	}
	return
}

func parseStartLine(s string) int {
	// -1,3 or +1,3 or -1 or +1
	s = strings.TrimLeft(s, "-+")
	if idx := strings.Index(s, ","); idx >= 0 {
		s = s[:idx]
	}
	n, _ := strconv.Atoi(s)
	return n
}
