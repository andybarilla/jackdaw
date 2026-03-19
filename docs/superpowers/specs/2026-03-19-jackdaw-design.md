# Jackdaw — Claude Code Session Dashboard

A desktop system tray app that receives hook events from Claude Code sessions and displays a real-time dashboard of what each session is doing.

## Problem

When running multiple Claude Code sessions across terminals and projects, there's no centralized way to see what each session is working on. You have to switch between terminals to check.

## Solution

A Tauri v2 desktop app (Rust backend + Svelte frontend) that:
- Runs an HTTP server on localhost to receive hook events from Claude Code
- Displays a dashboard of active sessions with their current tool activity
- Lives in the system tray with status-aware icon colors

## Architecture

Single-process Tauri v2 application.

```
Hook (curl POST) → Tauri Rust HTTP server → Tauri event → Svelte UI
                                           → Tray icon update
```

### Rust Backend

- **HTTP server** — Binds `localhost:9876` (configurable). Single endpoint: `POST /events`. Receives the raw JSON payload that Claude Code sends to hooks via stdin.
- **Session state** — `HashMap<String, Session>` in memory. Keyed by `session_id`.
- **Event dispatch** — On each state change, emits a `"session-update"` Tauri event to the Svelte frontend and updates the tray icon.
- **Tray management** — Updates icon color and tooltip text based on aggregate session state.

### Svelte Frontend

- Listens for `"session-update"` Tauri events.
- Renders a vertical list of session cards.
- Reactive — updates immediately on each event.

## Hook Payload Schema

Claude Code sends a JSON object to hook stdin. The shape varies by event type but all share common fields:

### Common Fields (all events)

```json
{
  "session_id": "abc-123-def",
  "cwd": "/home/user/dev/project",
  "hook_event_name": "PreToolUse"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | Unique session identifier, consistent across all events in a session |
| `cwd` | `string` | Working directory of the Claude Code session |
| `hook_event_name` | `string` | One of: `"SessionStart"`, `"SessionStop"`, `"PreToolUse"`, `"PostToolUse"` |

### Tool Use Fields (PreToolUse / PostToolUse only)

```json
{
  "session_id": "abc-123-def",
  "cwd": "/home/user/dev/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/home/user/dev/project/src/main.rs",
    "old_string": "...",
    "new_string": "..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | `string` | The tool being called: "Bash", "Edit", "Read", "Write", "Glob", "Grep", "Agent", etc. |
| `tool_input` | `object` | Tool-specific parameters. Shape varies per tool. |

The Rust backend uses `hook_event_name` to discriminate the event type. All four hook types POST to the same `POST /events` endpoint — the payload itself carries the type.

### Event Processing Rules

- **Unknown fields are ignored** — the payload may contain additional fields not listed above
- **Missing `session_id`** — reject the event (return 400)
- **`PreToolUse` for unknown session** — create the session implicitly (handles case where SessionStart was missed)
- **`PostToolUse` without matching `PreToolUse`** — add directly to tool_history, leave `current_tool` as None
- **Malformed JSON** — return 400, log warning

## Data Model

### Session

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `String` | Unique session identifier from Claude Code |
| `cwd` | `String` | Project directory — primary display identifier |
| `started_at` | `DateTime` | When SessionStart was received |
| `current_tool` | `Option<ToolEvent>` | Tool currently in progress (set on PreToolUse, cleared on PostToolUse) |
| `tool_history` | `Vec<ToolEvent>` | Recent completed tools, capped at 50 entries |

### ToolEvent

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | `String` | "Bash", "Edit", "Read", "Glob", "Grep", etc. |
| `hook_event` | `HookEventType` | PreToolUse or PostToolUse |
| `timestamp` | `DateTime` | When the event was received |
| `summary` | `Option<String>` | Extracted context: file path for Edit/Read, command for Bash, pattern for Glob |

### HookEventType

- `SessionStart` — Creates a new session entry
- `SessionStop` — Removes the session from active view
- `PreToolUse` — Sets `current_tool` on the session
- `PostToolUse` — Moves `current_tool` to `tool_history`, clears `current_tool`

### Summary Extraction

The `summary` field is extracted from `tool_input` in the hook payload:

| Tool | Summary source |
|------|---------------|
| Bash | `tool_input.command` (truncated) |
| Edit | `tool_input.file_path` |
| Read | `tool_input.file_path` |
| Write | `tool_input.file_path` |
| Glob | `tool_input.pattern` |
| Grep | `tool_input.pattern` |
| Agent | `tool_input.description` |
| Other | `tool_name` only |

## Hook Configuration

Users add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "cat | curl -s -X POST -H 'Content-Type: application/json' -d @- http://localhost:9876/events"
        }]
      }
    ],
    "SessionStop": [
      {
        "hooks": [{
          "type": "command",
          "command": "cat | curl -s -X POST -H 'Content-Type: application/json' -d @- http://localhost:9876/events"
        }]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "cat | curl -s -X POST -H 'Content-Type: application/json' -d @- http://localhost:9876/events"
        }]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "cat | curl -s -X POST -H 'Content-Type: application/json' -d @- http://localhost:9876/events"
        }]
      }
    ]
  }
}
```

- Same command for all hook types — `cat` reads the JSON from stdin, pipes to `curl`
- Fails silently if Jackdaw isn't running (curl gets connection refused, hook exits, Claude Code continues)
- A `jackdaw install-hooks` CLI command is a future nice-to-have, not a v1 deliverable

## Dashboard UI

### Layout

Vertical stack of session cards. Header bar shows app name and active session count.

### Session Card

Each card displays:
- **Project directory** (`cwd`) as the primary identifier
- **Session ID** (abbreviated) and uptime
- **Status badge**:
  - **Running** (green) — `current_tool` is set
  - **Waiting** (yellow) — session is active but no tool in progress
- **Current tool** — highlighted in a blue box when active, showing tool name and summary
- **Recent tool history** — last 5 completed tools with relative timestamps (backend stores up to 50 for potential future use)

### Session Lifecycle

- `SessionStart` → card appears
- `SessionStop` → card is removed
- Cards are ordered by start time, newest on top

## System Tray

### Icon States

| Icon Color | Condition |
|-----------|-----------|
| **Green** | At least one session has an active tool running |
| **Yellow** | Sessions exist but all are waiting (no active tools) |
| **Gray** | No active sessions |

### Tooltip

Shows count summary: "Jackdaw — 1 running, 2 waiting" or "Jackdaw — idle"

### Interactions

- **Left click** — Toggle dashboard window visibility
- **Right click** — Context menu:
  - Show Dashboard
  - Settings (port configuration)
  - Quit

## Tech Stack

- **Tauri v2** — Desktop app framework (Rust backend + webview frontend)
- **Rust** — Backend: HTTP server, session state, tray management
- **Svelte** — Frontend: dashboard UI
- **Vite** — Frontend build tooling (Tauri default with Svelte)

## Window Behavior

- **Default size** — 400px wide, 600px tall
- **Resizable** — yes
- **On launch** — starts hidden in tray, no window shown
- **Left click tray** — toggles window visibility
- **Close button** — hides window to tray (does not quit)

## Error Handling

- **Port in use** — show a system notification: "Jackdaw: port 9876 is in use. Change the port in settings." App stays in tray but shows gray icon.
- **Malformed payload** — return HTTP 400, log to stderr. Do not crash.
- **Session crash (no SessionStop)** — acknowledged limitation in v1. Sessions may appear as "Waiting" indefinitely. Each card has a dismiss button (x) to manually remove stale sessions.

## Non-Goals (v1)

- Persistence across app restarts
- Team/multi-user support
- Token usage or cost tracking
- Conversation content or message flow
- Timeout-based session expiry (relying on explicit SessionStart/Stop, with manual dismiss as fallback)
- Authentication on the HTTP endpoint (localhost-only binding is sufficient for personal use)
