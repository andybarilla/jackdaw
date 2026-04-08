# Error Detection

Detect errors, failures, and anomalies in background session terminal output and surface them as notifications.

## Goal

When a session is running in the background (not the active tab), automatically detect error patterns in its output and notify the user so they can investigate.

## Design

### New notification type

Add `"error_detected"` to `NotificationType`. Error notifications behave like existing notifications — they appear as toasts, trigger desktop notifications when the window is unfocused, and clicking "Go to session" switches to the session.

Error notifications are informational (no approve/deny actions). The toast shows a truncated preview of the matched line.

### Error detector

New struct `ErrorDetector` in `internal/notification/`, parallel to `PatternMatcher`. One instance per session, fed the same output stream.

```go
type ErrorDetector struct {
    svc              *Service
    sessionID        string
    sessionName      string
    DebounceInterval time.Duration
    patterns         []*regexp.Regexp

    lastFired time.Time
    mu        sync.Mutex
}
```

**Built-in patterns** (case-insensitive where noted):

| Pattern | What it catches |
|---|---|
| `(?i)^error[\s:\[]` | Lines starting with "error" |
| `(?i)^fatal[\s:\[]` | Fatal errors |
| `panic:` | Go panics |
| `Traceback \(most recent call last\)` | Python tracebacks |
| `(?i)segmentation fault` | Segfaults |
| `(?i)out of memory` | OOM |
| `(?i)FAILED` | Test failures |
| `npm ERR!` | npm errors |
| `(?i)compilation failed` | Build failures |
| `(?i)build failed` | Build failures |

The detector strips ANSI escape sequences before matching. This prevents false negatives from colored output.

**Debounce:** 30-second interval per session (longer than PatternMatcher's 10s since errors often produce multiple lines). Only the first match in a burst triggers a notification.

### ANSI stripping

Add a shared `StripANSI([]byte) []byte` utility in `internal/notification/ansi.go`. The PatternMatcher should also use this — currently it matches against raw terminal data which could miss patterns split by escape sequences.

### Integration point

In `app.go`, the output callback already feeds `PatternMatcher`. Add `ErrorDetector` alongside it:

```go
a.errorDetectors[info.ID] = notification.NewErrorDetector(a.notifSvc, info.ID, info.Name)
```

In the output callback:
```go
if ed, ok := a.errorDetectors[id]; ok {
    ed.Feed(data)
}
```

Error detection runs unconditionally — unlike PatternMatcher, it doesn't skip when HookListener is active, since hook listeners handle input prompts, not errors.

### Frontend changes

- Add `"error_detected"` to the `AppNotification.type` union in `types.ts`
- Style error toasts distinctly (red/orange accent) in `ToastContainer.svelte`
- Error toasts auto-dismiss after the standard timeout (they're informational)

### Configuration

Add `ErrorDetectionEnabled bool` to `Config`. Defaults to `true`. No UI toggle in this iteration — can be set in `config.json` manually.

Future: user-configurable patterns, per-session enable/disable.

## Tasks

1. Add `StripANSI` utility with tests
2. Add `ErrorDetector` struct with built-in patterns and tests
3. Add `TypeErrorDetected` notification type
4. Wire `ErrorDetector` into `app.go` output callback
5. Add config field `ErrorDetectionEnabled`
6. Frontend: add `"error_detected"` type, style error toasts
7. Update `PatternMatcher.Feed` to strip ANSI before matching
8. Update roadmap

## Out of scope

- User-configurable error patterns (future)
- Error aggregation / error count badges
- Per-session error history
- Severity levels (warning vs error vs fatal)
