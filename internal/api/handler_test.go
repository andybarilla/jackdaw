package api

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/andybarilla/jackdaw/internal/session"
)

func TestSessionList(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.list", Params: json.RawMessage(`{}`)})
	if !resp.OK {
		t.Fatalf("expected ok: %+v", resp.Error)
	}
	data, _ := json.Marshal(resp.Data)
	var result struct {
		Sessions []session.SessionInfo `json:"sessions"`
	}
	json.Unmarshal(data, &result)
	if len(result.Sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(result.Sessions))
	}
}

func TestSessionGetNotFound(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.get", Params: json.RawMessage(`{"id":"nope"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "not_found" {
		t.Fatalf("expected not_found, got %q", resp.Error.Code)
	}
}

func TestSessionGetMissingID(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.get", Params: json.RawMessage(`{}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

func TestSessionCreateMissingWorkDir(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.create", Params: json.RawMessage(`{}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

func TestSessionCreateWithCreateFunc(t *testing.T) {
	srv, sockPath := startTestServer(t)

	called := false
	srv.CreateFunc = func(workDir, command string, args []string, name, workspaceID string) (*session.SessionInfo, error) {
		called = true
		if workDir != "/tmp/test" {
			t.Errorf("workDir = %q, want /tmp/test", workDir)
		}
		if command != "claude" {
			t.Errorf("command = %q, want claude", command)
		}
		return &session.SessionInfo{
			ID:      "test-123",
			WorkDir: workDir,
			Command: command,
			Name:    "test",
		}, nil
	}

	conn := dial(t, sockPath)
	resp := sendRecv(t, conn, Request{
		Method: "session.create",
		Params: json.RawMessage(`{"work_dir":"/tmp/test"}`),
	})
	if !resp.OK {
		t.Fatalf("expected ok: %+v", resp.Error)
	}
	if !called {
		t.Fatal("CreateFunc was not called")
	}
}

func TestSessionKillNotFound(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.kill", Params: json.RawMessage(`{"id":"nope"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "not_found" {
		t.Fatalf("expected not_found, got %q", resp.Error.Code)
	}
}

func TestSessionRemoveNotFound(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.remove", Params: json.RawMessage(`{"id":"nope"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "not_found" {
		t.Fatalf("expected not_found, got %q", resp.Error.Code)
	}
}

func TestSessionRenameMissingName(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.rename", Params: json.RawMessage(`{"id":"x"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

func TestSessionWriteInvalidBase64(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.write", Params: json.RawMessage(`{"id":"x","input":"!!!"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

func TestSessionResizeInvalidParams(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.resize", Params: json.RawMessage(`{"id":"x","cols":0,"rows":24}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "invalid_params" {
		t.Fatalf("expected invalid_params, got %q", resp.Error.Code)
	}
}

func TestSessionHistoryNotFound(t *testing.T) {
	_, sockPath := startTestServer(t)
	conn := dial(t, sockPath)

	resp := sendRecv(t, conn, Request{Method: "session.history", Params: json.RawMessage(`{"id":"nope"}`)})
	if resp.OK {
		t.Fatal("expected error")
	}
	if resp.Error.Code != "not_found" {
		t.Fatalf("expected not_found, got %q", resp.Error.Code)
	}
}

func TestSessionHistoryEmpty(t *testing.T) {
	srv, sockPath := startTestServer(t)

	// Manually register a session in the manager so GetSessionInfo finds it
	srv.manager.SetOnUpdate(nil)
	// We'll use CreateFunc to make a fake session entry
	srv.CreateFunc = func(workDir, command string, args []string, name, workspaceID string) (*session.SessionInfo, error) {
		return &session.SessionInfo{ID: "hist-test", WorkDir: workDir}, nil
	}

	conn := dial(t, sockPath)
	// Create a session first
	sendRecv(t, conn, Request{Method: "session.create", Params: json.RawMessage(`{"work_dir":"/tmp"}`)})

	// History for this session — the session exists via CreateFunc but manager doesn't know about it
	// so this should return not_found from the history handler's existence check
	resp := sendRecv(t, conn, Request{Method: "session.history", Params: json.RawMessage(`{"id":"hist-test"}`)})
	if resp.OK {
		t.Fatal("expected not_found since session is only in CreateFunc, not manager")
	}
}

func TestErrorMapping(t *testing.T) {
	tests := []struct {
		err  error
		code string
	}{
		{errNotFound("x"), "not_found"},
		{errInvalidParams("x"), "invalid_params"},
		{errInternal("x"), "internal"},
	}
	for _, tt := range tests {
		detail := mapError(tt.err)
		if detail.Code != tt.code {
			t.Errorf("mapError(%v) code = %q, want %q", tt.err, detail.Code, tt.code)
		}
	}
}

func TestRequireString(t *testing.T) {
	_, err := requireString(json.RawMessage(`{"id":"abc"}`), "id")
	if err != nil {
		t.Fatal(err)
	}

	_, err = requireString(json.RawMessage(`{}`), "id")
	if err == nil {
		t.Fatal("expected error for missing field")
	}

	_, err = requireString(json.RawMessage(`{"id":123}`), "id")
	if err == nil {
		t.Fatal("expected error for non-string field")
	}
}

func TestBase64Encoding(t *testing.T) {
	// Verify our base64 round-trip works as expected
	input := "hello world"
	encoded := base64.StdEncoding.EncodeToString([]byte(input))
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != input {
		t.Fatalf("round-trip failed: %q", decoded)
	}
}
