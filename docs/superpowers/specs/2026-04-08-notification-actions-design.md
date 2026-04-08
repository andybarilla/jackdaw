# Notification Actions Design

Quick-approve and deny permission prompts directly from toast notifications, without switching to the session.

## Scope

Only hook-based `input_required` notifications get action buttons. Pattern-matched notifications and session-exit notifications keep their current behavior (Go to session / Dismiss).

## Data Model

### Extended Hook Payload

Two optional fields added to `HookPayload`:

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

### Extended Notification

Same fields propagated to the `Notification` struct:

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

The hook listener defaults empty `approve_response` to `"y\n"` and empty `deny_response` to `"n\n"` for all `input_required` notifications it receives. The notification service and frontend receive the resolved values.

### Frontend Type

```typescript
interface AppNotification {
    sessionID: string;
    sessionName: string;
    type: "session_exited" | "input_required";
    message: string;
    timestamp: string;
    approveResponse?: string;
    denyResponse?: string;
}
```

## Backend: RespondToNotification

New Wails-bound method on `App`:

```go
func (a *App) RespondToNotification(sessionID string, response string) error
```

Sequence:
1. Check active notification exists for `sessionID` — return error if not
2. Write `response` bytes to session PTY via `manager.WriteToSession`
3. Dismiss notification via `notifSvc.Dismiss`

No new types, events, or channels.

## Frontend: Toast UI

When `approveResponse` is present on a notification, the toast renders three buttons:
- **Approve** (primary/accent) — calls `RespondToNotification(sessionID, approveResponse)`, removes from store
- **Deny** (muted/danger) — calls `RespondToNotification(sessionID, denyResponse)`, removes from store
- **Go to session** (tertiary/link) — navigates to session pane, dismisses

No "Dismiss" button in this mode — Approve/Deny dismiss as a side effect, and the auto-dismiss timer handles ignore.

When `approveResponse` is absent, the toast keeps current behavior: "Go to session" and "Dismiss".

Approve/Deny leave the current view undisturbed (no auto-focus of the session).

## Hook Environment

No changes to `BuildClaudeHookEnv`. Claude Code's hook payload is piped via stdin. If Claude Code sends `approve_response`/`deny_response`, they flow through. If not, the hook listener defaults apply.

## Testing

**Go unit tests:**
- Hook payload with/without response fields → correct `Notification` field population
- Default values (`"y\n"` / `"n\n"`) applied by hook listener when fields are empty
- `RespondToNotification`: happy path (write + dismiss), error on missing notification, error on missing session

**Frontend:**
- `svelte-check` for type correctness
- Manual testing for toast button rendering and click behavior
