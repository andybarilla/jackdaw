package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
)

type HookPayload struct {
	HookEventName    string `json:"hook_event_name"`
	SessionID        string `json:"session_id"`
	NotificationType string `json:"notification_type"`
	Message          string `json:"message"`
	Title            string `json:"title"`
	ApproveResponse  string `json:"approve_response,omitempty"`
	DenyResponse     string `json:"deny_response,omitempty"`
}

type HookListener struct {
	svc      *Service
	listener net.Listener
	server   *http.Server
	sessions map[string]string // jackdaw session ID -> session name
	mu       sync.RWMutex
}

func NewHookListener(svc *Service, addr string) (*HookListener, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	hl := &HookListener{
		svc:      svc,
		listener: ln,
		sessions: make(map[string]string),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/notify/", hl.handleNotify)
	hl.server = &http.Server{Handler: mux}

	return hl, nil
}

func (hl *HookListener) Addr() string {
	return hl.listener.Addr().String()
}

func (hl *HookListener) Serve() error {
	return hl.server.Serve(hl.listener)
}

func (hl *HookListener) Close() error {
	return hl.server.Shutdown(context.Background())
}

func (hl *HookListener) RegisterSession(sessionID string, name string) {
	hl.mu.Lock()
	hl.sessions[sessionID] = name
	hl.mu.Unlock()
}

func (hl *HookListener) UnregisterSession(sessionID string) {
	hl.mu.Lock()
	delete(hl.sessions, sessionID)
	hl.mu.Unlock()
}

func (hl *HookListener) HasSession(sessionID string) bool {
	hl.mu.RLock()
	_, ok := hl.sessions[sessionID]
	hl.mu.RUnlock()
	return ok
}

func (hl *HookListener) handleNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract session ID from path: /notify/<sessionID>
	sessionID := strings.TrimPrefix(r.URL.Path, "/notify/")
	if sessionID == "" {
		http.Error(w, "missing session ID", http.StatusBadRequest)
		return
	}

	hl.mu.RLock()
	name, ok := hl.sessions[sessionID]
	hl.mu.RUnlock()
	if !ok {
		http.Error(w, "unknown session", http.StatusNotFound)
		return
	}

	var payload HookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	message := payload.Message
	if payload.Title != "" {
		message = payload.Title + ": " + payload.Message
	}

	approveResponse := payload.ApproveResponse
	if approveResponse == "" {
		approveResponse = "y\n"
	}
	denyResponse := payload.DenyResponse
	if denyResponse == "" {
		denyResponse = "n\n"
	}

	hl.svc.Notify(Notification{
		SessionID:       sessionID,
		SessionName:     name,
		Type:            TypeInputRequired,
		Message:         message,
		ApproveResponse: approveResponse,
		DenyResponse:    denyResponse,
	})

	w.WriteHeader(http.StatusOK)
}
