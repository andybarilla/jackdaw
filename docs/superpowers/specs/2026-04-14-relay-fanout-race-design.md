# Relay Buffer/Fanout Race Fix

## Problem

In `internal/relay/server.go`, `readPTY` writes incoming PTY data to `s.buffer` and then, in a separate critical section, fans the same data out to registered clients. A client connecting between those two steps can receive the frame twice:

1. `readPTY`: `s.buffer.Write(data)` — completes outside `s.mu`
2. New client (`handleClient`): `s.mu.Lock()`, snapshots `s.buffer.Bytes()` (now includes `data`), registers itself in `s.clients`, unlocks, sends snapshot as replay.
3. `readPTY`: `s.mu.Lock()`, fans out `data` to all clients including the newly-registered one — **client sees `data` twice**.

A theoretical miss case also exists if the write and register ever slip the other way, but the present duplication risk is the observed symptom (ROADMAP: "Trace logs showed two `flush-enter`s per output frame for some long-lived sessions").

A secondary data race exists on `historyWriter` / `historyBytes`: `writeHistory` mutates them outside `s.mu`, while `startHistoryFlusher` calls `historyWriter.Flush()` under `s.mu`.

A third race surfaced while writing the regression test: `handleClient` writes the replay frame and `FrameReplayEnd` *after* releasing `s.mu`. Between the unlock and the first `WriteFrame` call, `readPTY` can lock, see the newly-registered client, and fan out a live frame on the same `net.Conn` — producing interleaved `net.Conn.Write` calls and out-of-order delivery (live frames before the replay batch). Symptom observed: a client receives a live frame like `LINE-0041` first, then the replay batch `LINE-0001..LINE-0040`, then subsequent live frames `LINE-0042+`, causing the contiguity check to report `got LINE-0042 after LINE-0040`.

## Fix

**Part 1 — `readPTY`:** Make the buffer write, client fanout, and history write atomic under a single `s.mu` critical section.

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

**Part 2 — `handleClient`:** Write the replay frame and `FrameReplayEnd` *under* `s.mu`, and only register the client in `s.clients` *after* replay is fully flushed. This guarantees no live frame can reach the conn until after replay-end, and that the fanout loop never sees a client mid-replay.

```go
func (s *Server) handleClient(conn net.Conn) {
    s.mu.Lock()
    var buffered []byte
    if s.historyFile != nil {
        buffered = s.readHistoryTail(s.buffer.Size())
    } else {
        buffered = s.buffer.Bytes()
    }
    if len(buffered) > 0 {
        WriteFrame(conn, FrameData, buffered)
    }
    WriteFrame(conn, FrameReplayEnd, nil)
    s.clients[conn] = struct{}{}
    s.mu.Unlock()
    // ... unchanged from here: defer unregister, read loop
}
```

Together, these two changes ensure: (a) a new client's snapshot+replay happens atomically with respect to live fanout — no duplication, no missed frames; (b) the conn is not written to by two goroutines simultaneously — no frame interleaving; (c) live frames strictly follow `FrameReplayEnd`.

## Trade-offs

Holding `s.mu` across `WriteFrame(conn, ...)` means a slow client can block the PTY reader. This matches the existing behavior of the fanout loop — the fix does not make it worse. `handleClient`'s replay write now also runs under the lock, adding at most one full-snapshot `WriteFrame` (up to `bufferSize` bytes) to the critical section during each new-client accept. Acceptable for the current single-process app where connects are rare. If slow-client backpressure becomes a problem later, the mitigation is per-client buffered channels, which is out of scope for this fix.

## Non-goals

- No change to the client-side `relay.Client` or the protocol.
- No restructuring of `RingBuffer` or history file handling.
- No per-client buffering / backpressure.

## Testing

1. **Regression test** (`internal/relay/server_test.go` or a new file): spin up a server backed by a small shell that emits a known sequence (e.g. `printf` loop). While the server is producing, repeatedly connect/disconnect clients that read until the server closes. Assert each client's received byte stream is a contiguous suffix of the canonical sequence (no duplicated frames, no gaps) — i.e. it matches the canonical stream starting from some offset.
2. Run `go test -race ./internal/relay/...` to catch the `historyWriter` race as well.
3. Existing tests (`server_test.go`, `server_history_test.go`, `server_sigcont_test.go`) must continue to pass.

## Acceptance Criteria

- `readPTY` holds `s.mu` across buffer write, fanout, and history write.
- `handleClient` writes the replay batch and `FrameReplayEnd` under `s.mu`, and registers the client in `s.clients` only after replay is flushed.
- Regression test `TestFanoutRaceNoDuplicates` passes reliably (property test asserting no duplicates, no gaps, no frame interleaving across many concurrent connects). Note: this is a forward-looking property test — the specific pre-fix race windows are a few instructions wide and not deterministically reproducible by timing alone, so the test catches regressions that widen the window meaningfully but not a pixel-perfect reintroduction.
- `go test -race ./internal/relay/...` passes, with the exception of the pre-existing `TestClientResize`/`TestServerResize` race on `pty.Setsize` vs `ptmx.Close`, which is unrelated and tracked as a separate Known Issue on the ROADMAP.
- Only `internal/relay/server.go` and `internal/relay/server_fanout_race_test.go` are modified (plus spec/plan docs).
