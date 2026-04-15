# Relay Fanout Race Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Eliminate the buffer/fanout race in `relay.Server.readPTY` so concurrently-connecting clients never see duplicated or missed PTY frames.

**Architecture:** Move `s.buffer.Write(data)`, the client fanout loop, and `s.writeHistory(data)` into a single `s.mu` critical section inside `readPTY`. `handleClient`'s snapshot+register already runs under `s.mu`, so making the producer side atomic closes the window.

**Tech Stack:** Go, `internal/relay` package, `go test -race`.

**Spec:** `docs/superpowers/specs/2026-04-14-relay-fanout-race-design.md`

---

## Conventions

- TDD: failing test first, then minimal fix.
- Strict typing, descriptive names, imports at top.
- One commit per task. Use feature branch `fix/relay-fanout-race` (never commit to `main`).
- Run from repo root: `/home/andy/dev/andybarilla/jackdaw`.

---

## Task 1: Failing regression test for fanout race

**Files:**
- Create: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server_fanout_race_test.go`

- [ ] **Step 1: Create feature branch**
Run: `git checkout -b fix/relay-fanout-race`
Expected: `Switched to a new branch 'fix/relay-fanout-race'`

- [ ] **Step 2: Write the failing regression test**

Create `/home/andy/dev/andybarilla/jackdaw/internal/relay/server_fanout_race_test.go` with:

```go
package relay

import (
	"bytes"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestFanoutRaceNoDuplicates spawns a relay backed by a shell that emits a
// known monotonically-tagged sequence and repeatedly connects clients
// concurrently with production. Every client's received stream must be a
// contiguous suffix of the canonical produced stream — no duplicated frames
// (the original bug) and no gaps. Runs with -race to also catch the
// historyWriter race.
func TestFanoutRaceNoDuplicates(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "race.sock")

	// Emit a long, easily-checkable sequence: 2000 lines of "LINE-<n>\n".
	// Each line is unique so duplication is unambiguous.
	script := `for i in $(seq 1 2000); do printf 'LINE-%04d\n' "$i"; done`

	srv, err := NewServer(sockPath, "/tmp", "sh", []string{"-c", script}, 65536, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	// Give the listener a beat to come up but start connecting before the
	// child is anywhere near done so we race buffer writes against snapshots.
	time.Sleep(20 * time.Millisecond)

	const numClients = 25
	var wg sync.WaitGroup
	errCh := make(chan error, numClients)

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Stagger connects across the production window.
			time.Sleep(time.Duration(idx) * 2 * time.Millisecond)

			c, err := NewClient(sockPath)
			if err != nil {
				errCh <- fmt.Errorf("client %d dial: %w", idx, err)
				return
			}
			defer c.Close()

			var mu sync.Mutex
			var buf bytes.Buffer
			done := make(chan struct{})

			c.OnOutput = func(data []byte) {
				mu.Lock()
				buf.Write(data)
				mu.Unlock()
			}
			c.OnReplayEnd = func() {
				// Replay marker; keep reading live frames.
			}
			c.StartReadLoop()

			// Read until we observe the final line or time out.
			go func() {
				deadline := time.Now().Add(10 * time.Second)
				for time.Now().Before(deadline) {
					mu.Lock()
					hasEnd := bytes.Contains(buf.Bytes(), []byte("LINE-2000\n"))
					mu.Unlock()
					if hasEnd {
						close(done)
						return
					}
					time.Sleep(20 * time.Millisecond)
				}
				close(done)
			}()
			<-done

			mu.Lock()
			got := append([]byte(nil), buf.Bytes()...)
			mu.Unlock()

			if err := assertContiguousSuffix(got); err != nil {
				errCh <- fmt.Errorf("client %d: %w", idx, err)
			}
		}(i)
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
}

// assertContiguousSuffix verifies that got contains LINE-XXXX\n entries that
// form a contiguous, strictly-increasing sequence with no duplicates and no
// gaps. Leading/trailing partial-line bytes are tolerated because frame
// boundaries don't align to lines.
func assertContiguousSuffix(got []byte) error {
	// Trim to first complete line.
	first := bytes.IndexByte(got, '\n')
	if first < 0 {
		return fmt.Errorf("no complete lines received (%d bytes)", len(got))
	}
	body := got[first+1:]

	// Trim trailing partial line.
	last := bytes.LastIndexByte(body, '\n')
	if last < 0 {
		return fmt.Errorf("only one line received")
	}
	body = body[:last+1]

	lines := bytes.Split(bytes.TrimRight(body, "\n"), []byte{'\n'})
	if len(lines) == 0 {
		return fmt.Errorf("no lines after trimming")
	}

	var prev int
	for i, ln := range lines {
		var n int
		if _, err := fmt.Sscanf(string(ln), "LINE-%d", &n); err != nil {
			return fmt.Errorf("line %d: unparseable %q", i, ln)
		}
		if i == 0 {
			prev = n
			continue
		}
		if n != prev+1 {
			return fmt.Errorf("non-contiguous at index %d: got LINE-%04d after LINE-%04d", i, n, prev)
		}
		prev = n
	}
	return nil
}
```

- [ ] **Step 3: Run the test and confirm it fails against current code**
Run: `cd /home/andy/dev/andybarilla/jackdaw && go test -race -run TestFanoutRaceNoDuplicates -count=5 ./internal/relay/...`
Expected: FAIL. Either `non-contiguous at index ...` errors (duplicate frames produce e.g. `got LINE-0042 after LINE-0042`) or a `DATA RACE` report on `historyWriter`/`historyBytes` is acceptable — both prove the race is observable.

If the test passes on all 5 runs, increase `numClients` to 50 and `-count=10`. The race window is small but reliably hits within a few iterations.

- [ ] **Step 4: Commit the failing test**
Run:
```
cd /home/andy/dev/andybarilla/jackdaw && \
git add internal/relay/server_fanout_race_test.go && \
git commit -m "Add failing regression test for relay fanout race"
```
Expected: commit created on `fix/relay-fanout-race`.

---

## Task 2: Apply the fix in readPTY

**Files:**
- Modify: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server.go:130-149`

- [ ] **Step 1: Move buffer write and history write inside the fanout critical section**

In `internal/relay/server.go`, replace the current `readPTY` body:

```go
func (s *Server) readPTY() {
	buf := make([]byte, 4096)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			s.buffer.Write(data)
			s.mu.Lock()
			for conn := range s.clients {
				WriteFrame(conn, FrameData, data)
			}
			s.mu.Unlock()
			s.writeHistory(data)
		}
		if err != nil {
			return
		}
	}
}
```

with:

```go
func (s *Server) readPTY() {
	buf := make([]byte, 4096)
	for {
		n, err := s.ptmx.Read(buf)
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
		if err != nil {
			return
		}
	}
}
```

The buffer write, fanout, and history write are now all serialized under `s.mu`. `handleClient`'s snapshot+register already runs under the same lock, so a new client either snapshots before the producer's critical section (and receives `data` only via subsequent fanout) or after (and receives `data` only via the snapshot).

- [ ] **Step 2: Run the regression test and confirm it passes**
Run: `cd /home/andy/dev/andybarilla/jackdaw && go test -race -run TestFanoutRaceNoDuplicates -count=10 ./internal/relay/...`
Expected: PASS on all 10 iterations. No DATA RACE reports.

- [ ] **Step 3: Run the full relay package with -race**
Run: `cd /home/andy/dev/andybarilla/jackdaw && go test -race ./internal/relay/...`
Expected: PASS. All existing tests (`TestServerStartAndConnect`, `TestServerReplay`, `TestServerInput`, `TestServerResize`, `TestServerSocketCleanup`, history tests, sigcont tests) still pass and no race is reported.

- [ ] **Step 4: Build the whole module**
Run: `cd /home/andy/dev/andybarilla/jackdaw && go build ./...`
Expected: clean build, no output.

- [ ] **Step 5: Commit the fix**
Run:
```
cd /home/andy/dev/andybarilla/jackdaw && \
git add internal/relay/server.go && \
git commit -m "Fix relay fanout race by serializing buffer write, fanout, and history under s.mu"
```
Expected: commit created.

---

## Task 3: Final verification

- [ ] **Step 1: Run relay tests with -race a final time at high count**
Run: `cd /home/andy/dev/andybarilla/jackdaw && go test -race -count=20 ./internal/relay/...`
Expected: PASS across all 20 iterations. No flakes, no race reports.

- [ ] **Step 2: Confirm only `server.go` and the new test file changed**
Run: `cd /home/andy/dev/andybarilla/jackdaw && git diff --stat main...HEAD`
Expected: exactly two files — `internal/relay/server.go` and `internal/relay/server_fanout_race_test.go`.

If anything else shows up, stop and investigate.

---

## Acceptance Criteria (from spec)

- [x] `readPTY` holds `s.mu` across buffer write, fanout, and history write.
- [x] New regression test reliably fails against the old code and passes against the fix.
- [x] `go test -race ./internal/relay/...` passes.
- [x] No other files changed.
