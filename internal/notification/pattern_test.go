package notification

import (
	"sync"
	"testing"
	"time"
)

func TestPatternMatcherDetectsPermissionPrompt(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")

	pm.Feed([]byte("Do you want to allow this action? [Y/n]"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Type != TypeInputRequired {
		t.Errorf("type = %q, want %q", received[0].Type, TypeInputRequired)
	}
}

func TestPatternMatcherDetectsYesNoPrompt(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")
	pm.Feed([]byte("Continue? [y/N]"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestPatternMatcherDebounces(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")
	pm.DebounceInterval = 200 * time.Millisecond

	pm.Feed([]byte("Continue? [y/N]"))
	pm.Feed([]byte("Continue? [y/N]"))
	pm.Feed([]byte("Continue? [y/N]"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Errorf("expected 1 notification (debounced), got %d", len(received))
	}
}

func TestPatternMatcherNoMatchOnNormalOutput(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	called := false
	svc.OnNotification = func(n Notification) {
		called = true
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")
	pm.Feed([]byte("Building project...\nCompiling 42 files\nDone."))

	time.Sleep(50 * time.Millisecond)
	if called {
		t.Error("should not fire on normal output")
	}
}

func TestPatternMatcherDetectsPasswordPrompt(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")
	pm.Feed([]byte("Enter password: "))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestPatternMatcherStripsANSIWrappedApprovalPrompt(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	pm := NewPatternMatcher(svc, "s1", "my-project")
	pm.Feed([]byte("\x1b[33mApprove action?\x1b[0m"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Type != TypeInputRequired {
		t.Errorf("type = %q, want %q", received[0].Type, TypeInputRequired)
	}
}
