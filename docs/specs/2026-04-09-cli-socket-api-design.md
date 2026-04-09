# CLI / Socket API

## Purpose

External tools (scripts, editors, AI agents) can create sessions, send input, and query status programmatically via a Unix socket API. A `jackdaw` CLI binary acts as a thin client.

## Architecture

Single Unix socket at `~/.jackdaw/api.sock`. The API server runs inside the Wails app but has no Wails runtime dependency — it talks directly to `session.Manager`. Socket is created on app startup, removed on shutdown.

Future daemon mode can take over the socket path without changing clients.

## Protocol

NDJSON (newline-delimited JSON) over Unix socket. Each request is one JSON line; each response is one or more JSON lines.

### Request Format

```json
{"method": "session.list", "params": {}}
```

### Response Envelope

```json
{"ok": true, "data": {...}}
{"ok": false, "error": {"code": "not_found", "message": "session \"abc\" not found"}}
```

### Streaming (session.read)

Multiple response lines per request:
```json
{"ok": true, "data": {"output": "<base64>"}}
{"ok": true, "data": {"output": "<base64>"}}
{"ok": true, "data": {"eof": true}}
```

Stream ends with `eof: true` when the session exits. Client disconnecting closes the stream.

## API Methods

### session.create

Create a new session.

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `work_dir` | string | yes | — |
| `command` | string | no | `claude` |
| `args` | string[] | no | `[]` |
| `name` | string | no | auto-generated |
| `workspace_id` | string | no | `""` |

Response data: `SessionInfo` object.

### session.list

List all sessions.

Params: none.

Response data: `{"sessions": [SessionInfo, ...]}`.

### session.get

Get a single session.

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |

Response data: `SessionInfo` object.

### session.kill

Kill a session's process.

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |

Response data: `{}`.

### session.remove

Remove a session entirely (kills if alive, deletes history/manifest).

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |

Response data: `{}`.

### session.rename

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |
| `name` | string | yes |

Response data: `{}`.

### session.write

Write data to a session's PTY stdin.

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |
| `input` | string | yes |

`input` is base64-encoded bytes.

Response data: `{}`.

### session.read

Stream PTY output. Replays history first, then streams live output until session exits or client disconnects.

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |

Response: streaming (see above). Each `output` value is base64-encoded.

### session.resize

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |
| `cols` | int | yes |
| `rows` | int | yes |

Response data: `{}`.

### session.history

Get session scrollback as a single payload (not streamed).

| Param | Type | Required |
|-------|------|----------|
| `id` | string | yes |

Response data: `{"output": "<base64>"}`. Empty string if no history.

## Error Codes

| Code | Meaning |
|------|---------|
| `not_found` | Session ID doesn't exist |
| `invalid_params` | Missing/malformed parameters |
| `invalid_request` | Malformed JSON or missing method |
| `internal` | Unexpected server error |

## CLI

Binary: `cmd/jackdaw-cli/main.go` (or `jackdaw cli` subcommand — TBD based on build preference). Communicates with the socket, formats output for humans (tables/text) by default, `--json` flag for machine-readable NDJSON.

### Subcommands

```
jackdaw session list [--json]
jackdaw session get <id> [--json]
jackdaw session create --dir <path> [--command <cmd>] [--args <args...>] [--name <name>] [--json]
jackdaw session kill <id>
jackdaw session remove <id>
jackdaw session rename <id> <name>
jackdaw session write <id> <input>        # input is raw text, CLI base64-encodes it
jackdaw session read <id>                 # streams output to stdout until EOF/ctrl-c
jackdaw session resize <id> <cols> <rows>
jackdaw session history <id>              # dumps scrollback to stdout
```

`session read` decodes base64 and writes raw bytes to stdout, making it pipeable.

## Implementation

### New Package: `internal/api`

`server.go`:
```go
type Server struct {
    manager  *session.Manager
    sockPath string
    listener net.Listener
}

func New(manager *session.Manager, sockPath string) *Server
func (s *Server) Start() error    // listen + accept loop
func (s *Server) Stop() error     // close listener, remove socket file
```

Each accepted connection gets a goroutine that reads NDJSON requests and writes NDJSON responses. Connection stays open until the client disconnects (supports multiple requests per connection).

`handler.go`: method dispatch + individual method handlers. Each handler receives `json.RawMessage` params, returns `(interface{}, error)`.

### Socket Lifecycle

- `app.go` `startup()`: create `api.Server`, call `Start()`
- `app.go` `shutdown()`: call `Stop()`
- Socket path: `~/.jackdaw/api.sock`
- On startup, remove stale socket file if it exists (previous crash)

### CLI Binary

`cmd/jackdaw-cli/main.go`. Uses `net.Dial("unix", sockPath)` to connect, sends one NDJSON request, reads response(s). No external dependencies beyond stdlib.

Flag parsing: `flag` stdlib or simple arg parsing — keep it minimal.

## Testing

- Unit tests for handler methods using a mock or real `Manager` with no PTY (where possible).
- Integration test: start `api.Server` with a real socket, send requests via `net.Dial`, verify responses.
- CLI tested via the socket integration tests (spawn server, run CLI commands against it).

## Not In Scope

- Authentication/authorization (local socket, same-user only via filesystem permissions).
- TLS or TCP socket (Unix socket only).
- WebSocket protocol (existing WebSocket server is for the frontend; API uses raw Unix socket).
- Worktree options in `session.create` (can be added later).
- `session.dashboard` method (internal to UI).
