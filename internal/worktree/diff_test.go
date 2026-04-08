package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", dir}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	cmd := exec.Command("git", "init", "--initial-branch=main", dir)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	run("config", "user.email", "test@test.com")
	run("config", "user.name", "Test")
	os.WriteFile(filepath.Join(dir, "README"), []byte("init"), 0644)
	run("add", ".")
	run("commit", "-m", "init")
	return dir
}

func TestParseDiffEmpty(t *testing.T) {
	files, err := parseDiff("")
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

func TestParseDiffSingleFile(t *testing.T) {
	raw := `diff --git a/hello.txt b/hello.txt
new file mode 100644
index 0000000..ce01362
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1,3 @@
+hello
+world
+!
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	f := files[0]
	if f.Path != "hello.txt" {
		t.Errorf("Path = %q, want %q", f.Path, "hello.txt")
	}
	if f.Status != "added" {
		t.Errorf("Status = %q, want %q", f.Status, "added")
	}
	if len(f.Hunks) != 1 {
		t.Fatalf("expected 1 hunk, got %d", len(f.Hunks))
	}
	if len(f.Hunks[0].Lines) != 3 {
		t.Errorf("expected 3 lines, got %d", len(f.Hunks[0].Lines))
	}
	for _, line := range f.Hunks[0].Lines {
		if line.Type != "add" {
			t.Errorf("line type = %q, want %q", line.Type, "add")
		}
	}
}

func TestParseDiffModifiedFile(t *testing.T) {
	raw := `diff --git a/file.txt b/file.txt
index 1234567..abcdef0 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2-modified
+line3-new
 line4
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	f := files[0]
	if f.Status != "modified" {
		t.Errorf("Status = %q, want %q", f.Status, "modified")
	}
	if len(f.Hunks) != 1 {
		t.Fatalf("expected 1 hunk, got %d", len(f.Hunks))
	}

	h := f.Hunks[0]
	if h.Header != "@@ -1,3 +1,4 @@" {
		t.Errorf("Header = %q", h.Header)
	}

	types := make([]string, len(h.Lines))
	for i, l := range h.Lines {
		types[i] = l.Type
	}
	expected := []string{"context", "delete", "add", "add", "context"}
	if len(types) != len(expected) {
		t.Fatalf("line count = %d, want %d", len(types), len(expected))
	}
	for i := range expected {
		if types[i] != expected[i] {
			t.Errorf("line %d type = %q, want %q", i, types[i], expected[i])
		}
	}
}

func TestParseDiffDeletedFile(t *testing.T) {
	raw := `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index abcdef0..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-was here
-now gone
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	if files[0].Status != "deleted" {
		t.Errorf("Status = %q, want %q", files[0].Status, "deleted")
	}
}

func TestParseDiffRenamedFile(t *testing.T) {
	raw := `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	f := files[0]
	if f.Status != "renamed" {
		t.Errorf("Status = %q, want %q", f.Status, "renamed")
	}
	if f.OldPath != "old.txt" {
		t.Errorf("OldPath = %q, want %q", f.OldPath, "old.txt")
	}
	if f.Path != "new.txt" {
		t.Errorf("Path = %q, want %q", f.Path, "new.txt")
	}
}

func TestParseDiffBinaryFile(t *testing.T) {
	raw := `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abcdef0
Binary files /dev/null and b/image.png differ
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	if !files[0].Binary {
		t.Error("expected Binary = true")
	}
}

func TestParseDiffMultipleFiles(t *testing.T) {
	raw := `diff --git a/a.txt b/a.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/a.txt
@@ -0,0 +1 @@
+aaa
diff --git a/b.txt b/b.txt
index 1234567..abcdef0 100644
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-old
+new
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0].Path != "a.txt" {
		t.Errorf("files[0].Path = %q", files[0].Path)
	}
	if files[1].Path != "b.txt" {
		t.Errorf("files[1].Path = %q", files[1].Path)
	}
}

func TestParseDiffLineNumbers(t *testing.T) {
	raw := `diff --git a/file.txt b/file.txt
index 1234567..abcdef0 100644
--- a/file.txt
+++ b/file.txt
@@ -5,3 +5,4 @@
 context
-removed
+added1
+added2
 context2
`
	files, err := parseDiff(raw)
	if err != nil {
		t.Fatalf("parseDiff: %v", err)
	}
	h := files[0].Hunks[0]

	// context line at old=5, new=5
	if h.Lines[0].OldLine != 5 || h.Lines[0].NewLine != 5 {
		t.Errorf("context line: old=%d new=%d, want old=5 new=5", h.Lines[0].OldLine, h.Lines[0].NewLine)
	}
	// delete at old=6
	if h.Lines[1].OldLine != 6 || h.Lines[1].NewLine != 0 {
		t.Errorf("delete line: old=%d new=%d, want old=6 new=0", h.Lines[1].OldLine, h.Lines[1].NewLine)
	}
	// add at new=6
	if h.Lines[2].OldLine != 0 || h.Lines[2].NewLine != 6 {
		t.Errorf("add line: old=%d new=%d, want old=0 new=6", h.Lines[2].OldLine, h.Lines[2].NewLine)
	}
	// add at new=7
	if h.Lines[3].NewLine != 7 {
		t.Errorf("add line 2: new=%d, want 7", h.Lines[3].NewLine)
	}
	// context at old=7, new=8
	if h.Lines[4].OldLine != 7 || h.Lines[4].NewLine != 8 {
		t.Errorf("context2: old=%d new=%d, want old=7 new=8", h.Lines[4].OldLine, h.Lines[4].NewLine)
	}
}

func TestDiffIntegration(t *testing.T) {
	repo := initTestRepo(t)

	// Create a file and commit it
	os.WriteFile(filepath.Join(repo, "test.txt"), []byte("line1\nline2\nline3\n"), 0644)
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", repo}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("add", ".")
	run("commit", "-m", "initial")

	// Make changes
	os.WriteFile(filepath.Join(repo, "test.txt"), []byte("line1\nline2-modified\nline3\n"), 0644)
	os.WriteFile(filepath.Join(repo, "new.txt"), []byte("new file\n"), 0644)

	// Diff uncommitted
	files, err := Diff(repo, "")
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	// Find test.txt
	var found bool
	for _, f := range files {
		if f.Path == "test.txt" {
			found = true
			if f.Status != "modified" {
				t.Errorf("test.txt status = %q, want modified", f.Status)
			}
		}
	}
	if !found {
		t.Error("test.txt not found in diff")
	}
}

func TestDiffWithBaseBranch(t *testing.T) {
	repo := initTestRepo(t)

	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", repo}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	// Create feature branch with changes
	run("checkout", "-b", "feature")
	os.WriteFile(filepath.Join(repo, "feature.txt"), []byte("feature content\n"), 0644)
	run("add", ".")
	run("commit", "-m", "feature commit")

	// Diff against main (the initial branch)
	// Detect the initial branch name
	out, _ := exec.Command("git", "-C", repo, "rev-parse", "--abbrev-ref", "HEAD").Output()
	_ = out // we're on feature

	files, err := Diff(repo, "main")
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}

	var found bool
	for _, f := range files {
		if f.Path == "feature.txt" {
			found = true
			if f.Status != "added" {
				t.Errorf("feature.txt status = %q, want added", f.Status)
			}
		}
	}
	if !found {
		t.Error("feature.txt not found in diff")
	}
}

func TestDiffNoChanges(t *testing.T) {
	repo := initTestRepo(t)

	files, err := Diff(repo, "")
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

func TestDiffSingleFile(t *testing.T) {
	repo := initTestRepo(t)

	// Create files and commit
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("aaa\n"), 0644)
	os.WriteFile(filepath.Join(repo, "b.txt"), []byte("bbb\n"), 0644)
	run := func(args ...string) {
		c := exec.Command("git", append([]string{"-C", repo}, args...)...)
		c.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("add", ".")
	run("commit", "-m", "add files")

	// Modify both
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("aaa-modified\n"), 0644)
	os.WriteFile(filepath.Join(repo, "b.txt"), []byte("bbb-modified\n"), 0644)

	// Diff only a.txt
	file, err := DiffFile(repo, "", "a.txt")
	if err != nil {
		t.Fatalf("DiffFile: %v", err)
	}
	if file == nil {
		t.Fatal("expected non-nil file")
	}
	if file.Path != "a.txt" {
		t.Errorf("Path = %q, want a.txt", file.Path)
	}
}
