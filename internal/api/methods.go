package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"

	"github.com/andybarilla/jackdaw/internal/session"
)

func init() {
	handlers["session.list"] = handleSessionList
	handlers["session.get"] = handleSessionGet
	handlers["session.create"] = handleSessionCreate
	handlers["session.kill"] = handleSessionKill
	handlers["session.remove"] = handleSessionRemove
	handlers["session.rename"] = handleSessionRename
	handlers["session.write"] = handleSessionWrite
	handlers["session.resize"] = handleSessionResize
	handlers["session.history"] = handleSessionHistory
	// session.read is registered in stream.go
}

func handleSessionList(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	sessions := s.manager.List()
	if sessions == nil {
		sessions = []session.SessionInfo{}
	}
	return map[string]interface{}{"sessions": sessions}, nil
}

func handleSessionGet(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	id, err := requireString(params, "id")
	if err != nil {
		return nil, err
	}
	info := s.manager.GetSessionInfo(id)
	if info == nil {
		return nil, errNotFound(fmt.Sprintf("session %q not found", id))
	}
	return info, nil
}

func handleSessionCreate(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	var p struct {
		WorkDir     string   `json:"work_dir"`
		Command     string   `json:"command"`
		Args        []string `json:"args"`
		Name        string   `json:"name"`
		WorkspaceID string   `json:"workspace_id"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, errInvalidParams("invalid params: " + err.Error())
	}
	if p.WorkDir == "" {
		return nil, errInvalidParams("missing required param \"work_dir\"")
	}
	if p.Command == "" {
		p.Command = "claude"
	}

	if s.CreateFunc != nil {
		info, err := s.CreateFunc(p.WorkDir, p.Command, p.Args, p.Name, p.WorkspaceID)
		if err != nil {
			return nil, err
		}
		return info, nil
	}

	// Fallback: create directly via manager (no hooks/notifications)
	id := fmt.Sprintf("%d", timeNow().UnixNano())
	info, err := s.manager.Create(id, p.WorkDir, p.Command, p.Args, nil, nil,
		session.WorktreeOptions{}, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if p.Name != "" {
		s.manager.Rename(info.ID, p.Name)
		info.Name = p.Name
	}
	s.manager.StartSessionReadLoop(info.ID)
	return info, nil
}

func handleSessionKill(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	id, err := requireString(params, "id")
	if err != nil {
		return nil, err
	}
	if err := s.manager.Kill(id); err != nil {
		return nil, err
	}
	return map[string]interface{}{}, nil
}

func handleSessionRemove(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	id, err := requireString(params, "id")
	if err != nil {
		return nil, err
	}
	// Check existence first
	if s.manager.GetSessionInfo(id) == nil {
		return nil, errNotFound(fmt.Sprintf("session %q not found", id))
	}
	s.manager.Remove(id)
	return map[string]interface{}{}, nil
}

func handleSessionRename(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	var p struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, errInvalidParams("invalid params: " + err.Error())
	}
	if p.ID == "" {
		return nil, errInvalidParams("missing required param \"id\"")
	}
	if p.Name == "" {
		return nil, errInvalidParams("missing required param \"name\"")
	}
	if err := s.manager.Rename(p.ID, p.Name); err != nil {
		return nil, err
	}
	return map[string]interface{}{}, nil
}

func handleSessionWrite(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	var p struct {
		ID    string `json:"id"`
		Input string `json:"input"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, errInvalidParams("invalid params: " + err.Error())
	}
	if p.ID == "" {
		return nil, errInvalidParams("missing required param \"id\"")
	}
	if p.Input == "" {
		return nil, errInvalidParams("missing required param \"input\"")
	}
	data, err := base64.StdEncoding.DecodeString(p.Input)
	if err != nil {
		return nil, errInvalidParams("input must be base64-encoded: " + err.Error())
	}
	if err := s.manager.WriteToSession(p.ID, data); err != nil {
		return nil, err
	}
	return map[string]interface{}{}, nil
}

func handleSessionResize(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	var p struct {
		ID   string `json:"id"`
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, errInvalidParams("invalid params: " + err.Error())
	}
	if p.ID == "" {
		return nil, errInvalidParams("missing required param \"id\"")
	}
	if p.Cols <= 0 || p.Rows <= 0 {
		return nil, errInvalidParams("cols and rows must be positive integers")
	}
	if err := s.manager.ResizeSession(p.ID, uint16(p.Cols), uint16(p.Rows)); err != nil {
		return nil, err
	}
	return map[string]interface{}{}, nil
}

func handleSessionHistory(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	id, err := requireString(params, "id")
	if err != nil {
		return nil, err
	}
	// Check session exists
	if s.manager.GetSessionInfo(id) == nil {
		return nil, errNotFound(fmt.Sprintf("session %q not found", id))
	}
	data, err := s.manager.GetSessionHistory(id)
	if err != nil {
		return nil, err
	}
	encoded := ""
	if len(data) > 0 {
		encoded = base64.StdEncoding.EncodeToString(data)
	}
	return map[string]interface{}{"output": encoded}, nil
}
