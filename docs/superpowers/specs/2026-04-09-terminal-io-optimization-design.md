# Terminal I/O Optimization

## Problem

Terminal I/O goes through Wails event system (`EventsEmit`/`EventsOn`), which adds overhead:
- JSON serialization/deserialization of terminal data on every chunk
- Event dispatch through Wails runtime bridge (Go -> WebKit IPC -> JS)
- All output processing (StatusTracker, PatternMatcher, ErrorDetector) runs synchronously in the output callback, blocking the next read

For high-throughput sessions (large builds, log dumps), this creates visible lag.

## Solution

Three changes, in priority order:

### 1. WebSocket for terminal I/O

Add a WebSocket server on `127.0.0.1:<random-port>` in `app.go`. Terminal data (input, output, resize) flows over WebSocket binary frames instead of Wails events.

**Protocol:**
- One WebSocket connection per session, initiated by frontend
- URL: `ws://127.0.0.1:<port>/ws/<sessionId>`
- **Go -> Frontend (output):** binary frames containing raw terminal bytes
- **Frontend -> Go (input):** binary frames with a 1-byte type prefix:
  - `0x01` + data = terminal input
  - `0x02` + 4 bytes (cols u16 BE + rows u16 BE) = resize

**Server details:**
- Standard `net/http` + `gorilla/websocket` (already a transitive dep, promote to direct)
- Bound to `127.0.0.1:0` (OS-assigned port)
- Port exposed to frontend via `GetWSPort()` Wails binding
- Server started in `App.Startup()`, stopped in `App.Shutdown()`

**Session lifecycle:**
- `CreateSession` / `CreateTerminal` no longer wire `EventsEmit` for output
- Frontend connects WebSocket after session creation, replaces `EventsOn`/`EventsEmit` for I/O
- WebSocket handler registers itself as the session's output callback
- On WebSocket close, output callback is cleared

### 2. Output coalescing

Buffer output on the Go side before sending over WebSocket:
- 2ms timer-based coalescing: accumulate bytes, flush after 2ms of no new data or when buffer hits 16KB
- Implemented as a per-connection write coalescer in the WebSocket handler
- Reduces number of WebSocket frames during burst output (e.g., `cat` of large file)

### 3. Async notification processing

Move StatusTracker, PatternMatcher, and ErrorDetector off the output hot path:
- Output callback sends data to a buffered channel (per session)
- A goroutine drains the channel and runs notification processors
- Output delivery to WebSocket is not blocked by notification processing

## Error handling

- If WebSocket connection fails or drops, the frontend logs an error and retries with exponential backoff (100ms, 200ms, 400ms, max 2s, up to 10 attempts)
- No fallback to Wails events -- if WS is down, terminal I/O is paused until reconnection
- On reconnect, history replay catches up any missed output (history is written by the relay, independent of the WS connection)

## Scope

### In scope
- New `internal/wsserver` package for WebSocket server + coalescer
- Changes to `app.go` to start WS server, expose port, wire sessions to WS
- Changes to `Terminal.svelte` to connect via WebSocket instead of Wails events
- Changes to `internal/terminal/terminal.go` to route plain terminals through WS too
- Async notification processing goroutine

### Out of scope
- Wails event system changes (control events like `sessions-updated` stay on Wails)
- Relay protocol changes
- History replay (stays via `GetSessionHistory` Wails binding, written to terminal before WS connects)

## File structure

```
internal/wsserver/
  server.go        -- HTTP server, WebSocket upgrade, session routing
  coalescer.go     -- time-based output buffering
  coalescer_test.go
app.go             -- start WS server, expose GetWSPort(), wire output callbacks
frontend/src/lib/
  Terminal.svelte   -- connect WebSocket, send binary input/resize, receive binary output
  ws.ts             -- WebSocket connection helper (connect, reconnect, binary encoding)
```

## Testing

- Unit tests for coalescer (flush timing, max buffer size)
- Manual testing: high-throughput output (`find /`, `cat` large file), resize, multiple sessions
