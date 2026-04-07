package relay

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClientConnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"client test"}, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	var output strings.Builder
	var mu sync.Mutex
	client.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client.OnReplayEnd = func() {}

	client.StartReadLoop()

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "client test") {
			break
		}
		select {
		case <-deadline:
			mu.Lock()
			t.Fatalf("timed out; output: %q", output.String())
			mu.Unlock()
		default:
		}
	}
}

func TestClientWrite(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	replayDone := make(chan struct{})
	var output strings.Builder
	var mu sync.Mutex
	client.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client.OnReplayEnd = func() { close(replayDone) }

	client.StartReadLoop()

	select {
	case <-replayDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for replay end")
	}

	client.Write([]byte("input via client\n"))

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "input via client") {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out; output: %q", output.String())
		default:
		}
	}
}

func TestClientResize(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	if err := client.Resize(132, 50); err != nil {
		t.Errorf("Resize: %v", err)
	}
}

func TestClientConnectFailure(t *testing.T) {
	_, err := NewClient("/nonexistent/socket.sock")
	if err == nil {
		t.Error("expected error connecting to nonexistent socket")
	}
}

func TestClientReconnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client1, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient 1: %v", err)
	}
	replayDone := make(chan struct{})
	client1.OnOutput = func(data []byte) {}
	client1.OnReplayEnd = func() { close(replayDone) }
	client1.StartReadLoop()
	<-replayDone

	client1.Write([]byte("persist this\n"))
	time.Sleep(300 * time.Millisecond)
	client1.Close()

	client2, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient 2: %v", err)
	}
	defer client2.Close()

	var output strings.Builder
	var mu sync.Mutex
	replayDone2 := make(chan struct{})
	client2.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client2.OnReplayEnd = func() { close(replayDone2) }
	client2.StartReadLoop()

	select {
	case <-replayDone2:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for replay end")
	}

	mu.Lock()
	got := output.String()
	mu.Unlock()
	if !strings.Contains(got, "persist this") {
		t.Errorf("replayed output = %q, want to contain %q", got, "persist this")
	}
}
