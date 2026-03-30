# cmux-Inspired Enhancements Design

Three independent features inspired by cmux's session management UX. Each ships as a separate PR.

## Feature 1: Git Branch Metadata

### Data Flow

On every hook event, the backend runs `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. Result stored as `git_branch: Option<String>` on `Session`.

### Refresh Strategy

Update on every hook event (not just SessionStart) since the user might switch branches mid-session. The git command is fast (<10ms), no caching needed.

### Backend Changes

- `state.rs`: Add `git_branch: Option<String>` to `Session`
- `server.rs`: After updating session state, run `git rev-parse --abbrev-ref HEAD` in `session.cwd` and store result
- `db.rs`: Add `git_branch TEXT` column to `sessions` table

### Frontend Changes

- `types.ts`: Add `git_branch: string | null` to `Session`
- `SessionCard.svelte`: New metadata row below header showing `⎇ branch-name` in muted text. Hidden if null.

## Feature 2: Left Accent Bar + State Labels + Unread Tracking

### Session States

Four distinct states mapped to colors:

| State | Condition | Color | Label |
|-------|-----------|-------|-------|
| Approval needed | `pending_approval == true` | Yellow `#d4a017` | APPROVAL |
| Waiting for input | Not processing, no current tool, no subagents, not pending | Green `#3fb950` | INPUT |
| Running | Processing, has current tool, or has subagents | Pink `#ff2d78` | None |
| Idle | None of the above | Gray `#444` | None |

Labels only appear for the two attention states.

### Accent Bar

3px solid left border on each session card. Color matches state. Replaces the current `SessionStatusIcon` dot.

### Unread Tracking

- `state.rs`: Add `has_unread: bool` to `Session` (runtime-only, not persisted to DB). Set `true` on state-change events (approval, stop, notification). Never auto-cleared by the backend.
- `lib.rs`: New Tauri command `mark_session_read(session_id)` clears `has_unread`.
- `SessionCard.svelte`: Small dot next to project name when `has_unread` is true. Calls `mark_session_read` when card is expanded.

### Tray Icons

Unchanged. The existing 4-icon system already maps to these priorities.

## Feature 3: Bidirectional Socket API

### Protocol

Extend the existing NDJSON socket. If an incoming line has a `"type"` field, handle it as a `Request`; otherwise fall back to `HookPayload` parsing. This keeps `jackdaw-send` working unchanged.

### Request Format

```json
{"type": "query", "command": "list_sessions", "id": "abc123"}
{"type": "action", "command": "dismiss_session", "id": "abc123", "args": {"session_id": "..."}}
{"type": "subscribe", "command": "session_updates", "id": "abc123"}
```

### Response Format

```json
{"id": "abc123", "ok": true, "data": [...]}
{"id": "abc123", "ok": false, "error": "session not found"}
```

### Query Commands

- `list_sessions` — all active sessions (same data the frontend gets)
- `get_session` — single session by ID (requires `args.session_id`)
- `get_status` — global state (running/approval/input/idle counts)

### Action Commands

- `dismiss_session` — removes session (same as existing Tauri command, requires `args.session_id`)
- `mark_session_read` — clears unread flag (requires `args.session_id`)

### Subscription Commands

- `session_updates` — streams session updates as they happen (same payload as the `session-update` Tauri event). Connection stays open, server pushes NDJSON lines. Unsubscribe by closing the connection.

### ID Field

Required on all requests, echoed on responses for client correlation. Subscription pushes include the original subscription `id`.

### jackdaw-send Compatibility

No changes. It sends raw `HookPayload` JSON (no `"type"` field), so the server's fallback parsing handles it as before.

## Implementation Order

Three independent PRs, any order works. Suggested:

1. Git branch metadata (smallest, touches fewest files)
2. Accent bar + state labels + unread tracking (UI-focused)
3. Bidirectional socket API (backend-focused)
