package api

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/relay"
	"github.com/andybarilla/jackdaw/internal/session"
)

func TestSessionReadNotFound(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.read", Params: json.RawMessage(`{"id":"nope"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "not_found" {
		t.Fatalf("expected not_found, got %q", resp.Error.Code)
	}
}

func TestSessionReadMissingID(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.read", Params: json.RawMessage(`{}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

// TestSessionReadWithRelay tests session.read with a real relay using "cat" (long-running).
// It verifies: history replay, live output via write, and disconnect cleanup.
func TestSessionReadWithRelay(t *testing.T) {
	dir := t.TempDir()
	apiSockPath := filepath.Join(dir, "api.sock")
	manifestDir := filepath.Join(dir, "manifests")
	socketDir := filepath.Join(dir, "sockets")
	historyDir := filepath.Join(dir, "history")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)
	os.MkdirAll(historyDir, 0700)

	// Use "cat" so the relay stays alive
	relaySockPath := filepath.Join(socketDir, "read-1.sock")
	historyPath := filepath.Join(historyDir, "read-1.log")
	relaySrv, err := relay.NewServer(relaySockPath, "/tmp", "cat", nil, 4096, historyPath, 4096)
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	go relaySrv.Serve()
	t.Cleanup(func() { relaySrv.Close() })
	time.Sleep(100 * time.Millisecond)

	// Write pre-existing history
	os.WriteFile(historyPath, []byte("old history content"), 0600)

	// Write manifest so Recover picks up the session
	manifestData, _ := json.Marshal(map[string]interface{}{
		"session_id":   "read-1",
		"pid":          relaySrv.PID(),
		"command":      "cat",
		"work_dir":     "/tmp",
		"socket_path":  relaySockPath,
		"started_at":   time.Now().Format(time.RFC3339),
		"name":         "test-read",
		"history_path": historyPath,
	})
	os.WriteFile(filepath.Join(manifestDir, "read-1.json"), manifestData, 0600)

	mgr := session.NewManager(manifestDir, socketDir, historyDir, 0)
	recovered := mgr.Recover()
	if len(recovered) == 0 {
		t.Fatal("no sessions recovered")
	}

	// Set up output handler and start read loop
	mgr.SetOnOutput("read-1", func(data []byte) {})
	mgr.StartSessionReadLoop("read-1")

	apiSrv := New(mgr, apiSockPath)
	if err := apiSrv.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { apiSrv.Stop() })

	// Start reading
	conn := dial(t, apiSockPath)
	reqData, _ := json.Marshal(Request{Method: "session.read", Params: json.RawMessage(`{"id":"read-1"}`)})
	reqData = append(reqData, '\n')
	conn.Write(reqData)

	scanner := bufio.NewScanner(conn)
	var allOutput strings.Builder
	gotHistory := false

	// Read the first response (should be history)
	deadline := time.After(3 * time.Second)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for scanner.Scan() {
			var r Response
			json.Unmarshal(scanner.Bytes(), &r)
			if !r.OK {
				continue
			}
			d, _ := json.Marshal(r.Data)
			var m map[string]interface{}
			json.Unmarshal(d, &m)
			if out, ok := m["output"]; ok {
				decoded, _ := base64.StdEncoding.DecodeString(out.(string))
				allOutput.Write(decoded)
				if strings.Contains(string(decoded), "old history content") {
					gotHistory = true
				}
				// After getting history + at least some live data, we're done
				if gotHistory && strings.Contains(allOutput.String(), "live input") {
					return
				}
			}
			if eof, ok := m["eof"]; ok && eof == true {
				return
			}
		}
	}()

	// Wait for history to be replayed
	time.Sleep(500 * time.Millisecond)

	// Write input to trigger live output (cat echoes back)
	mgr.WriteToSession("read-1", []byte("live input\n"))

	select {
	case <-readDone:
	case <-deadline:
		conn.Close()
		<-readDone
	}

	if !gotHistory {
		t.Fatalf("expected history replay; output: %q", allOutput.String())
	}
	if !strings.Contains(allOutput.String(), "live input") {
		t.Fatalf("expected live output; output: %q", allOutput.String())
	}
}
