# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface in-app and desktop notifications when a background session exits or needs user input.

**Architecture:** Central `NotificationService` in `internal/notification/` receives events from three sources (session exit callbacks, Claude Code hook listener, output pattern matcher) and dispatches to two outputs (Wails frontend events for toast/badge UI, OS desktop notifications when app is unfocused).

**Tech Stack:** Go (notification service, TCP hook listener, desktop notifier), Svelte 5 (toast component, sidebar badge), Wails v2 events

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `internal/notification/notification.go` | `Notification` type, `NotificationType` constants, `NotificationService` struct with event dispatch |
| `internal/notification/notification_test.go` | Unit tests for service dispatch, deduplication, dismiss logic |
| `internal/notification/hooklistener.go` | TCP HTTP server that receives Claude Code hook POSTs |
| `internal/notification/hooklistener_test.go` | Tests for hook listener parsing and session ID routing |
| `internal/notification/pattern.go` | Output pattern matcher with debounce |
| `internal/notification/pattern_test.go` | Tests for pattern matching and debounce |
| `internal/notification/desktop.go` | Cross-platform desktop notification dispatch |
| `internal/notification/desktop_test.go` | Tests for notification command construction (not execution) |
| `frontend/src/lib/notifications.svelte.ts` | Svelte notification store |
| `frontend/src/lib/ToastContainer.svelte` | Toast UI component |

### Modified files

| File | Changes |
|------|---------|
| `internal/config/config.go` | Add `NotificationsEnabled`, `DesktopNotifications`, `ToastDurationSeconds` fields |
| `internal/config/config_test.go` | Tests for new config defaults |
| `app.go` | Create `NotificationService`, wire to manager, start hook listener, add `DismissNotification` binding |
| `internal/session/session.go` | Pass hook listener URL via env when spawning relay |
| `frontend/src/App.svelte` | Import `ToastContainer`, listen to `notification-fired` event, wire dismiss |
| `frontend/src/lib/Sidebar.svelte` | Accept `notifications` prop, render badge/pulse on sessions needing attention |
| `frontend/src/lib/types.ts` | Add `Notification` interface |
| `frontend/wailsjs/go/models.ts` | Regenerated (auto) |

---

### Task 1: Config — Add notification settings

**Files:**
- Modify: `internal/config/config.go:10-15`
- Test: `internal/config/config_test.go`

- [ ] **Step 1: Write failing tests for new config defaults**

Add to `internal/config/config_test.go`:

```go
func TestDefaultNotificationSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.NotificationsEnabled {
		t.Error("expected NotificationsEnabled default true")
	}
	if !cfg.DesktopNotifications {
		t.Error("expected DesktopNotifications default true")
	}
	if cfg.ToastDurationSeconds != 5 {
		t.Errorf("expected ToastDurationSeconds default 5, got %d", cfg.ToastDurationSeconds)
	}
}

func TestSaveAndLoadNotificationSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := &Config{
		Theme:                "dark",
		Keybindings:          map[string]string{},
		NotificationsEnabled: false,
		DesktopNotifications: false,
		ToastDurationSeconds: 10,
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if loaded.NotificationsEnabled {
		t.Error("expected NotificationsEnabled false")
	}
	if loaded.DesktopNotifications {
		t.Error("expected DesktopNotifications false")
	}
	if loaded.ToastDurationSeconds != 10 {
		t.Errorf("expected ToastDurationSeconds 10, got %d", loaded.ToastDurationSeconds)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/config/ -run TestDefaultNotification -v`
Expected: FAIL — fields don't exist yet

- [ ] **Step 3: Add notification fields to Config**

In `internal/config/config.go`, update the `Config` struct:

```go
type Config struct {
	Theme                string            `json:"theme"`
	Keybindings          map[string]string `json:"keybindings"`
	Layout               json.RawMessage   `json:"layout,omitempty"`
	HistoryMaxBytes      int               `json:"history_max_bytes,omitempty"`
	NotificationsEnabled bool              `json:"notifications_enabled"`
	DesktopNotifications bool              `json:"desktop_notifications"`
	ToastDurationSeconds int               `json:"toast_duration_seconds,omitempty"`
}
```

Update `Defaults()`:

```go
func Defaults() *Config {
	return &Config{
		Theme:                "whattheflock",
		Keybindings:          map[string]string{},
		HistoryMaxBytes:      1048576,
		NotificationsEnabled: true,
		DesktopNotifications: true,
		ToastDurationSeconds: 5,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/config/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add notification settings with defaults"
```

---

### Task 2: Notification types and service core

**Files:**
- Create: `internal/notification/notification.go`
- Test: `internal/notification/notification_test.go`

- [ ] **Step 1: Write failing tests for notification service**

Create `internal/notification/notification_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/notification/ -v`
Expected: FAIL — package doesn't exist

- [ ] **Step 3: Implement notification types and service**

Create `internal/notification/notification.go`:

```go
package notification

import (
	"sync"
	"time"
)

type NotificationType string

const (
	TypeSessionExited NotificationType = "session_exited"
	TypeInputRequired NotificationType = "input_required"
)

type Notification struct {
	SessionID   string           `json:"sessionID"`
	SessionName string           `json:"sessionName"`
	Type        NotificationType `json:"type"`
	Message     string           `json:"message"`
	Timestamp   time.Time        `json:"timestamp"`
}

type Service struct {
	Enabled        bool
	OnNotification func(Notification)

	active map[string]Notification
	mu     sync.RWMutex
}

func NewService() *Service {
	return &Service{
		Enabled: true,
		active:  make(map[string]Notification),
	}
}

func (s *Service) Notify(n Notification) {
	if !s.Enabled {
		return
	}
	if n.Timestamp.IsZero() {
		n.Timestamp = time.Now()
	}

	s.mu.Lock()
	s.active[n.SessionID] = n
	s.mu.Unlock()

	if s.OnNotification != nil {
		s.OnNotification(n)
	}
}

func (s *Service) Dismiss(sessionID string) {
	s.mu.Lock()
	delete(s.active, sessionID)
	s.mu.Unlock()
}

func (s *Service) HasActive(sessionID string) bool {
	s.mu.RLock()
	_, ok := s.active[sessionID]
	s.mu.RUnlock()
	return ok
}

func (s *Service) ActiveNotifications() map[string]Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]Notification, len(s.active))
	for k, v := range s.active {
		result[k] = v
	}
	return result
}

func (s *Service) Close() {
	s.mu.Lock()
	s.active = make(map[string]Notification)
	s.mu.Unlock()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/notification/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/notification/notification.go internal/notification/notification_test.go
git commit -m "feat(notification): add core service with notify/dismiss/active tracking"
```

---

### Task 3: Hook listener — TCP HTTP server

**Files:**
- Create: `internal/notification/hooklistener.go`
- Test: `internal/notification/hooklistener_test.go`

- [ ] **Step 1: Write failing tests for hook listener**

Create `internal/notification/hooklistener_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/notification/ -run TestHookListener -v`
Expected: FAIL — `NewHookListener` not defined

- [ ] **Step 3: Implement hook listener**

Create `internal/notification/hooklistener.go`:

```go
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

	hl.svc.Notify(Notification{
		SessionID:   sessionID,
		SessionName: name,
		Type:        TypeInputRequired,
		Message:     message,
	})

	w.WriteHeader(http.StatusOK)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/notification/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/notification/hooklistener.go internal/notification/hooklistener_test.go
git commit -m "feat(notification): add TCP hook listener for Claude Code notifications"
```

---

### Task 4: Pattern matcher — fallback detection

**Files:**
- Create: `internal/notification/pattern.go`
- Test: `internal/notification/pattern_test.go`

- [ ] **Step 1: Write failing tests for pattern matcher**

Create `internal/notification/pattern_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/notification/ -run TestPatternMatcher -v`
Expected: FAIL — `NewPatternMatcher` not defined

- [ ] **Step 3: Implement pattern matcher**

Create `internal/notification/pattern.go`:

```go
package notification

import (
	"regexp"
	"sync"
	"time"
)

var inputPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\[Y/n\]`),
	regexp.MustCompile(`\[y/N\]`),
	regexp.MustCompile(`(?i)press enter`),
	regexp.MustCompile(`(?i)continue\?`),
	regexp.MustCompile(`(?i)password:\s*$`),
	regexp.MustCompile(`(?i)passphrase:\s*$`),
	regexp.MustCompile(`(?i)\ballow\b.*\bdeny\b`),
	regexp.MustCompile(`(?i)\bapprove\b`),
}

type PatternMatcher struct {
	svc              *Service
	sessionID        string
	sessionName      string
	DebounceInterval time.Duration

	lastFired time.Time
	mu        sync.Mutex
}

func NewPatternMatcher(svc *Service, sessionID string, sessionName string) *PatternMatcher {
	return &PatternMatcher{
		svc:              svc,
		sessionID:        sessionID,
		sessionName:      sessionName,
		DebounceInterval: 10 * time.Second,
	}
}

func (pm *PatternMatcher) Feed(data []byte) {
	for _, pat := range inputPatterns {
		if pat.Match(data) {
			pm.fire(string(data))
			return
		}
	}
}

func (pm *PatternMatcher) fire(context string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	if now.Sub(pm.lastFired) < pm.DebounceInterval {
		return
	}
	pm.lastFired = now

	pm.svc.Notify(Notification{
		SessionID:   pm.sessionID,
		SessionName: pm.sessionName,
		Type:        TypeInputRequired,
		Message:     "Session may be waiting for input",
	})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/notification/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/notification/pattern.go internal/notification/pattern_test.go
git commit -m "feat(notification): add output pattern matcher with debounce"
```

---

### Task 5: Desktop notifier — cross-platform

**Files:**
- Create: `internal/notification/desktop.go`
- Test: `internal/notification/desktop_test.go`

- [ ] **Step 1: Write failing tests for desktop notifier command building**

Create `internal/notification/desktop_test.go`:

```go
package notification

import (
	"runtime"
	"testing"
)

func TestDesktopNotifierBuildCommand(t *testing.T) {
	dn := &DesktopNotifier{}

	cmd := dn.buildCommand("my-project", "Session exited (code 0)")
	if cmd == nil {
		t.Fatal("expected non-nil command")
	}

	switch runtime.GOOS {
	case "linux":
		if cmd.Path == "" {
			t.Error("expected command path")
		}
		args := cmd.Args
		foundTitle := false
		for _, a := range args {
			if a == "my-project" {
				foundTitle = true
			}
		}
		if !foundTitle {
			t.Errorf("expected title in args, got %v", args)
		}
	case "darwin":
		if cmd.Args[0] != "osascript" {
			t.Errorf("expected osascript, got %s", cmd.Args[0])
		}
	case "windows":
		if cmd.Args[0] != "powershell" {
			t.Errorf("expected powershell, got %s", cmd.Args[0])
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/notification/ -run TestDesktopNotifier -v`
Expected: FAIL — `DesktopNotifier` not defined

- [ ] **Step 3: Implement desktop notifier**

Create `internal/notification/desktop.go`:

```go
package notification

import (
	"fmt"
	"os/exec"
	"runtime"
)

type DesktopNotifier struct {
	Enabled bool
}

func NewDesktopNotifier() *DesktopNotifier {
	return &DesktopNotifier{Enabled: true}
}

func (dn *DesktopNotifier) Send(title string, message string) {
	if !dn.Enabled {
		return
	}
	cmd := dn.buildCommand(title, message)
	if cmd == nil {
		return
	}
	// Fire and forget — don't block on notification delivery
	go cmd.Run()
}

func (dn *DesktopNotifier) buildCommand(title string, message string) *exec.Cmd {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("notify-send", "--app-name=Jackdaw", title, message)
	case "darwin":
		script := fmt.Sprintf(`display notification %q with title %q`, message, title)
		return exec.Command("osascript", "-e", script)
	case "windows":
		script := fmt.Sprintf(
			`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; `+
				`$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); `+
				`$textNodes = $template.GetElementsByTagName('text'); `+
				`$textNodes.Item(0).AppendChild($template.CreateTextNode('%s')) | Out-Null; `+
				`$textNodes.Item(1).AppendChild($template.CreateTextNode('%s')) | Out-Null; `+
				`$toast = [Windows.UI.Notifications.ToastNotification]::new($template); `+
				`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Jackdaw').Show($toast)`,
			title, message,
		)
		return exec.Command("powershell", "-NoProfile", "-Command", script)
	default:
		return nil
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/notification/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/notification/desktop.go internal/notification/desktop_test.go
git commit -m "feat(notification): add cross-platform desktop notifier"
```

---

### Task 6: Wire notification service into app

**Files:**
- Modify: `app.go`
- Modify: `internal/session/session.go:34-60`

- [ ] **Step 1: Add hook URL environment variable to session spawn**

In `internal/session/session.go`, add an `Env` field and pass it to the relay command. Update the `New` function to accept an `env` parameter:

Change the `New` function signature from:
```go
func New(id string, workDir string, command string, args []string, socketDir string, historyPath string, historyMax int64) (*Session, error) {
```
to:
```go
func New(id string, workDir string, command string, args []string, socketDir string, historyPath string, historyMax int64, env []string) (*Session, error) {
```

After building the `relayCmd` but before `relayCmd.Start()`, add:
```go
	relayCmd.Env = append(os.Environ(), env...)
```

- [ ] **Step 2: Update Manager.Create to accept and pass env**

In `internal/session/manager.go`, update the `Create` method signature from:
```go
func (m *Manager) Create(workDir string, command string, args []string, onOutput func([]byte)) (*SessionInfo, error) {
```
to:
```go
func (m *Manager) Create(workDir string, command string, args []string, env []string, onOutput func([]byte)) (*SessionInfo, error) {
```

Update the `New` call inside `Create`:
```go
	s, err := New(id, workDir, command, args, m.socketDir, historyPath, m.historyMaxBytes, env)
```

- [ ] **Step 3: Update all callers of Manager.Create**

In `app.go`, update `CreateSession` to pass the hook URL environment:
```go
func (a *App) CreateSession(workDir string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	id := ""

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/", a.hookListener.Addr())
		// The session ID isn't known yet — we'll register after creation
		env = append(env, fmt.Sprintf("JACKDAW_HOOK_URL=%s", hookURL))
	}

	info, err := a.manager.Create(workDir, "claude", nil, env, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
	})
	if err != nil {
		return nil, err
	}
	id = info.ID

	// Register session with hook listener and set env for Claude Code hooks
	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)

	return info, nil
}
```

- [ ] **Step 4: Add NotificationService and HookListener to App struct**

Update `app.go` — add fields to `App` and wire in `Startup`:

Add to the `App` struct:
```go
type App struct {
	ctx          context.Context
	manager      *session.Manager
	termManager  *terminal.Manager
	configPath   string
	notifSvc     *notification.Service
	hookListener *notification.HookListener
	desktop      *notification.DesktopNotifier
}
```

Add import for the notification package:
```go
	"github.com/andybarilla/jackdaw/internal/notification"
```

In `NewApp()`, after loading config, create the notification service:
```go
	notifSvc := notification.NewService()
	notifSvc.Enabled = cfg.NotificationsEnabled

	desktop := notification.NewDesktopNotifier()
	desktop.Enabled = cfg.DesktopNotifications
```

Return the App with new fields:
```go
	return &App{
		manager:     session.NewManager(manifestDir, socketDir, historyDir, int64(cfg.HistoryMaxBytes)),
		termManager: terminal.NewManager(),
		configPath:  configPath,
		notifSvc:    notifSvc,
		desktop:     desktop,
	}
```

In `Startup()`, start the hook listener and wire callbacks:
```go
	// Start hook listener
	hl, err := notification.NewHookListener(a.notifSvc, "127.0.0.1:0")
	if err == nil {
		a.hookListener = hl
		go hl.Serve()
	}

	// Wire notification outputs
	// Track window focus state — frontend emits this via document.hasFocus()
	windowFocused := true
	runtime.EventsOn(ctx, "window-focus-changed", func(data ...interface{}) {
		if len(data) > 0 {
			if focused, ok := data[0].(bool); ok {
				windowFocused = focused
			}
		}
	})

	a.notifSvc.OnNotification = func(n notification.Notification) {
		runtime.EventsEmit(ctx, "notification-fired", n)
		if !windowFocused {
			a.desktop.Send(n.SessionName, n.Message)
		}
	}
```

Add the `DismissNotification` bound method:
```go
func (a *App) DismissNotification(sessionID string) {
	a.notifSvc.Dismiss(sessionID)
}
```

- [ ] **Step 5: Wire session exit events into notification service**

In `app.go`, update the `SetOnUpdate` callback inside `Startup()` to detect exit transitions:

```go
	var prevStatuses map[string]session.Status

	a.manager.SetOnUpdate(func(sessions []session.SessionInfo) {
		runtime.EventsEmit(ctx, "sessions-updated", sessions)

		// Detect session exits
		currentStatuses := make(map[string]session.Status, len(sessions))
		for _, s := range sessions {
			currentStatuses[s.ID] = s.Status
			if prevStatuses != nil {
				prev, existed := prevStatuses[s.ID]
				if existed && prev == session.StatusRunning && s.Status == session.StatusExited {
					msg := fmt.Sprintf("Session exited (code %d)", s.ExitCode)
					a.notifSvc.Notify(notification.Notification{
						SessionID:   s.ID,
						SessionName: s.Name,
						Type:        notification.TypeSessionExited,
						Message:     msg,
					})
				}
			}
		}
		prevStatuses = currentStatuses
	})
```

- [ ] **Step 6: Clean up hook listener on shutdown**

In `Shutdown()`:
```go
func (a *App) Shutdown(ctx context.Context) {
	if a.hookListener != nil {
		a.hookListener.Close()
	}
	a.notifSvc.Close()
	a.termManager.CloseAll()
}
```

- [ ] **Step 7: Fix session_test.go — update New() and Create() call sites**

In `internal/session/session_test.go`, if `New()` is called directly, add the `env` parameter:
```go
// Any call like: New(id, workDir, command, args, socketDir, historyPath, historyMax)
// becomes:       New(id, workDir, command, args, socketDir, historyPath, historyMax, nil)
```

In `internal/session/manager_test.go`, if `Create()` is called, add `nil` for the env parameter.

- [ ] **Step 8: Run all Go tests**

Run: `go test ./internal/... -v`
Expected: ALL PASS

- [ ] **Step 9: Regenerate Wails bindings**

Run: `wails generate module`

This regenerates `frontend/wailsjs/go/main/App.js` and `frontend/wailsjs/go/models.ts` to include the new `DismissNotification` method.

- [ ] **Step 10: Commit**

```bash
git add app.go internal/session/session.go internal/session/manager.go internal/session/session_test.go internal/session/manager_test.go frontend/wailsjs/
git commit -m "feat: wire notification service into app with hook listener and exit detection"
```

---

### Task 7: Frontend — notification store and types

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/notifications.svelte.ts`

- [ ] **Step 1: Add Notification type**

In `frontend/src/lib/types.ts`, add:

```typescript
export interface AppNotification {
  sessionID: string;
  sessionName: string;
  type: "session_exited" | "input_required";
  message: string;
  timestamp: string;
}
```

- [ ] **Step 2: Create notification store**

Create `frontend/src/lib/notifications.svelte.ts`:

```typescript
import type { AppNotification } from "./types";

let notifications = $state<Record<string, AppNotification>>({});

export function getNotifications(): Record<string, AppNotification> {
  return notifications;
}

export function addNotification(n: AppNotification): void {
  notifications = { ...notifications, [n.sessionID]: n };
}

export function dismissNotification(sessionID: string): void {
  const { [sessionID]: _, ...rest } = notifications;
  notifications = rest;
}

export function hasNotification(sessionID: string): boolean {
  return sessionID in notifications;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/notifications.svelte.ts
git commit -m "feat(frontend): add notification types and reactive store"
```

---

### Task 8: Frontend — ToastContainer component

**Files:**
- Create: `frontend/src/lib/ToastContainer.svelte`

- [ ] **Step 1: Create ToastContainer component**

Create `frontend/src/lib/ToastContainer.svelte`:

```svelte
<script lang="ts">
  import type { AppNotification } from "./types";
  import { getNotifications, dismissNotification } from "./notifications.svelte";
  import { DismissNotification } from "../../wailsjs/go/main/App";

  interface Props {
    toastDuration: number;
    onGoToSession: (sessionID: string) => void;
  }

  let { toastDuration, onGoToSession }: Props = $props();

  let visibleToasts = $state<Record<string, ReturnType<typeof setTimeout>>>({});
  let hoveredToasts = $state<Set<string>>(new Set());
  let notifications = $derived(getNotifications());

  // Track new notifications and set auto-dismiss timers
  $effect(() => {
    for (const sessionID of Object.keys(notifications)) {
      if (!(sessionID in visibleToasts)) {
        const timer = setTimeout(() => {
          handleDismiss(sessionID);
        }, toastDuration * 1000);
        visibleToasts = { ...visibleToasts, [sessionID]: timer };
      }
    }
    // Clean up timers for dismissed notifications
    for (const sessionID of Object.keys(visibleToasts)) {
      if (!(sessionID in notifications)) {
        clearTimeout(visibleToasts[sessionID]);
        const { [sessionID]: _, ...rest } = visibleToasts;
        visibleToasts = rest;
      }
    }
  });

  function handleDismiss(sessionID: string): void {
    if (hoveredToasts.has(sessionID)) return;
    dismissNotification(sessionID);
    DismissNotification(sessionID);
    if (sessionID in visibleToasts) {
      clearTimeout(visibleToasts[sessionID]);
      const { [sessionID]: _, ...rest } = visibleToasts;
      visibleToasts = rest;
    }
  }

  function handleGoTo(sessionID: string): void {
    onGoToSession(sessionID);
    handleDismiss(sessionID);
  }

  function handleMouseEnter(sessionID: string): void {
    hoveredToasts = new Set([...hoveredToasts, sessionID]);
    if (sessionID in visibleToasts) {
      clearTimeout(visibleToasts[sessionID]);
    }
  }

  function handleMouseLeave(sessionID: string): void {
    const next = new Set(hoveredToasts);
    next.delete(sessionID);
    hoveredToasts = next;
    const timer = setTimeout(() => {
      handleDismiss(sessionID);
    }, toastDuration * 1000);
    visibleToasts = { ...visibleToasts, [sessionID]: timer };
  }
</script>

<div class="toast-container">
  {#each Object.values(notifications) as notif (notif.sessionID)}
    <div
      class="toast"
      class:exited={notif.type === "session_exited"}
      class:input={notif.type === "input_required"}
      role="alert"
      onmouseenter={() => handleMouseEnter(notif.sessionID)}
      onmouseleave={() => handleMouseLeave(notif.sessionID)}
    >
      <div class="toast-header">
        <span class="toast-icon">{notif.type === "session_exited" ? "⏹" : "⏳"}</span>
        <span class="toast-title">{notif.sessionName}</span>
      </div>
      <div class="toast-message">{notif.message}</div>
      <div class="toast-actions">
        <button class="toast-btn go" onclick={() => handleGoTo(notif.sessionID)}>Go to session</button>
        <button class="toast-btn dismiss" onclick={() => handleDismiss(notif.sessionID)}>Dismiss</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 280px;
    max-width: 360px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.2s ease-out;
  }

  .toast.input {
    border-color: var(--warning);
  }

  .toast.exited {
    border-color: var(--text-muted);
  }

  .toast-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .toast-icon {
    font-size: 14px;
  }

  .toast-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .toast-message {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .toast-actions {
    display: flex;
    gap: 8px;
  }

  .toast-btn {
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .toast-btn.go {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .toast-btn.go:hover {
    opacity: 0.9;
  }

  .toast-btn.dismiss {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .toast-btn.dismiss:hover {
    color: var(--text-primary);
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/ToastContainer.svelte
git commit -m "feat(frontend): add ToastContainer component with auto-dismiss and hover pause"
```

---

### Task 9: Frontend — wire notifications into App.svelte and Sidebar

**Files:**
- Modify: `frontend/src/App.svelte`
- Modify: `frontend/src/lib/Sidebar.svelte`

- [ ] **Step 1: Wire notification event listener and ToastContainer into App.svelte**

In `frontend/src/App.svelte`, add imports:

```typescript
import { EventsOn, EventsEmit } from "../wailsjs/runtime/runtime";
import ToastContainer from "./lib/ToastContainer.svelte";
import { addNotification, dismissNotification } from "./lib/notifications.svelte";
import { DismissNotification } from "../wailsjs/go/main/App";
import type { AppNotification } from "./lib/types";
```

Note: `EventsEmit` may already be imported if other code uses it — just ensure it's in the import list.

In the `onMount` block, add the notification event listener and window focus tracking:

```typescript
    const cancelNotification = EventsOn("notification-fired", (data: unknown) => {
      const notif = data as AppNotification;
      addNotification(notif);
    });
    cleanups.push(cancelNotification);

    // Track window focus for desktop notification gating
    const handleFocus = () => EventsEmit("window-focus-changed", true);
    const handleBlur = () => EventsEmit("window-focus-changed", false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    cleanups.push(() => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    });
```

Update `handleSidebarSelect` to dismiss notifications when navigating to a session — add at the top of the function:

```typescript
  function handleSidebarSelect(id: string): void {
    // Dismiss any active notification for this session
    dismissNotification(id);
    DismissNotification(id);

    // existing code follows...
```

Add `handleGoToSession` for the toast:

```typescript
  function handleGoToSession(sessionID: string): void {
    handleSidebarSelect(sessionID);
  }
```

Add `ToastContainer` to the template, after the closing `</main>` tag:

```svelte
<ToastContainer toastDuration={5} onGoToSession={handleGoToSession} />
```

Note: The `toastDuration` should ideally come from config. For now hardcode 5; we can load it from config in a follow-up. Or, if `loadConfig` is already called, thread it through.

- [ ] **Step 2: Add notification badge to Sidebar**

In `frontend/src/lib/Sidebar.svelte`, add a prop for notifications and import:

```typescript
import { hasNotification } from "./notifications.svelte";
```

In the template, after the `status-dot` span, add a badge indicator. Update the session-item div to include a notification class:

```svelte
      <div
        class="session-item"
        class:active={session.id === activeSessionId}
        class:attention={hasNotification(session.id)}
        onclick={() => onSelect(session.id)}
        ...
      >
        <span
          class="status-dot"
          class:pulse={hasNotification(session.id)}
          style="background: {hasNotification(session.id) ? 'var(--warning)' : statusColor(session.status)}"
        ></span>
```

After the kill button (inside the session-item), add a badge:

```svelte
        {#if hasNotification(session.id)}
          <span class="attention-badge">!</span>
        {/if}
```

Add CSS for the new classes:

```css
  .session-item.attention {
    background: rgba(251, 146, 60, 0.1);
  }

  .status-dot.pulse {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .attention-badge {
    background: var(--warning);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
```

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.svelte frontend/src/lib/Sidebar.svelte
git commit -m "feat(frontend): wire notification events into App and add sidebar attention badges"
```

---

### Task 10: Wire pattern matcher for non-hook sessions

**Files:**
- Modify: `app.go`
- Modify: `internal/session/manager.go`

- [ ] **Step 1: Add pattern matcher activation to session output flow**

In `app.go`, add pattern matcher tracking. Add a field to `App`:

```go
	patternMatchers map[string]*notification.PatternMatcher
```

Initialize in `NewApp`:

```go
	patternMatchers: make(map[string]*notification.PatternMatcher),
```

In `CreateSession`, after starting the read loop, create a pattern matcher and wire it into the output callback. The pattern matcher should be activated only if no hook message arrives within 5 seconds.

Update the `CreateSession` method — after `a.manager.StartSessionReadLoop(info.ID)`:

```go
	// Start pattern matcher as fallback (activates after 5s if no hook received)
	pm := notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)
	a.patternMatchers[info.ID] = pm

	// Wire pattern matcher into output stream
	a.manager.SetOnOutput(info.ID, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+info.ID, string(data))
		// Only feed pattern matcher if no hook is registered for this session
		if a.hookListener == nil || !a.hookListener.HasSession(info.ID) {
			pm.Feed(data)
		}
	})
```

Wait — this overwrites the output callback set in `Create`. Looking at the code, the `Create` method already sets `OnOutput` via the `onOutput` parameter, and `SetOnOutput` overwrites it. So we should modify the existing approach.

Instead, update `CreateSession` to incorporate the pattern matcher in the original output callback:

```go
func (a *App) CreateSession(workDir string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	id := ""

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/", a.hookListener.Addr())
		env = append(env, fmt.Sprintf("JACKDAW_HOOK_URL=%s", hookURL))
	}

	info, err := a.manager.Create(workDir, "claude", nil, env, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		// Feed pattern matcher if no hook registered
		if pm, ok := a.patternMatchers[id]; ok {
			if a.hookListener == nil || !a.hookListener.HasSession(id) {
				pm.Feed(data)
			}
		}
	})
	if err != nil {
		return nil, err
	}
	id = info.ID

	// Create pattern matcher for this session
	a.patternMatchers[info.ID] = notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)

	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)
	return info, nil
}
```

- [ ] **Step 2: Clean up pattern matcher on session kill**

In `KillSession`:

```go
func (a *App) KillSession(id string) error {
	delete(a.patternMatchers, id)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(id)
	}
	return a.manager.Kill(id)
}
```

- [ ] **Step 3: Run all Go tests**

Run: `go test ./internal/... -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add app.go
git commit -m "feat: wire pattern matcher fallback for non-hook sessions"
```

---

### Task 11: Integration — build and smoke test

- [ ] **Step 1: Run full Go test suite**

Run: `go test ./internal/... -v`
Expected: ALL PASS

- [ ] **Step 2: Run frontend checks**

Run: `cd frontend && npm run check && npm run build`
Expected: No errors

- [ ] **Step 3: Build the app**

Run: `GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: Build succeeds

- [ ] **Step 4: Commit any remaining fixes**

If any build/type errors needed fixing, commit them:

```bash
git add -A
git commit -m "fix: address build issues from notifications integration"
```

---

### Task 12: Configure Claude Code hooks via environment

**Files:**
- Modify: `internal/session/session.go`

The `JACKDAW_HOOK_URL` env var alone isn't enough — Claude Code needs its hooks configured to POST to that URL. The hook configuration should be passed via the `CLAUDE_CODE_HOOKS` environment variable.

- [ ] **Step 1: Write test for hook env generation**

Add to `internal/session/session_test.go`:

```go
func TestBuildClaudeHookEnv(t *testing.T) {
	env := BuildClaudeHookEnv("http://127.0.0.1:54321/notify/session-1")
	if env == "" {
		t.Fatal("expected non-empty env string")
	}

	// Should be valid JSON when parsed
	var hooks map[string]interface{}
	// The env var value should be parseable
	parts := strings.SplitN(env, "=", 2)
	if parts[0] != "CLAUDE_CODE_HOOKS" {
		t.Errorf("key = %q, want CLAUDE_CODE_HOOKS", parts[0])
	}
	if err := json.Unmarshal([]byte(parts[1]), &hooks); err != nil {
		t.Fatalf("invalid JSON: %v\nvalue: %s", err, parts[1])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/session/ -run TestBuildClaudeHookEnv -v`
Expected: FAIL — `BuildClaudeHookEnv` not defined

- [ ] **Step 3: Implement hook env builder**

In `internal/session/session.go`, add:

```go
func BuildClaudeHookEnv(hookURL string) string {
	hookConfig := map[string]interface{}{
		"hooks": map[string]interface{}{
			"Notification": []map[string]interface{}{
				{
					"type":    "command",
					"command": fmt.Sprintf("curl -s -X POST -H 'Content-Type: application/json' -d @- '%s'", hookURL),
				},
			},
		},
	}
	data, _ := json.Marshal(hookConfig)
	return "CLAUDE_CODE_HOOKS=" + string(data)
}
```

- [ ] **Step 4: Update app.go to use BuildClaudeHookEnv**

In `app.go` `CreateSession`, replace the `JACKDAW_HOOK_URL` env with the proper hook config. But we need the session ID for the URL, which we don't have yet. So we generate a preliminary ID:

Actually, looking at the flow: the manager generates the ID inside `Create`. We need the ID to build the URL but don't have it yet. Two options: (a) pre-generate the ID, or (b) register the hook URL after creation using a wildcard.

Better approach: add a method to Manager to let the caller supply the ID, or have Create return the ID early. Simplest: pre-generate the ID in `CreateSession` and pass it to `Create`:

Update `Manager.Create` to accept an optional `id` parameter:

```go
func (m *Manager) Create(id string, workDir string, command string, args []string, env []string, onOutput func([]byte)) (*SessionInfo, error) {
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}
```

Then in `app.go`:

```go
func (a *App) CreateSession(workDir string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/%s", a.hookListener.Addr(), id)
		env = append(env, session.BuildClaudeHookEnv(hookURL))
	}

	info, err := a.manager.Create(id, workDir, "claude", nil, env, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		if pm, ok := a.patternMatchers[id]; ok {
			if a.hookListener == nil || !a.hookListener.HasSession(id) {
				pm.Feed(data)
			}
		}
	})
	if err != nil {
		return nil, err
	}

	a.patternMatchers[info.ID] = notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)

	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)
	return info, nil
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/... -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add internal/session/session.go internal/session/session_test.go app.go internal/session/manager.go
git commit -m "feat: configure Claude Code notification hooks via environment"
```

---

### Task 13: Load toast duration from config in frontend

**Files:**
- Modify: `frontend/src/lib/config.svelte.ts`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Expose toast duration from config**

In `frontend/src/lib/config.svelte.ts`, add:

```typescript
let toastDuration = $state(5);

export function getToastDuration(): number {
  return toastDuration;
}
```

In `loadConfig()`, add:

```typescript
  toastDuration = cfg.toast_duration_seconds || 5;
```

- [ ] **Step 2: Use config value in App.svelte**

In `frontend/src/App.svelte`, import and use:

```typescript
import { getKeymap, getToastDuration } from "./lib/config.svelte";
```

Update the `ToastContainer` in the template:

```svelte
<ToastContainer toastDuration={getToastDuration()} onGoToSession={handleGoToSession} />
```

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/config.svelte.ts frontend/src/App.svelte
git commit -m "feat(frontend): load toast duration from config"
```

---

### Task 14: Final build and verification

- [ ] **Step 1: Run all Go tests**

Run: `go test ./internal/... -v`
Expected: ALL PASS

- [ ] **Step 2: Run frontend checks and build**

Run: `cd frontend && npm run check && npm run build`
Expected: No errors

- [ ] **Step 3: Build the full app**

Run: `GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

Launch the app and verify:
1. Create a new session — should work normally
2. Kill a session — should see a toast notification and sidebar badge
3. Toast should auto-dismiss after 5 seconds
4. Hovering the toast should pause the timer
5. Clicking "Go to session" should navigate to that session's pane
6. Sidebar badge should appear on sessions needing attention
7. Navigating to a session should clear its badge

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final adjustments from smoke testing"
```
