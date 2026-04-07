package manifest

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID: "test-123",
		PID:       12345,
		Command:   "claude",
		Args:      []string{"--resume"},
		WorkDir:   "/home/user/project",
		StartedAt: time.Date(2026, 4, 6, 12, 0, 0, 0, time.UTC),
	}

	path := filepath.Join(dir, "test-123.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}

	if got.SessionID != m.SessionID {
		t.Errorf("SessionID = %q, want %q", got.SessionID, m.SessionID)
	}
	if got.PID != m.PID {
		t.Errorf("PID = %d, want %d", got.PID, m.PID)
	}
	if got.WorkDir != m.WorkDir {
		t.Errorf("WorkDir = %q, want %q", got.WorkDir, m.WorkDir)
	}
}

func TestReadNotFound(t *testing.T) {
	got, err := Read("/nonexistent/path.json")
	if err != nil {
		t.Fatalf("Read nonexistent: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil for nonexistent manifest, got %+v", got)
	}
}

func TestIsProcessAlive(t *testing.T) {
	if !IsProcessAlive(os.Getpid()) {
		t.Error("current process should be alive")
	}
	if IsProcessAlive(-1) {
		t.Error("PID -1 should not be alive")
	}
}

func TestListManifests(t *testing.T) {
	dir := t.TempDir()

	m1 := &Manifest{SessionID: "s1", PID: 1, StartedAt: time.Now()}
	m2 := &Manifest{SessionID: "s2", PID: 2, StartedAt: time.Now()}

	Write(filepath.Join(dir, "s1.json"), m1)
	Write(filepath.Join(dir, "s2.json"), m2)

	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("ignore"), 0644)

	manifests, err := List(dir)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(manifests) != 2 {
		t.Errorf("List returned %d manifests, want 2", len(manifests))
	}
}

func TestRemoveManifest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")
	Write(path, &Manifest{SessionID: "test", PID: 1, StartedAt: time.Now()})

	if err := Remove(path); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	got, _ := Read(path)
	if got != nil {
		t.Error("manifest should be gone after Remove")
	}
}

func TestWriteAndReadWithName(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID: "test-name",
		PID:       12345,
		Command:   "claude",
		WorkDir:   "/home/user/project",
		Name:      "my-project",
		StartedAt: time.Date(2026, 4, 6, 12, 0, 0, 0, time.UTC),
	}

	path := filepath.Join(dir, "test-name.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Name != "my-project" {
		t.Errorf("Name = %q, want %q", got.Name, "my-project")
	}
}

func TestManifestHistoryPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")

	mf := &Manifest{
		SessionID:   "test-1",
		PID:         12345,
		Command:     "claude",
		WorkDir:     "/tmp",
		SocketPath:  "/tmp/test.sock",
		StartedAt:   time.Now(),
		HistoryPath: "/home/user/.jackdaw/history/test-1.log",
	}

	if err := Write(path, mf); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.HistoryPath != "/home/user/.jackdaw/history/test-1.log" {
		t.Errorf("HistoryPath = %q, want %q", got.HistoryPath, "/home/user/.jackdaw/history/test-1.log")
	}
}

func TestReadLegacyManifestWithoutName(t *testing.T) {
	dir := t.TempDir()
	// Simulate a legacy manifest JSON without a "name" field
	legacy := `{"session_id":"old-1","pid":100,"command":"claude","work_dir":"/tmp/foo","started_at":"2026-04-06T12:00:00Z"}`
	path := filepath.Join(dir, "old-1.json")
	if err := os.WriteFile(path, []byte(legacy), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Name != "" {
		t.Errorf("Name = %q, want empty for legacy manifest", got.Name)
	}
}

func TestWriteAndReadWithSocketPath(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID:  "test-sock",
		PID:        12345,
		Command:    "claude",
		WorkDir:    "/home/user/project",
		SocketPath: "/tmp/jackdaw/test-sock.sock",
		StartedAt:  time.Date(2026, 4, 6, 12, 0, 0, 0, time.UTC),
	}

	path := filepath.Join(dir, "test-sock.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.SocketPath != m.SocketPath {
		t.Errorf("SocketPath = %q, want %q", got.SocketPath, m.SocketPath)
	}
}
