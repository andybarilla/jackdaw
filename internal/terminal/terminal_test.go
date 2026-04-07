package terminal

import (
	"testing"
	"time"
)

func TestManagerCreateAndList(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if info.ID == "" {
		t.Error("expected non-empty ID")
	}
	if info.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want /tmp", info.WorkDir)
	}
	if info.PID == 0 {
		t.Error("expected non-zero PID")
	}
}

func TestManagerKill(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := m.Kill(info.ID); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	if err := m.Kill(info.ID); err == nil {
		t.Error("expected error killing already-killed terminal")
	}
}

func TestManagerKillNonexistent(t *testing.T) {
	m := NewManager()
	if err := m.Kill("nonexistent"); err == nil {
		t.Error("expected error for nonexistent terminal")
	}
}

func TestManagerWriteAndResize(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := m.Write(info.ID, []byte("echo hello\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	if err := m.Resize(info.ID, 80, 24); err != nil {
		t.Fatalf("Resize: %v", err)
	}
}
