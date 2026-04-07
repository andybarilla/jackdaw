package session

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/relay"
)

func startTestRelay(t *testing.T, command string, args []string) (string, *relay.Server) {
	t.Helper()
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", command, args, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)
	return sockPath, srv
}

func TestReconnectSession(t *testing.T) {
	sockPath, srv := startTestRelay(t, "echo", []string{"hello"})
	defer srv.Close()

	s, err := Reconnect("test-1", sockPath, "/tmp", "echo", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
	}
	defer s.Close()

	if s.ID != "test-1" {
		t.Errorf("ID = %q, want %q", s.ID, "test-1")
	}
	if s.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want %q", s.WorkDir, "/tmp")
	}
	if s.SocketPath != sockPath {
		t.Errorf("SocketPath = %q, want %q", s.SocketPath, sockPath)
	}
	if s.PID() <= 0 {
		t.Errorf("PID = %d, want > 0", s.PID())
	}
}

func TestSessionOutput(t *testing.T) {
	sockPath, srv := startTestRelay(t, "echo", []string{"hello world"})
	defer srv.Close()

	s, err := Reconnect("test-2", sockPath, "/tmp", "echo", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
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

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(100 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "hello world") {
			break
		}
		select {
		case <-deadline:
			mu.Lock()
			t.Fatalf("timed out; output so far: %q", output.String())
			mu.Unlock()
		default:
		}
	}
}

func TestSessionWrite(t *testing.T) {
	sockPath, srv := startTestRelay(t, "cat", nil)
	defer srv.Close()

	s, err := Reconnect("test-3", sockPath, "/tmp", "cat", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
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

	// Wait for replay to finish
	time.Sleep(200 * time.Millisecond)

	if err := s.Write([]byte("test input\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(100 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "test input") {
			break
		}
		select {
		case <-deadline:
			mu.Lock()
			t.Fatalf("timed out; output so far: %q", output.String())
			mu.Unlock()
		default:
		}
	}
}

func TestSessionResize(t *testing.T) {
	sockPath, srv := startTestRelay(t, "cat", nil)
	defer srv.Close()

	s, err := Reconnect("test-4", sockPath, "/tmp", "cat", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
	}
	defer s.Close()

	if err := s.Resize(120, 40); err != nil {
		t.Errorf("Resize: %v", err)
	}
}

func TestSessionClose(t *testing.T) {
	sockPath, srv := startTestRelay(t, "cat", nil)
	defer srv.Close()

	s, err := Reconnect("test-5", sockPath, "/tmp", "cat", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
	}

	if err := s.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
}
