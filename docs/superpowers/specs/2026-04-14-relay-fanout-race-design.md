# Relay Buffer/Fanout Race Fix

## Problem

In `internal/relay/server.go`, `readPTY` writes incoming PTY data to `s.buffer` and then, in a separate critical section, fans the same data out to registered clients. A client connecting between those two steps can receive the frame twice:

1. `readPTY`: `s.buffer.Write(data)` — completes outside `s.mu`
2. New client (`handleClient`): `s.mu.Lock()`, snapshots `s.buffer.Bytes()` (now includes `data`), registers itself in `s.clients`, unlocks, sends snapshot as replay.
3. `readPTY`: `s.mu.Lock()`, fans out `data` to all clients including the newly-registered one — **client sees `data` twice**.

A theoretical miss case also exists if the write and register ever slip the other way, but the present duplication risk is the observed symptom (ROADMAP: "Trace logs showed two `flush-enter`s per output frame for some long-lived sessions").

A secondary data race exists on `historyWriter` / `historyBytes`: `writeHistory` mutates them outside `s.mu`, while `startHistoryFlusher` calls `historyWriter.Flush()` under `s.mu`.

## Fix

Make the buffer write, client fanout, and history write atomic under a single `s.mu` critical section inside `readPTY`.

```go
if n > 0 {
    data := make([]byte, n)
    copy(data, buf[:n])
    s.mu.Lock()
    s.buffer.Write(data)
    for conn := range s.clients {
        WriteFrame(conn, FrameData, data)
    }
    s.writeHistory(data)
    s.mu.Unlock()
}
```

`handleClient`'s snapshot+register already runs under `s.mu`, so it becomes correct once the producer side does too: either the new client's snapshot precedes `readPTY`'s critical section (client sees `data` only via the subsequent fanout) or it follows (client sees `data` only via the snapshot). No duplicates, no gaps.

## Trade-offs

Holding `s.mu` across `WriteFrame(conn, ...)` means a slow client can block the PTY reader. This matches the existing behavior of the fanout loop — the fix does not make it worse. If slow-client backpressure becomes a problem later, the mitigation is per-client buffered channels, which is out of scope for this fix.

## Non-goals

- No change to the client-side `relay.Client` or the protocol.
- No change to `handleClient`'s snapshot logic.
- No restructuring of `RingBuffer` or history file handling.
- No per-client buffering / backpressure.

## Testing

1. **Regression test** (`internal/relay/server_test.go` or a new file): spin up a server backed by a small shell that emits a known sequence (e.g. `printf` loop). While the server is producing, repeatedly connect/disconnect clients that read until the server closes. Assert each client's received byte stream is a contiguous suffix of the canonical sequence (no duplicated frames, no gaps) — i.e. it matches the canonical stream starting from some offset.
2. Run `go test -race ./internal/relay/...` to catch the `historyWriter` race as well.
3. Existing tests (`server_test.go`, `server_history_test.go`, `server_sigcont_test.go`) must continue to pass.

## Acceptance Criteria

- `readPTY` holds `s.mu` across buffer write, fanout, and history write.
- New regression test reliably fails against the old code and passes against the fix.
- `go test -race ./internal/relay/...` passes.
- No other files changed.
