package session

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewSession(t *testing.T) {
	s, err := New("test-1", "/tmp", "echo", []string{"hello"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	if s.ID != "test-1" {
		t.Errorf("ID = %q, want %q", s.ID, "test-1")
	}
	if s.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want %q", s.WorkDir, "/tmp")
	}
	if s.PID() <= 0 {
		t.Errorf("PID = %d, want > 0", s.PID())
	}
}

func TestSessionOutput(t *testing.T) {
	s, err := New("test-2", "/tmp", "echo", []string{"hello world"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	var output strings.Builder
	var mu sync.Mutex

	s.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}

	s.StartReadLoop()

	done := make(chan struct{})
	go func() {
		s.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for process")
	}

	mu.Lock()
	got := output.String()
	mu.Unlock()

	if !strings.Contains(got, "hello world") {
		t.Errorf("output = %q, want to contain %q", got, "hello world")
	}
}

func TestSessionWrite(t *testing.T) {
	s, err := New("test-3", "/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	var output strings.Builder
	var mu sync.Mutex

	s.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}

	s.StartReadLoop()

	if err := s.Write([]byte("test input\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	got := output.String()
	mu.Unlock()

	if !strings.Contains(got, "test input") {
		t.Errorf("output = %q, want to contain %q", got, "test input")
	}
}

func TestSessionResize(t *testing.T) {
	s, err := New("test-4", "/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	if err := s.Resize(120, 40); err != nil {
		t.Errorf("Resize: %v", err)
	}
}

func TestSessionClose(t *testing.T) {
	s, err := New("test-5", "/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := s.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}

	done := make(chan struct{})
	go func() {
		s.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("process did not exit after Close")
	}
}
