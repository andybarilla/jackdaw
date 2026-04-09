package api

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/andybarilla/jackdaw/internal/session"
)

func init() {
	// Register a test handler so we can verify dispatch works
	handlers["test.echo"] = func(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
		var p map[string]interface{}
		json.Unmarshal(params, &p)
		return p, nil
	}
}

func startTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")
	manifestDir := filepath.Join(dir, "manifests")
	socketDir := filepath.Join(dir, "sockets")
	historyDir := filepath.Join(dir, "history")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)
	os.MkdirAll(historyDir, 0700)

	mgr := session.NewManager(manifestDir, socketDir, historyDir, 0)
	srv := New(mgr, sockPath)
	if err := srv.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() { srv.Stop() })
	return srv, sockPath
}

func dial(t *testing.T, sockPath string) net.Conn {
	t.Helper()
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func sendRecv(t *testing.T, conn net.Conn, req Request) Response {
	t.Helper()
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response")
	}
	var resp Response
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return resp
}

func TestServerEchoHandler(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{
		Method: "test.echo",
		Params: json.RawMessage(`{"hello":"world"}`),
	})
	if !resp.OK {
		t.Fatalf("expected ok=true, got error: %+v", resp.Error)
	}
	data, _ := json.Marshal(resp.Data)
	if string(data) != `{"hello":"world"}` {
		t.Fatalf("unexpected data: %s", data)
	}
}

func TestServerMalformedJSON(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	// Write malformed JSON
	conn.Write([]byte("not json\n"))
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response")
	}
	var resp Response
	json.Unmarshal(scanner.Bytes(), &resp)
	if resp.OK {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != "invalid_request" {
		t.Fatalf("expected code invalid_request, got %q", resp.Error.Code)
	}
}

func TestServerMissingMethod(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Params: json.RawMessage(`{}`)})
	if resp.OK {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != "invalid_request" {
		t.Fatalf("expected code invalid_request, got %q", resp.Error.Code)
	}
}

func TestServerUnknownMethod(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "no.such.method", Params: json.RawMessage(`{}`)})
	if resp.OK {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != "invalid_request" {
		t.Fatalf("expected code invalid_request, got %q", resp.Error.Code)
	}
}

func TestServerMultipleRequests(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	// Send two requests on the same connection
	for i := 0; i < 2; i++ {
		resp := sendRecv(t, conn, Request{
			Method: "test.echo",
			Params: json.RawMessage(`{"n":1}`),
		})
		if !resp.OK {
			t.Fatalf("request %d: expected ok=true", i)
		}
	}
}

func TestServerSocketCleanup(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")
	manifestDir := filepath.Join(dir, "manifests")
	socketDir := filepath.Join(dir, "sockets")
	historyDir := filepath.Join(dir, "history")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)
	os.MkdirAll(historyDir, 0700)

	mgr := session.NewManager(manifestDir, socketDir, historyDir, 0)
	srv := New(mgr, sockPath)
	srv.Start()

	if _, err := os.Stat(sockPath); err != nil {
		t.Fatal("socket file should exist after start")
	}

	srv.Stop()

	if _, err := os.Stat(sockPath); !os.IsNotExist(err) {
		t.Fatal("socket file should be removed after stop")
	}
}
