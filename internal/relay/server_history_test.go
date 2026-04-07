package relay

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServerWritesHistoryFile(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")
	historyPath := filepath.Join(dir, "test.log")

	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"history test"}, 4096, historyPath, 1048576)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatal("timed out waiting for output")
			default:
				continue
			}
		}
		if typ == FrameReplayEnd {
			break
		}
	}

	// Allow flush
	time.Sleep(200 * time.Millisecond)
	srv.Close()

	data, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(data), "history test") {
		t.Errorf("history file = %q, want to contain %q", string(data), "history test")
	}
}

func TestServerHistoryTruncation(t *testing.T) {
	dir := t.TempDir()
	historyPath := filepath.Join(dir, "test.log")
	maxBytes := int64(100)

	// Pre-fill the history file with 180 bytes (under 2x threshold of 200)
	initial := strings.Repeat("A", 180)
	os.WriteFile(historyPath, []byte(initial), 0600)

	sockPath := filepath.Join(dir, "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, historyPath, maxBytes)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}

	// Drain replay
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil || typ == FrameReplayEnd {
			break
		}
	}

	// Write enough to trigger truncation (180 + 30 = 210 > 200 = 2*100)
	WriteFrame(conn, FrameData, []byte(strings.Repeat("B", 30)+"\n"))
	conn.Close()

	// Allow flush + truncation
	time.Sleep(300 * time.Millisecond)
	srv.Close()

	data, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	if int64(len(data)) > maxBytes+4096 {
		t.Errorf("history file size = %d, want <= %d (max + read buffer headroom)", len(data), maxBytes+4096)
	}
}
