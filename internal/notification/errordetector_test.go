package notification

import (
	"sync"
	"testing"
	"time"
)

func TestErrorDetectorDetectsErrorLine(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("error: something went wrong"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Type != TypeErrorDetected {
		t.Errorf("type = %q, want %q", received[0].Type, TypeErrorDetected)
	}
	if received[0].SessionID != "s1" {
		t.Errorf("sessionID = %q, want %q", received[0].SessionID, "s1")
	}
}

func TestErrorDetectorDetectsFatalLine(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("fatal: not a git repository"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorDetectsGoPanic(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("panic: runtime error: index out of range"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorDetectsPythonTraceback(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("Traceback (most recent call last)"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorDetectsNpmError(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("npm ERR! missing script: start"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorDebounces(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.DebounceInterval = 200 * time.Millisecond

	ed.Feed([]byte("error: first"))
	ed.Feed([]byte("error: second"))
	ed.Feed([]byte("error: third"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Errorf("expected 1 notification (debounced), got %d", len(received))
	}
}

func TestErrorDetectorNoMatchOnNormalOutput(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	called := false
	svc.OnNotification = func(n Notification) {
		called = true
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("Building project...\nCompiling 42 files\nDone."))

	time.Sleep(50 * time.Millisecond)
	if called {
		t.Error("should not fire on normal output")
	}
}

func TestErrorDetectorStripsANSIWrappedBuildFailure(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("\x1b[31merror: build failed\x1b[0m\n"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Message != "error: build failed" {
		t.Errorf("message = %q, want %q", received[0].Message, "error: build failed")
	}
}

func TestErrorDetectorMessageContainsMatchedLine(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("panic: nil pointer dereference"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if received[0].Message != "panic: nil pointer dereference" {
		t.Errorf("message = %q, want matched line", received[0].Message)
	}
}

func TestErrorDetectorDetectsBuildFailed(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("Build failed with 3 errors"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorDetectsSegfault(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	ed.Feed([]byte("Segmentation fault (core dumped)"))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
}

func TestErrorDetectorTruncatesLongMessage(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received []Notification
	var mu sync.Mutex
	svc.OnNotification = func(n Notification) {
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
	}

	ed := NewErrorDetector(svc, "s1", "my-project")
	long := "error: " + string(make([]byte, 300))
	ed.Feed([]byte(long))

	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(received))
	}
	if len(received[0].Message) > 200 {
		t.Errorf("message should be truncated, got len=%d", len(received[0].Message))
	}
}
