package session

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/manifest"
	"github.com/andybarilla/jackdaw/internal/relay"
)

func TestManagerKillNonexistent(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
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
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096)
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

	m := NewManager(manifestDir, socketDir)
	recovered := m.Recover()

	// Should recover the alive session
	foundAlive := false
	for _, info := range recovered {
		if info.ID == "recovered-1" {
			foundAlive = true
			if info.Status != StatusRunning {
				t.Errorf("recovered session status = %q, want %q", info.Status, StatusRunning)
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
	m := NewManager(t.TempDir(), t.TempDir())

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
	m := NewManager(t.TempDir(), t.TempDir())
	got := m.generateName("/home/user/project")
	if got != "project" {
		t.Errorf("generateName = %q, want %q", got, "project")
	}
}

func TestManagerGenerateNameRoot(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
	got := m.generateName("/")
	if got != "/" {
		t.Errorf("generateName = %q, want %q", got, "/")
	}
}
