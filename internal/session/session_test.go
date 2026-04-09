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

func TestOutputFanOut(t *testing.T) {
	sockPath, srv := startTestRelay(t, "echo", []string{"fanout test"})
	defer srv.Close()

	s, err := Reconnect("test-fanout", sockPath, "/tmp", "echo", srv.PID(), time.Now())
	if err != nil {
		t.Fatalf("Reconnect: %v", err)
	}
	defer s.Close()

	var out1, out2 strings.Builder
	var mu1, mu2 sync.Mutex

	// Primary subscriber via OnOutput
	s.OnOutput = func(data []byte) {
		mu1.Lock()
		out1.Write(data)
		mu1.Unlock()
	}

	// Secondary subscriber via AddOutputSub
	subID := s.AddOutputSub(func(data []byte) {
		mu2.Lock()
		out2.Write(data)
		mu2.Unlock()
	})

	s.StartReadLoop()

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(100 * time.Millisecond)
		mu1.Lock()
		got1 := out1.String()
		mu1.Unlock()
		mu2.Lock()
		got2 := out2.String()
		mu2.Unlock()
		if strings.Contains(got1, "fanout test") && strings.Contains(got2, "fanout test") {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out; out1=%q out2=%q", got1, got2)
		default:
		}
	}

	// Remove secondary subscriber, verify it stops receiving
	s.RemoveOutputSub(subID)
}

func TestOutputFanOutRemove(t *testing.T) {
	s := &Session{ID: "test-remove"}
	var received1, received2 []string
	var mu sync.Mutex

	s.AddOutputSub(func(data []byte) {
		mu.Lock()
		received1 = append(received1, string(data))
		mu.Unlock()
	})
	sub2 := s.AddOutputSub(func(data []byte) {
		mu.Lock()
		received2 = append(received2, string(data))
		mu.Unlock()
	})

	s.dispatchOutput([]byte("first"))

	mu.Lock()
	if len(received1) != 1 || len(received2) != 1 {
		t.Fatalf("both should have received: r1=%d r2=%d", len(received1), len(received2))
	}
	mu.Unlock()

	s.RemoveOutputSub(sub2)
	s.dispatchOutput([]byte("second"))

	mu.Lock()
	if len(received1) != 2 {
		t.Fatalf("sub1 should have 2, got %d", len(received1))
	}
	if len(received2) != 1 {
		t.Fatalf("sub2 should still have 1 after removal, got %d", len(received2))
	}
	mu.Unlock()
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
