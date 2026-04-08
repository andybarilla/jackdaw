package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/manifest"
	"github.com/andybarilla/jackdaw/internal/relay"
)

func TestManagerKillNonexistent(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
	err := m.Kill("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestManagerRecover(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	// Start a real relay server so Reconnect succeeds
	sockPath := filepath.Join(socketDir, "recovered-1.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	mf := &manifest.Manifest{
		SessionID:  "recovered-1",
		PID:        srv.PID(),
		Command:    "cat",
		Args:       nil,
		WorkDir:    "/tmp",
		SocketPath: sockPath,
		StartedAt:  time.Now().Add(-10 * time.Minute),
	}
	manifest.Write(filepath.Join(manifestDir, "recovered-1.json"), mf)

	// Simulate a stale session (PID that doesn't exist)
	staleMf := &manifest.Manifest{
		SessionID: "stale-1",
		PID:       999999999,
		Command:   "cat",
		WorkDir:   "/tmp",
		StartedAt: time.Now().Add(-1 * time.Hour),
	}
	manifest.Write(filepath.Join(manifestDir, "stale-1.json"), staleMf)

	m := NewManager(manifestDir, socketDir, t.TempDir(), 1048576)
	recovered := m.Recover()

	// Should recover the alive session
	foundAlive := false
	for _, info := range recovered {
		if info.ID == "recovered-1" {
			foundAlive = true
			if info.Status != StatusWorking {
				t.Errorf("recovered session status = %q, want %q", info.Status, StatusWorking)
			}
		}
	}
	if !foundAlive {
		t.Error("expected to recover session with alive PID")
	}

	// Stale manifest should be cleaned up
	staleManifest, _ := manifest.Read(filepath.Join(manifestDir, "stale-1.json"))
	if staleManifest != nil {
		t.Error("stale manifest should have been removed")
	}
}

func TestManagerGenerateName(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)

	// Simulate existing sessions by inserting into sessionInfo directly
	m.sessionInfo["1"] = &SessionInfo{ID: "1", WorkDir: "/home/user/myapp", Name: "myapp"}
	m.sessionInfo["2"] = &SessionInfo{ID: "2", WorkDir: "/home/user/myapp", Name: "myapp (2)"}

	got := m.generateName("/home/user/myapp")
	if got != "myapp (3)" {
		t.Errorf("generateName = %q, want %q", got, "myapp (3)")
	}

	got2 := m.generateName("/home/user/other")
	if got2 != "other" {
		t.Errorf("generateName = %q, want %q", got2, "other")
	}
}

func TestManagerGenerateNameFirst(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
	got := m.generateName("/home/user/project")
	if got != "project" {
		t.Errorf("generateName = %q, want %q", got, "project")
	}
}

func TestManagerGenerateNameRoot(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
	got := m.generateName("/")
	if got != "/" {
		t.Errorf("generateName = %q, want %q", got, "/")
	}
}

func TestManagerRename(t *testing.T) {
	manifestDir := t.TempDir()
	m := NewManager(manifestDir, t.TempDir(), t.TempDir(), 1048576)

	// Insert a fake session info and manifest
	m.sessionInfo["s1"] = &SessionInfo{ID: "s1", Name: "old-name", WorkDir: "/tmp/foo"}
	mf := &manifest.Manifest{SessionID: "s1", PID: 1, Command: "claude", WorkDir: "/tmp/foo", Name: "old-name", StartedAt: time.Now()}
	manifest.Write(filepath.Join(manifestDir, "s1.json"), mf)

	if err := m.Rename("s1", "new-name"); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	// Check in-memory
	if m.sessionInfo["s1"].Name != "new-name" {
		t.Errorf("in-memory Name = %q, want %q", m.sessionInfo["s1"].Name, "new-name")
	}

	// Check manifest on disk
	got, err := manifest.Read(filepath.Join(manifestDir, "s1.json"))
	if err != nil {
		t.Fatalf("manifest.Read: %v", err)
	}
	if got.Name != "new-name" {
		t.Errorf("manifest Name = %q, want %q", got.Name, "new-name")
	}
}

func TestManagerRenameEmptyName(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
	m.sessionInfo["s1"] = &SessionInfo{ID: "s1", Name: "old", WorkDir: "/tmp/foo"}

	if err := m.Rename("s1", "   "); err == nil {
		t.Error("expected error for whitespace-only name")
	}
}

func TestManagerRenameNotFound(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
	if err := m.Rename("nonexistent", "name"); err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestManagerRecoverWithName(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "named-1.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	mf := &manifest.Manifest{
		SessionID:  "named-1",
		PID:        srv.PID(),
		Command:    "cat",
		WorkDir:    "/tmp/myapp",
		SocketPath: sockPath,
		StartedAt:  time.Now().Add(-10 * time.Minute),
		Name:       "custom-name",
	}
	manifest.Write(filepath.Join(manifestDir, "named-1.json"), mf)

	m := NewManager(manifestDir, socketDir, t.TempDir(), 1048576)
	recovered := m.Recover()

	found := false
	for _, info := range recovered {
		if info.ID == "named-1" {
			found = true
			if info.Name != "custom-name" {
				t.Errorf("Name = %q, want %q", info.Name, "custom-name")
			}
		}
	}
	if !found {
		t.Error("expected to recover named session")
	}
}

func TestManagerRecoverLegacyNoName(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "legacy-1.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	// Write manifest without Name field (legacy)
	mf := &manifest.Manifest{
		SessionID:  "legacy-1",
		PID:        srv.PID(),
		Command:    "cat",
		WorkDir:    "/tmp/myapp",
		SocketPath: sockPath,
		StartedAt:  time.Now().Add(-10 * time.Minute),
	}
	manifest.Write(filepath.Join(manifestDir, "legacy-1.json"), mf)

	m := NewManager(manifestDir, socketDir, t.TempDir(), 1048576)
	recovered := m.Recover()

	found := false
	for _, info := range recovered {
		if info.ID == "legacy-1" {
			found = true
			if info.Name != "myapp" {
				t.Errorf("Name = %q, want %q (generated from WorkDir)", info.Name, "myapp")
			}
		}
	}
	if !found {
		t.Error("expected to recover legacy session")
	}
}

func TestManagerKillCleansUpHistoryFile(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()
	historyDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "kill-history.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	m := NewManager(manifestDir, socketDir, historyDir, 1048576)

	historyPath := filepath.Join(historyDir, "kill-history.log")
	os.WriteFile(historyPath, []byte("some output"), 0600)

	client, _ := relay.NewClient(sockPath)
	s := &Session{
		ID:         "kill-history",
		SocketPath: sockPath,
		client:     client,
		pid:        srv.PID(),
		exitDone:   make(chan struct{}),
	}
	m.sessions["kill-history"] = s
	m.sessionInfo["kill-history"] = &SessionInfo{
		ID:     "kill-history",
		Status: StatusWorking,
		PID:    srv.PID(),
	}

	mf := &manifest.Manifest{
		SessionID:   "kill-history",
		PID:         srv.PID(),
		Command:     "cat",
		WorkDir:     "/tmp",
		SocketPath:  sockPath,
		StartedAt:   time.Now(),
		HistoryPath: historyPath,
	}
	manifest.Write(filepath.Join(manifestDir, "kill-history.json"), mf)

	m.Kill("kill-history")

	if _, err := os.Stat(historyPath); !os.IsNotExist(err) {
		t.Error("history file should be deleted after Kill")
	}
}

func TestManagerRecoverCleansUpStaleHistoryFile(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()
	historyDir := t.TempDir()

	historyPath := filepath.Join(historyDir, "stale-history.log")
	os.WriteFile(historyPath, []byte("stale output"), 0600)

	staleMf := &manifest.Manifest{
		SessionID:   "stale-history",
		PID:         999999999,
		Command:     "cat",
		WorkDir:     "/tmp",
		StartedAt:   time.Now().Add(-1 * time.Hour),
		HistoryPath: historyPath,
	}
	manifest.Write(filepath.Join(manifestDir, "stale-history.json"), staleMf)

	m := NewManager(manifestDir, socketDir, historyDir, 1048576)
	m.Recover()

	if _, err := os.Stat(historyPath); !os.IsNotExist(err) {
		t.Error("stale history file should be deleted during Recover")
	}
}
