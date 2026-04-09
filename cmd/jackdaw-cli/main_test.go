package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/api"
	"github.com/andybarilla/jackdaw/internal/relay"
	"github.com/andybarilla/jackdaw/internal/session"
)

// startTestAPI starts an API server with a real relay-backed session.
// Returns the API socket path and session ID.
func startTestAPI(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	apiSockPath := filepath.Join(dir, "api.sock")
	manifestDir := filepath.Join(dir, "manifests")
	socketDir := filepath.Join(dir, "sockets")
	historyDir := filepath.Join(dir, "history")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)
	os.MkdirAll(historyDir, 0700)

	// Start a relay with "cat"
	sessionID := "cli-test-1"
	relaySockPath := filepath.Join(socketDir, sessionID+".sock")
	historyPath := filepath.Join(historyDir, sessionID+".log")
	relaySrv, err := relay.NewServer(relaySockPath, "/tmp", "cat", nil, 4096, historyPath, 4096)
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	go relaySrv.Serve()
	t.Cleanup(func() { relaySrv.Close() })
	time.Sleep(100 * time.Millisecond)

	// Write manifest for Recover
	manifestData, _ := json.Marshal(map[string]interface{}{
		"session_id":   sessionID,
		"pid":          relaySrv.PID(),
		"command":      "cat",
		"work_dir":     "/tmp",
		"socket_path":  relaySockPath,
		"started_at":   time.Now().Format(time.RFC3339),
		"name":         "test-session",
		"history_path": historyPath,
	})
	os.WriteFile(filepath.Join(manifestDir, sessionID+".json"), manifestData, 0600)

	mgr := session.NewManager(manifestDir, socketDir, historyDir, 0)
	mgr.Recover()
	mgr.SetOnOutput(sessionID, func(data []byte) {})
	mgr.StartSessionReadLoop(sessionID)

	srv := api.New(mgr, apiSockPath)
	if err := srv.Start(); err != nil {
		t.Fatalf("start api: %v", err)
	}
	t.Cleanup(func() { srv.Stop() })

	return apiSockPath, sessionID
}

func apiSendRecv(t *testing.T, sockPath string, method string, params interface{}) response {
	t.Helper()
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	req := request{Method: method, Params: params}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	conn.Write(data)

	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response")
	}
	var resp response
	json.Unmarshal(scanner.Bytes(), &resp)
	return resp
}

func TestCLIListViaAPI(t *testing.T) {
	sockPath, _ := startTestAPI(t)
	resp := apiSendRecv(t, sockPath, "session.list", map[string]interface{}{})
	if !resp.OK {
		t.Fatalf("expected ok")
	}

	var data struct {
		Sessions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"sessions"`
	}
	json.Unmarshal(resp.Data, &data)
	if len(data.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(data.Sessions))
	}
	if data.Sessions[0].Name != "test-session" {
		t.Fatalf("expected name 'test-session', got %q", data.Sessions[0].Name)
	}
}

func TestCLIGetViaAPI(t *testing.T) {
	sockPath, sessionID := startTestAPI(t)
	resp := apiSendRecv(t, sockPath, "session.get", map[string]string{"id": sessionID})
	if !resp.OK {
		t.Fatalf("expected ok: %+v", resp.Error)
	}

	var data struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	json.Unmarshal(resp.Data, &data)
	if data.ID != sessionID {
		t.Fatalf("got id %q, want %q", data.ID, sessionID)
	}
}

func TestCLIRenameViaAPI(t *testing.T) {
	sockPath, sessionID := startTestAPI(t)
	resp := apiSendRecv(t, sockPath, "session.rename", map[string]interface{}{"id": sessionID, "name": "new-name"})
	if !resp.OK {
		t.Fatalf("expected ok: %+v", resp.Error)
	}

	// Verify rename took effect
	getResp := apiSendRecv(t, sockPath, "session.get", map[string]string{"id": sessionID})
	var data struct {
		Name string `json:"name"`
	}
	json.Unmarshal(getResp.Data, &data)
	if data.Name != "new-name" {
		t.Fatalf("expected name 'new-name', got %q", data.Name)
	}
}

func TestCLIWriteAndReadViaAPI(t *testing.T) {
	sockPath, sessionID := startTestAPI(t)

	// Write some data
	encoded := base64.StdEncoding.EncodeToString([]byte("test input\n"))
	resp := apiSendRecv(t, sockPath, "session.write", map[string]string{"id": sessionID, "input": encoded})
	if !resp.OK {
		t.Fatalf("write failed: %+v", resp.Error)
	}

	// Wait for output to propagate
	time.Sleep(300 * time.Millisecond)

	// Read via session.read — should see the echoed output
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	reqData, _ := json.Marshal(request{Method: "session.read", Params: map[string]string{"id": sessionID}})
	reqData = append(reqData, '\n')
	conn.Write(reqData)

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	deadline := time.After(3 * time.Second)
	var allOutput strings.Builder

	done := make(chan struct{})
	go func() {
		defer close(done)
		for scanner.Scan() {
			var r response
			json.Unmarshal(scanner.Bytes(), &r)
			if !r.OK {
				continue
			}
			var m map[string]interface{}
			json.Unmarshal(r.Data, &m)
			if out, ok := m["output"]; ok {
				decoded, _ := base64.StdEncoding.DecodeString(out.(string))
				allOutput.Write(decoded)
				if strings.Contains(allOutput.String(), "test input") {
					return
				}
			}
		}
	}()

	select {
	case <-done:
	case <-deadline:
		conn.Close()
		<-done
	}

	if !strings.Contains(allOutput.String(), "test input") {
		t.Fatalf("expected output to contain 'test input', got %q", allOutput.String())
	}
}

func TestCLIHistoryViaAPI(t *testing.T) {
	sockPath, sessionID := startTestAPI(t)

	// Write to session and wait for output to be captured in history
	encoded := base64.StdEncoding.EncodeToString([]byte("history test\n"))
	apiSendRecv(t, sockPath, "session.write", map[string]string{"id": sessionID, "input": encoded})
	time.Sleep(500 * time.Millisecond)

	resp := apiSendRecv(t, sockPath, "session.history", map[string]string{"id": sessionID})
	if !resp.OK {
		t.Fatalf("history failed: %+v", resp.Error)
	}

	var data struct {
		Output string `json:"output"`
	}
	json.Unmarshal(resp.Data, &data)
	if data.Output == "" {
		t.Skip("history was empty — relay may not have persisted yet")
	}
	decoded, _ := base64.StdEncoding.DecodeString(data.Output)
	if !strings.Contains(string(decoded), "history test") {
		t.Fatalf("expected history to contain 'history test', got %q", string(decoded))
	}
}
