# CLI / Socket API — Implementation Plan

## Overview

Unix socket API server (`internal/api`) that exposes session management over NDJSON, plus a `jackdaw-cli` binary that talks to it. The API server runs inside the Wails app but has zero Wails dependency — it only needs `session.Manager`.

## Task Breakdown

### Task 1: API server scaffold (`internal/api/server.go`)

Create the server that listens on a Unix socket and dispatches NDJSON requests to handlers.

**Files:**
- Create `internal/api/server.go`

**Details:**
- `Server` struct holds `*session.Manager`, `sockPath string`, `net.Listener`
- `New(manager, sockPath) *Server`
- `Start() error` — remove stale socket, `net.Listen("unix", sockPath)`, spawn accept loop in goroutine
- `Stop() error` — close listener, remove socket file, wait for connections to drain (context cancel)
- Each accepted connection gets a goroutine: `bufio.Scanner` reads lines, `json.Unmarshal` into `Request{Method string, Params json.RawMessage}`, dispatch to handler, write JSON response + newline
- Connection stays open for multiple requests (client disconnecting closes it)
- Request/response types: `Request`, `Response{OK bool, Data interface{}, Error *ErrorDetail}`, `ErrorDetail{Code string, Message string}`

**Tests:** Unit test in `internal/api/server_test.go` — start server on temp socket, connect, send a valid request, verify response format. Send malformed JSON, verify error response.

### Task 2: Method handlers (`internal/api/handler.go`)

Implement all API method handlers that bridge requests to `session.Manager`.

**Files:**
- Create `internal/api/handler.go`

**Details:**

Each handler is a function `func(mgr *session.Manager, params json.RawMessage) (interface{}, error)`. A dispatcher map routes method names to handlers.

Methods to implement:
- `session.list` — calls `mgr.List()`, returns `{"sessions": [...]}`
- `session.get` — params: `{id}`, calls `mgr.GetSessionInfo(id)`, returns SessionInfo or not_found
- `session.create` — params: `{work_dir, command?, args?, name?, workspace_id?}`, calls `mgr.Create(...)` with an ID generated from `time.Now().UnixNano()`. The onOutput callback registers a per-session ring buffer for `session.read`. Returns SessionInfo.
- `session.kill` — params: `{id}`, calls `mgr.Kill(id)`
- `session.remove` — params: `{id}`, calls `mgr.Remove(id)`
- `session.rename` — params: `{id, name}`, calls `mgr.Rename(id, name)`
- `session.write` — params: `{id, input}` (base64), decodes and calls `mgr.WriteToSession(id, data)`
- `session.resize` — params: `{id, cols, rows}`, calls `mgr.ResizeSession(id, cols, rows)`
- `session.history` — params: `{id}`, calls `mgr.GetSessionHistory(id)`, returns base64-encoded output
- `session.read` — params: `{id}`, streaming handler (see Task 3)

Error mapping: `"not found"` in error string → `not_found` code, missing params → `invalid_params`, bad JSON → `invalid_request`, everything else → `internal`.

**Tests:** `internal/api/handler_test.go` — test each handler with a real `Manager` (using temp dirs for manifests/sockets/history). Test error cases (not_found, invalid_params).

### Task 3: Streaming output (`session.read`)

Implement the streaming read handler that replays history then streams live output.

**Files:**
- Modify `internal/api/handler.go` — add streaming read handler
- Modify `internal/api/server.go` — support streaming responses (handler writes directly to the connection instead of returning a single response)

**Details:**
- The handler needs direct access to the `net.Conn` (or a response writer) since it sends multiple JSON lines
- Flow: replay history via `mgr.GetSessionHistory(id)` as one chunk, then subscribe to live output via `mgr.SetOnOutput` (or a new subscription mechanism)
- Each output chunk is base64-encoded, written as `{"ok": true, "data": {"output": "<base64>"}}\n`
- When session exits, send `{"ok": true, "data": {"eof": true}}\n` and return
- When client disconnects (read returns error / context canceled), clean up subscription and return

**Manager changes needed:** `session.read` needs to subscribe to output without replacing the existing `OnOutput` handler (which the Wails frontend uses). Add `Manager.SubscribeOutput(id string) (<-chan []byte, func())` that returns a channel and an unsubscribe function. The Session's OnOutput becomes a fan-out to all subscribers.

**Files (additional):**
- Modify `internal/session/session.go` — change `OnOutput` from single callback to fan-out (list of callbacks with add/remove)
- Modify `internal/session/manager.go` — add `SubscribeOutput(id) (chan, unsubscribe)` method

**Tests:** Integration test — create a session (or mock), call `session.read`, verify history replay, send input, verify live output appears, disconnect and verify cleanup.

### Task 4: Wire API server into app lifecycle (`app.go`)

Start and stop the API server during app startup/shutdown.

**Files:**
- Modify `app.go`

**Details:**
- Add `apiServer *api.Server` field to `App` struct
- In `Startup()`: after manager recovery, create `api.New(a.manager, filepath.Join(jackdawDir, "api.sock"))`, call `apiServer.Start()`. Log errors but don't crash (API is optional).
- In `Shutdown()`: call `apiServer.Stop()` before other cleanup
- The API server's `session.create` handler needs the same onOutput wiring as `App.CreateSession` (WebSocket output, notification processing). Expose a method on App or pass a creation callback to the API server so it can use the full session creation logic.

**Approach for session.create:** Rather than duplicating the App.CreateSession logic, add a `CreateFunc` field to `api.Server` that the app sets. The API handler calls this instead of calling the manager directly. This keeps the API server decoupled while reusing the app's session creation logic (hooks, notifications, WebSocket output).

**Tests:** Verify the socket file appears at startup and is removed at shutdown (testable via the existing integration test pattern).

### Task 5: CLI binary (`cmd/jackdaw-cli/main.go`)

Thin CLI client that connects to the Unix socket and issues commands.

**Files:**
- Create `cmd/jackdaw-cli/main.go`

**Details:**
- Socket path: `~/.jackdaw/api.sock` (hardcoded default, `--socket` flag override)
- Global `--json` flag for machine-readable NDJSON output (default: human-readable)
- Arg parsing: `os.Args` positional — `jackdaw-cli session <subcommand> [args] [flags]`
- Subcommands map to API methods:
  - `session list` → `session.list`, table output: ID, NAME, STATUS, WORKDIR
  - `session get <id>` → `session.get`, key-value output
  - `session create --dir <path> [--command <cmd>] [--args <a,b>] [--name <n>]` → `session.create`
  - `session kill <id>` → `session.kill`
  - `session remove <id>` → `session.remove`
  - `session rename <id> <name>` → `session.rename`
  - `session write <id> <input>` → `session.write` (CLI base64-encodes the raw text input)
  - `session read <id>` → `session.read` (streams, decodes base64, writes raw to stdout)
  - `session resize <id> <cols> <rows>` → `session.resize`
  - `session history <id>` → `session.history` (decodes base64, writes raw to stdout)
- Connection: `net.Dial("unix", sockPath)`, send JSON line, read response line(s)
- For `session read`: read lines in a loop until EOF marker or connection close. Handle SIGINT to disconnect gracefully.
- No external dependencies — stdlib only (`net`, `encoding/json`, `encoding/base64`, `os`, `fmt`, `text/tabwriter`)

**Tests:** Integration test in `cmd/jackdaw-cli/main_test.go` — start an API server on a temp socket, run CLI subcommands against it, verify output.

### Task 6: Output fan-out for concurrent readers

Ensure `session.read` API and Wails WebSocket frontend can both receive output simultaneously.

**Files:**
- Modify `internal/session/session.go` — replace `OnOutput func([]byte)` with a subscriber list
- Modify `internal/session/manager.go` — add `SubscribeOutput` method

**Details:**
- `Session` gets `outputMu sync.RWMutex`, `outputSubs map[int]func([]byte)`, `nextSubID int`
- `AddOutputSub(fn func([]byte)) int` — returns sub ID
- `RemoveOutputSub(id int)`
- Internal output dispatch iterates all subs under RLock
- `Manager.SubscribeOutput(sessionID string) (<-chan []byte, func())` — creates a buffered channel, adds a sub that sends to it, returns channel and unsubscribe func
- Existing `SetOnOutput` and `OnOutput` field become convenience wrappers that add/replace a "primary" subscriber (sub ID 0)
- `Manager.StartSessionReadLoop` calls `s.StartReadLoop()` which fans out to all registered subs

**Note:** This task is a prerequisite for Task 3 working correctly with the existing frontend. It should be implemented before Task 3. The task ordering in execution should be: 1, 6, 2, 3, 4, 5.

**Tests:** Unit test — register two subscribers, write data, both receive it. Remove one, only the other receives.

## Execution Order

1. **Task 1** — API server scaffold (no dependencies)
2. **Task 6** — Output fan-out (no API dependency, needed by Task 3)
3. **Task 2** — Method handlers (depends on Task 1)
4. **Task 3** — Streaming read (depends on Tasks 2, 6)
5. **Task 4** — App integration (depends on Tasks 1-3)
6. **Task 5** — CLI binary (depends on Task 4 for end-to-end testing)

## File Summary

| Action | Path |
|--------|------|
| Create | `internal/api/server.go` |
| Create | `internal/api/server_test.go` |
| Create | `internal/api/handler.go` |
| Create | `internal/api/handler_test.go` |
| Create | `cmd/jackdaw-cli/main.go` |
| Create | `cmd/jackdaw-cli/main_test.go` |
| Modify | `internal/session/session.go` — fan-out output subscribers |
| Modify | `internal/session/manager.go` — `SubscribeOutput` method |
| Modify | `app.go` — API server lifecycle, CreateFunc wiring |

## Non-goals

- Authentication (Unix socket file permissions are sufficient)
- TCP/TLS socket support
- WebSocket protocol (separate from existing frontend WebSocket)
- Daemon mode (future — API server design is daemon-ready but runs in-app for now)
