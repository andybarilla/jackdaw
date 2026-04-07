package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/manifest"
)

func TestManagerCreateAndList(t *testing.T) {
	m := NewManager(t.TempDir())

	info, err := m.Create("/tmp", "echo", []string{"hi"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if info.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if info.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want %q", info.WorkDir, "/tmp")
	}

	sessions := m.List()
	if len(sessions) != 1 {
		t.Errorf("List returned %d sessions, want 1", len(sessions))
	}
}

func TestManagerKill(t *testing.T) {
	m := NewManager(t.TempDir())

	info, err := m.Create("/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := m.Kill(info.ID); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	sessions := m.List()
	for _, s := range sessions {
		if s.ID == info.ID && s.Status == StatusRunning {
			t.Error("session should not be running after Kill")
		}
	}
}

func TestManagerRecover(t *testing.T) {
	dir := t.TempDir()

	// Simulate a prior session that's still running (use current process PID)
	mf := &manifest.Manifest{
		SessionID: "recovered-1",
		PID:       os.Getpid(),
		Command:   "cat",
		Args:      nil,
		WorkDir:   "/tmp",
		StartedAt: time.Now().Add(-10 * time.Minute),
	}
	manifest.Write(filepath.Join(dir, "recovered-1.json"), mf)

	// Simulate a stale session (PID that doesn't exist)
	staleMf := &manifest.Manifest{
		SessionID: "stale-1",
		PID:       999999999,
		Command:   "cat",
		WorkDir:   "/tmp",
		StartedAt: time.Now().Add(-1 * time.Hour),
	}
	manifest.Write(filepath.Join(dir, "stale-1.json"), staleMf)

	m := NewManager(dir)
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
	staleManifest, _ := manifest.Read(filepath.Join(dir, "stale-1.json"))
	if staleManifest != nil {
		t.Error("stale manifest should have been removed")
	}
}

func TestManagerKillNonexistent(t *testing.T) {
	m := NewManager(t.TempDir())
	err := m.Kill("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestManagerManifestWritten(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	info, err := m.Create("/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	defer m.Kill(info.ID)

	manifests, err := m.ListManifests()
	if err != nil {
		t.Fatalf("ListManifests: %v", err)
	}
	if len(manifests) != 1 {
		t.Errorf("expected 1 manifest, got %d", len(manifests))
	}
}
