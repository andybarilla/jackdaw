package session

import (
	"testing"
	"time"
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
