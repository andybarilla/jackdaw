package notification

import (
	"sync"
	"testing"
	"time"
)

func TestServiceEmitsNotification(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	svc.Notify(Notification{
		SessionID:   "s1",
		SessionName: "my-project",
		Type:        TypeSessionExited,
		Message:     "Session exited (code 0)",
	})

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Type != TypeSessionExited {
		t.Errorf("type = %q, want %q", received[0].Type, TypeSessionExited)
	}
	if received[0].Timestamp.IsZero() {
		t.Error("expected non-zero timestamp")
	}
}

func TestServiceDisabledDoesNotEmit(t *testing.T) {
	svc := NewService()
	defer svc.Close()
	svc.Enabled = false

	called := false
	svc.OnNotification = func(n Notification) {
		called = true
	}

	svc.Notify(Notification{
		SessionID: "s1",
		Type:      TypeSessionExited,
		Message:   "exited",
	})

	time.Sleep(50 * time.Millisecond)
	if called {
		t.Error("should not emit when disabled")
	}
}

func TestServiceDismissClearsSession(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	count := 0
	svc.OnNotification = func(n Notification) {
		count++
	}

	svc.Notify(Notification{SessionID: "s1", Type: TypeInputRequired, Message: "approve?"})
	time.Sleep(50 * time.Millisecond)

	svc.Dismiss("s1")

	if svc.HasActive("s1") {
		t.Error("expected no active notification after dismiss")
	}
}

func TestServicePreservesResponseFields(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	svc.OnNotification = func(n Notification) {
		received = n
	}

	svc.Notify(Notification{
		SessionID:       "s1",
		SessionName:     "my-project",
		Type:            TypeInputRequired,
		Message:         "Allow Read tool?",
		ApproveResponse: "y\n",
		DenyResponse:    "n\n",
	})

	if received.ApproveResponse != "y\n" {
		t.Errorf("ApproveResponse = %q, want %q", received.ApproveResponse, "y\n")
	}
	if received.DenyResponse != "n\n" {
		t.Errorf("DenyResponse = %q, want %q", received.DenyResponse, "n\n")
	}
}
