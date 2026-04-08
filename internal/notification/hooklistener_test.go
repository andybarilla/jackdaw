package notification

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestHookListenerReceivesNotification(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	// Register session name mapping
	hl.RegisterSession("jd-1", "my-project")

	payload := HookPayload{
		HookEventName:    "Notification",
		NotificationType: "permission_prompt",
		Message:          "Allow Read tool on /home/user/file.txt",
		Title:            "Permission Required",
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("http://%s/notify/jd-1", hl.Addr())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].SessionID != "jd-1" {
		t.Errorf("sessionID = %q, want %q", received[0].SessionID, "jd-1")
	}
	if received[0].SessionName != "my-project" {
		t.Errorf("sessionName = %q, want %q", received[0].SessionName, "my-project")
	}
	if received[0].Type != TypeInputRequired {
		t.Errorf("type = %q, want %q", received[0].Type, TypeInputRequired)
	}
}

func TestHookListenerUnknownSession(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	payload := HookPayload{
		HookEventName:    "Notification",
		NotificationType: "permission_prompt",
		Message:          "test",
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("http://%s/notify/unknown-id", hl.Addr())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestHookListenerPassesResponseFields(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = n
		mu.Unlock()
	}

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	hl.RegisterSession("jd-1", "my-project")

	payload := HookPayload{
		HookEventName:    "Notification",
		NotificationType: "permission_prompt",
		Message:          "Allow Read tool?",
		ApproveResponse:  "yes\n",
		DenyResponse:     "no\n",
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("http://%s/notify/jd-1", hl.Addr())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if received.ApproveResponse != "yes\n" {
		t.Errorf("ApproveResponse = %q, want %q", received.ApproveResponse, "yes\n")
	}
	if received.DenyResponse != "no\n" {
		t.Errorf("DenyResponse = %q, want %q", received.DenyResponse, "no\n")
	}
}

func TestHookListenerDefaultsResponseFields(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = n
		mu.Unlock()
	}

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	hl.RegisterSession("jd-1", "my-project")

	payload := HookPayload{
		HookEventName:    "Notification",
		NotificationType: "permission_prompt",
		Message:          "Allow Read tool?",
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("http://%s/notify/jd-1", hl.Addr())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if received.ApproveResponse != "y\n" {
		t.Errorf("ApproveResponse = %q, want %q", received.ApproveResponse, "y\n")
	}
	if received.DenyResponse != "n\n" {
		t.Errorf("DenyResponse = %q, want %q", received.DenyResponse, "n\n")
	}
}

func TestHookListenerNoDefaultsForNonPermissionType(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = n
		mu.Unlock()
	}

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	hl.RegisterSession("jd-1", "my-project")

	payload := HookPayload{
		HookEventName:    "Notification",
		NotificationType: "info",
		Message:          "Task completed",
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("http://%s/notify/jd-1", hl.Addr())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if received.ApproveResponse != "" {
		t.Errorf("ApproveResponse = %q, want empty", received.ApproveResponse)
	}
	if received.DenyResponse != "" {
		t.Errorf("DenyResponse = %q, want empty", received.DenyResponse)
	}
}

func TestHookListenerReportsActiveSession(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	hl, err := NewHookListener(svc, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("NewHookListener: %v", err)
	}
	go hl.Serve()
	defer hl.Close()

	hl.RegisterSession("jd-2", "test-project")
	if !hl.HasSession("jd-2") {
		t.Error("expected session to be registered")
	}

	hl.UnregisterSession("jd-2")
	if hl.HasSession("jd-2") {
		t.Error("expected session to be unregistered")
	}
}
