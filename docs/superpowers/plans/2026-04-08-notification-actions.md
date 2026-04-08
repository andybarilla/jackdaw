# Notification Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approve/deny action buttons to toast notifications for hook-based permission prompts, writing the response directly to the session PTY.

**Architecture:** Extend `HookPayload` and `Notification` with optional response fields. Add `RespondToNotification` method to `App` that validates, writes to PTY, and dismisses. Frontend conditionally renders approve/deny buttons when response fields are present.

**Tech Stack:** Go, Svelte 5 (runes), Wails v2

---

### Task 1: Extend Notification with Response Fields

**Files:**
- Modify: `internal/notification/notification.go:15-21`
- Test: `internal/notification/notification_test.go`

- [ ] **Step 1: Write failing test for response fields on Notification**

Add to `internal/notification/notification_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -run TestServicePreservesResponseFields -v`
Expected: FAIL — `ApproveResponse` and `DenyResponse` fields don't exist on `Notification`.

- [ ] **Step 3: Add response fields to Notification struct**

In `internal/notification/notification.go`, replace the `Notification` struct:

```go
type Notification struct {
	SessionID       string           `json:"sessionID"`
	SessionName     string           `json:"sessionName"`
	Type            NotificationType `json:"type"`
	Message         string           `json:"message"`
	Timestamp       time.Time        `json:"timestamp"`
	ApproveResponse string           `json:"approveResponse,omitempty"`
	DenyResponse    string           `json:"denyResponse,omitempty"`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -run TestServicePreservesResponseFields -v`
Expected: PASS

- [ ] **Step 5: Run all notification tests to check for regressions**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -v`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/notification/notification.go internal/notification/notification_test.go
git commit -m "feat: add ApproveResponse/DenyResponse fields to Notification"
```

---

### Task 2: Extend HookPayload and Apply Defaults

**Files:**
- Modify: `internal/notification/hooklistener.go:13-19,100-118`
- Test: `internal/notification/hooklistener_test.go`

- [ ] **Step 1: Write failing test for hook payload with response fields**

Add to `internal/notification/hooklistener_test.go`:

```go
func TestHookListenerPassesResponseFields(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	svc.OnNotification = func(n Notification) {
		received = n
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
	if received.ApproveResponse != "yes\n" {
		t.Errorf("ApproveResponse = %q, want %q", received.ApproveResponse, "yes\n")
	}
	if received.DenyResponse != "no\n" {
		t.Errorf("DenyResponse = %q, want %q", received.DenyResponse, "no\n")
	}
}
```

- [ ] **Step 2: Write failing test for default response values**

Add to `internal/notification/hooklistener_test.go`:

```go
func TestHookListenerDefaultsResponseFields(t *testing.T) {
	svc := NewService()
	defer svc.Close()

	var received Notification
	svc.OnNotification = func(n Notification) {
		received = n
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

	time.Sleep(50 * time.Millisecond)
	if received.ApproveResponse != "y\n" {
		t.Errorf("ApproveResponse = %q, want %q", received.ApproveResponse, "y\n")
	}
	if received.DenyResponse != "n\n" {
		t.Errorf("DenyResponse = %q, want %q", received.DenyResponse, "n\n")
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -run "TestHookListenerPassesResponseFields|TestHookListenerDefaultsResponseFields" -v`
Expected: FAIL — `ApproveResponse` and `DenyResponse` don't exist on `HookPayload`, and `handleNotify` doesn't set them.

- [ ] **Step 4: Add fields to HookPayload and update handleNotify**

In `internal/notification/hooklistener.go`, replace the `HookPayload` struct:

```go
type HookPayload struct {
	HookEventName    string `json:"hook_event_name"`
	SessionID        string `json:"session_id"`
	NotificationType string `json:"notification_type"`
	Message          string `json:"message"`
	Title            string `json:"title"`
	ApproveResponse  string `json:"approve_response,omitempty"`
	DenyResponse     string `json:"deny_response,omitempty"`
}
```

In `handleNotify`, replace the `hl.svc.Notify(...)` block (lines 111-117) with:

```go
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -run "TestHookListener" -v`
Expected: All `TestHookListener*` tests PASS.

- [ ] **Step 6: Run all notification tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/notification/ -v`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/notification/hooklistener.go internal/notification/hooklistener_test.go
git commit -m "feat: extend HookPayload with response fields and defaults"
```

---

### Task 3: Add RespondToNotification Method

**Files:**
- Modify: `app.go:219`

- [ ] **Step 1: Add the RespondToNotification method**

In `app.go`, add after the `DismissNotification` method (line 221):

```go
func (a *App) RespondToNotification(sessionID string, response string) error {
	if !a.notifSvc.HasActive(sessionID) {
		return fmt.Errorf("no active notification for session %q", sessionID)
	}
	if err := a.manager.WriteToSession(sessionID, []byte(response)); err != nil {
		return fmt.Errorf("write to session: %w", err)
	}
	a.notifSvc.Dismiss(sessionID)
	return nil
}
```

- [ ] **Step 2: Regenerate Wails bindings**

Run: `cd /home/andy/dev/andybarilla/jackdaw && wails generate module`
Expected: `frontend/wailsjs/go/main/App.js` and `App.d.ts` regenerated with `RespondToNotification`.

- [ ] **Step 3: Verify the new binding exists**

Check that `frontend/wailsjs/go/main/App.d.ts` contains:
```typescript
export function RespondToNotification(arg1:string,arg2:string):Promise<void>;
```

- [ ] **Step 4: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/...`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.go frontend/wailsjs/
git commit -m "feat: add RespondToNotification Wails method"
```

---

### Task 4: Update Frontend Types

**Files:**
- Modify: `frontend/src/lib/types.ts:25-31`

- [ ] **Step 1: Add response fields to AppNotification**

In `frontend/src/lib/types.ts`, replace the `AppNotification` interface:

```typescript
export interface AppNotification {
  sessionID: string;
  sessionName: string;
  type: "session_exited" | "input_required";
  message: string;
  timestamp: string;
  approveResponse?: string;
  denyResponse?: string;
}
```

- [ ] **Step 2: Run type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add response fields to AppNotification type"
```

---

### Task 5: Add Action Buttons to Toast UI

**Files:**
- Modify: `frontend/src/lib/ToastContainer.svelte`

- [ ] **Step 1: Import RespondToNotification binding**

In `frontend/src/lib/ToastContainer.svelte`, update the import on line 4:

```typescript
  import { DismissNotification, RespondToNotification } from "../../wailsjs/go/main/App";
```

- [ ] **Step 2: Add the respond handler**

Add after the `handleGoTo` function (after line 51):

```typescript
  async function handleRespond(sessionID: string, response: string): Promise<void> {
    await RespondToNotification(sessionID, response);
    dismissNotification(sessionID);
    if (sessionID in visibleToasts) {
      clearTimeout(visibleToasts[sessionID]);
      const { [sessionID]: _, ...rest } = visibleToasts;
      visibleToasts = rest;
    }
  }
```

- [ ] **Step 3: Update the toast template with conditional buttons**

Replace the `<div class="toast-actions">` block (lines 86-89) with:

```svelte
      <div class="toast-actions">
        {#if notif.approveResponse}
          <button class="toast-btn approve" onclick={() => handleRespond(notif.sessionID, notif.approveResponse!)}>Approve</button>
          <button class="toast-btn deny" onclick={() => handleRespond(notif.sessionID, notif.denyResponse!)}>Deny</button>
          <button class="toast-btn goto" onclick={() => handleGoTo(notif.sessionID)}>Go to session</button>
        {:else}
          <button class="toast-btn go" onclick={() => handleGoTo(notif.sessionID)}>Go to session</button>
          <button class="toast-btn dismiss" onclick={() => handleDismiss(notif.sessionID)}>Dismiss</button>
        {/if}
      </div>
```

- [ ] **Step 4: Add styles for new button classes**

Add after the `.toast-btn.dismiss:hover` rule (after line 178):

```css
  .toast-btn.approve {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .toast-btn.approve:hover {
    opacity: 0.9;
  }

  .toast-btn.deny {
    background: var(--bg-tertiary);
    color: var(--danger, #e06c75);
    border: 1px solid var(--danger, #e06c75);
  }

  .toast-btn.deny:hover {
    background: var(--danger, #e06c75);
    color: var(--bg-primary);
  }

  .toast-btn.goto {
    background: none;
    color: var(--text-secondary);
    text-decoration: underline;
  }

  .toast-btn.goto:hover {
    color: var(--text-primary);
  }
```

- [ ] **Step 5: Run type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: No errors.

- [ ] **Step 6: Run frontend build**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/ToastContainer.svelte
git commit -m "feat: add approve/deny action buttons to toast notifications"
```

---

### Task 6: Integration Verification

- [ ] **Step 1: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/... -v`
Expected: All tests PASS.

- [ ] **Step 2: Run frontend checks**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check && npm run build`
Expected: Both pass with no errors.

- [ ] **Step 3: Build the full app**

Run: `cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

Launch the built app. Create a Claude Code session. Trigger a permission prompt (e.g., ask Claude to read a file). Verify:
1. Toast appears with "Approve", "Deny", and "Go to session" buttons
2. Clicking "Approve" dismisses the toast and the session receives approval
3. Session-exit and pattern-matched notifications still show "Go to session" / "Dismiss"
