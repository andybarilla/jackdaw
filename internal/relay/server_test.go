package relay

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServerStartAndConnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"hello from relay"}, 4096)
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

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
		}
		if typ == FrameReplayEnd || strings.Contains(output.String(), "hello from relay") {
			break
		}
	}

	if !strings.Contains(output.String(), "hello from relay") {
		t.Errorf("output = %q, want to contain %q", output.String(), "hello from relay")
	}
}

func TestServerReplay(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"replay test"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn1, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial 1: %v", err)
	}
	time.Sleep(500 * time.Millisecond)
	conn1.Close()

	time.Sleep(500 * time.Millisecond)

	conn2, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial 2: %v", err)
	}
	defer conn2.Close()

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn2)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
		}
		if typ == FrameReplayEnd {
			break
		}
	}

	if !strings.Contains(output.String(), "replay test") {
		t.Errorf("replayed output = %q, want to contain %q", output.String(), "replay test")
	}
}

func TestServerInput(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
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

	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil || typ == FrameReplayEnd {
			break
		}
	}

	WriteFrame(conn, FrameData, []byte("echo test\n"))

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
			if strings.Contains(output.String(), "echo test") {
				break
			}
		}
	}

	if !strings.Contains(output.String(), "echo test") {
		t.Errorf("output = %q, want to contain %q", output.String(), "echo test")
	}
}

func TestServerResize(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
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

	err = WriteFrame(conn, FrameResize, EncodeResize(132, 50))
	if err != nil {
		t.Errorf("WriteFrame resize: %v", err)
	}
}

func TestServerSocketCleanup(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"hi"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	if _, err := os.Stat(sockPath); err != nil {
		t.Fatalf("socket should exist: %v", err)
	}

	srv.Close()
	time.Sleep(100 * time.Millisecond)

	if _, err := os.Stat(sockPath); !os.IsNotExist(err) {
		t.Error("socket should be cleaned up after Close")
	}
}
