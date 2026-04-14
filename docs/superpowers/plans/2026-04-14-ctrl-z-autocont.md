# Ctrl-Z Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Make Jackdaw sessions auto-resume any child process that stops itself with SIGTSTP, so Ctrl+Z inside tools like `claude` can never leave the session stuck in stopped state.

**Architecture:** Replace the single `s.cmd.Wait()` call in `internal/relay/server.go` with a `syscall.Wait4(pid, &status, syscall.WUNTRACED, nil)` loop. On `WIFSTOPPED` send `SIGCONT` and continue; on `WIFEXITED`/`WIFSIGNALED` store exit info on a new `Server` field and return. Only one waiter per pid — `s.cmd.Wait()` is removed entirely.

**Tech Stack:** Go, `syscall` package (already transitively available), existing `internal/relay` package.

---

## Pre-flight

File layout for this change:
- Modify: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server.go`
- Create: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server_sigcont_test.go`

Branch: `fix-ctrl-z-autocont`.

No other files in the repo touch `s.cmd.Wait` or `s.cmd.ProcessState` today (verified in Task 1). If the grep in Task 1 surprises us with a new caller, stop and re-plan — do not proceed past Task 1 silently.

---

## Task 1: Branch and verify blast radius

**Files:** none (audit only)

- [ ] **Step 1: Create and check out the feature branch**

Run:
```
git checkout -b fix-ctrl-z-autocont
```
Expected: `Switched to a new branch 'fix-ctrl-z-autocont'`

- [ ] **Step 2: Grep for every use of `cmd.Wait` inside the relay package**

Run:
```
grep -rn 'cmd\.Wait\b' /home/andy/dev/andybarilla/jackdaw/internal/relay
```
Expected (exactly one hit):
```
/home/andy/dev/andybarilla/jackdaw/internal/relay/server.go:183:	s.cmd.Wait()
```

If any other line appears, STOP. Every call site has to migrate to the new exit-state field before we delete `s.cmd.Wait()`. Re-plan before continuing.

- [ ] **Step 3: Grep for every use of `cmd.ProcessState` inside the relay package**

Run:
```
grep -rn 'ProcessState' /home/andy/dev/andybarilla/jackdaw/internal/relay
```
Expected: no output (exit code 1).

If any hit appears, STOP. Those call sites read exit info from `exec.Cmd`'s internal state, which will no longer be populated once we stop calling `cmd.Wait()`. They must migrate to the new `Server` field as part of this task. Re-plan before continuing.

- [ ] **Step 4: Grep the whole repo for external readers of the relay's `cmd.ProcessState`**

Run:
```
grep -rn 'ProcessState' /home/andy/dev/andybarilla/jackdaw --include='*.go'
```
Expected: no hits inside any file that imports `internal/relay`. (Incidental hits in vendored `os/exec` docs or unrelated packages are fine; scan the output by eye.)

If an importer of `internal/relay` reads `srv.cmd.ProcessState` (it shouldn't — `cmd` is unexported), STOP and re-plan.

---

## Task 2: Failing test for Ctrl-Z auto-resume

**Files:**
- Create: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server_sigcont_test.go`

This test launches a shell one-liner that prints a sentinel, self-raises SIGTSTP, then prints a second sentinel and exits. Without the fix, the relay never sees the second sentinel because the child is stopped forever. With the fix, the relay sends SIGCONT and both sentinels arrive.

We use `sh -c` with `kill -STOP $$` rather than a compiled helper so the test has zero build-time dependencies.

- [ ] **Step 1: Write the failing test**

Create `/home/andy/dev/andybarilla/jackdaw/internal/relay/server_sigcont_test.go` with this exact content:

```go
package relay

import (
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestServerAutoResumeOnSIGTSTP verifies that when a child process stops
// itself with SIGTSTP, the relay sends SIGCONT so the process resumes and
// runs to completion. Without auto-resume the child would be stuck in the
// stopped state forever and the second sentinel would never appear.
func TestServerAutoResumeOnSIGTSTP(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")

	// Print "before-stop", stop ourselves, then print "after-cont".
	// `kill -STOP $$` sends SIGSTOP (not SIGTSTP), which is stronger:
	// SIGSTOP can't be caught or ignored, so if the relay is still
	// calling plain cmd.Wait() this test will hang until the deadline.
	// Once the fix lands, Wait4 with WUNTRACED sees the stop and the
	// relay sends SIGCONT to resume the child.
	script := `printf before-stop; kill -STOP $$; printf after-cont`

	srv, err := NewServer(sockPath, "/tmp", "sh", []string{"-c", script}, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out waiting for after-cont; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
		}
		if strings.Contains(output.String(), "after-cont") {
			break
		}
	}

	got := output.String()
	if !strings.Contains(got, "before-stop") {
		t.Errorf("missing before-stop sentinel; output = %q", got)
	}
	if !strings.Contains(got, "after-cont") {
		t.Errorf("missing after-cont sentinel (child was not resumed); output = %q", got)
	}
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -run TestServerAutoResumeOnSIGTSTP -v -timeout 30s
```
Expected: `--- FAIL: TestServerAutoResumeOnSIGTSTP` with a line mentioning `timed out waiting for after-cont` (the child is stuck stopped because the fix is not in yet). The test must reach the 5-second deadline — not pass, not error for some other reason. If it passes, the test is wrong; re-examine before going further.

- [ ] **Step 3: Commit the failing test**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && git add internal/relay/server_sigcont_test.go && git commit -m "test(relay): add failing test for SIGTSTP auto-resume"
```
Expected: one file changed, clean commit.

---

## Task 3: Implement the Wait4 loop

**Files:**
- Modify: `/home/andy/dev/andybarilla/jackdaw/internal/relay/server.go`

This is the real change. Three edits to `server.go`:
1. Add `syscall` to the import block.
2. Add an `exitState` field on `Server` plus a mutex-free getter (the field is only written by `waitProcess` and only read after `done` is closed or after the waiter returns — we'll publish via an atomic pointer to keep it simple and race-free).
3. Rewrite `waitProcess` to loop on `syscall.Wait4` with `WUNTRACED`.

We use `sync/atomic.Pointer[ExitState]` so the field is safe to read from any goroutine without locking, and `nil` means "still running".

- [ ] **Step 1: Add the `syscall` and `sync/atomic` imports**

Edit the import block in `internal/relay/server.go`. Before:
```go
import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)
```

After:
```go
import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
)
```

- [ ] **Step 2: Add the `ExitState` type and `exitState` field**

Insert this type declaration immediately above `type Server struct` in `internal/relay/server.go`:

```go
// ExitState records how the relay's child process terminated. It is
// populated by waitProcess once Wait4 reports WIFEXITED or WIFSIGNALED
// and is nil while the child is still running.
type ExitState struct {
	// ExitCode is the process exit code when Exited is true, otherwise 0.
	ExitCode int
	// Signal is the terminating signal when Signaled is true, otherwise 0.
	Signal syscall.Signal
	// Exited is true when the child terminated normally (WIFEXITED).
	Exited bool
	// Signaled is true when the child was killed by a signal (WIFSIGNALED).
	Signaled bool
}
```

Then add an `exitState` field to the `Server` struct. Before:
```go
type Server struct {
	sockPath      string
	cmd           *exec.Cmd
	ptmx          *os.File
	listener      net.Listener
	buffer        *RingBuffer
	clients       map[net.Conn]struct{}
	mu            sync.Mutex
	done          chan struct{}
	historyFile   *os.File
	historyWriter *bufio.Writer
	historyBytes  int64
	historyMax    int64
	historyPath   string
}
```

After:
```go
type Server struct {
	sockPath      string
	cmd           *exec.Cmd
	ptmx          *os.File
	listener      net.Listener
	buffer        *RingBuffer
	clients       map[net.Conn]struct{}
	mu            sync.Mutex
	done          chan struct{}
	historyFile   *os.File
	historyWriter *bufio.Writer
	historyBytes  int64
	historyMax    int64
	historyPath   string
	exitState     atomic.Pointer[ExitState]
}
```

- [ ] **Step 3: Rewrite `waitProcess`**

Replace the existing `waitProcess` function in `internal/relay/server.go`. Before:
```go
func (s *Server) waitProcess() {
	s.cmd.Wait()
	// Server stays alive after process exit so clients can still
	// connect and replay buffered output. Cleanup happens when
	// the manager calls Close() via Kill.
}
```

After:
```go
func (s *Server) waitProcess() {
	// We must be the only waiter for this pid. exec.Cmd.Wait() also
	// calls waitpid internally, so it must never run against this
	// process — two waiters on the same pid is undefined behavior.
	//
	// Wait4 with WUNTRACED returns on both stop and exit. On stop we
	// send SIGCONT so any child that self-suspends (e.g. Claude Code's
	// Ctrl-Z handler raises SIGTSTP) is resumed transparently. On exit
	// we publish the final status and return. Server stays alive after
	// the child exits so clients can still connect and replay buffered
	// output; cleanup happens when the manager calls Close() via Kill.
	if s.cmd.Process == nil {
		return
	}
	pid := s.cmd.Process.Pid
	for {
		var status syscall.WaitStatus
		_, err := syscall.Wait4(pid, &status, syscall.WUNTRACED, nil)
		if err != nil {
			if err == syscall.EINTR {
				continue
			}
			return
		}
		switch {
		case status.Stopped():
			// Child stopped itself (SIGTSTP/SIGSTOP). Resume it and
			// keep waiting — we want to learn when it really exits.
			s.cmd.Process.Signal(syscall.SIGCONT)
			continue
		case status.Exited():
			s.exitState.Store(&ExitState{
				ExitCode: status.ExitStatus(),
				Exited:   true,
			})
			return
		case status.Signaled():
			s.exitState.Store(&ExitState{
				Signal:   status.Signal(),
				Signaled: true,
			})
			return
		default:
			// Continued or some other transient state — keep waiting.
			continue
		}
	}
}
```

Notes embedded for the implementer:
- `status.Stopped()`, `status.Exited()`, `status.Signaled()`, `status.ExitStatus()`, `status.Signal()` are methods on `syscall.WaitStatus`. No bitmask twiddling needed.
- `syscall.Wait4` with a specific pid (not `-1`) ensures we never reap an unrelated child.
- `syscall.EINTR` can legitimately interrupt `Wait4`; we loop rather than bail.
- We do not use `s.cmd.ProcessState` anywhere, so skipping `cmd.Wait()` is safe: for PTY-started children `exec.Cmd` holds no stdio pipes to close (stdio is dup'd onto the pty inside `pty.Start`), so there is no Go-side fd leak from not calling `Wait()`.

- [ ] **Step 4: Build the package to catch obvious typos**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && go build ./internal/relay/
```
Expected: no output, exit 0.

If the build fails, fix the error before continuing.

- [ ] **Step 5: Run the new auto-resume test and confirm it passes**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -run TestServerAutoResumeOnSIGTSTP -v -timeout 30s
```
Expected: `--- PASS: TestServerAutoResumeOnSIGTSTP` followed by `PASS` and `ok  ...`. Output must contain both `before-stop` and `after-cont`.

- [ ] **Step 6: Run the full relay test suite for regressions**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -v -timeout 60s
```
Expected: all existing tests (`TestServerStartAndConnect`, `TestServerReplay`, `TestServerInput`, `TestServerResize`, `TestServerSocketCleanup`, `TestServerAutoResumeOnSIGTSTP`, plus any history/buffer/client tests) PASS. Final line `ok  	github.com/.../internal/relay`.

If anything regresses, diagnose before continuing — do not commit a red suite.

- [ ] **Step 7: Run the whole Go test suite**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/... -timeout 120s
```
Expected: all packages PASS.

- [ ] **Step 8: Commit the fix**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && git add internal/relay/server.go && git commit -m "fix(relay): auto-resume stopped child via Wait4+SIGCONT"
```
Expected: one file changed, clean commit.

---

## Task 4: Manual smoke check (optional, human-run)

**Files:** none

Not blocking the plan, but record the result if you do it:

- [ ] **Step 1: Build and run Jackdaw in dev mode**

Run:
```
cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41
```
Expected: dev window opens.

- [ ] **Step 2: Start a `claude` session, press Ctrl+Z**

Expected: Claude prints its "suspended" banner briefly, then the session keeps working. Input reaches Claude again. No stuck terminal, no garbled dead alt-screen.

- [ ] **Step 3: Close the window**

No commit from this task.

---

## Done criteria

- `git grep -n 'cmd\.Wait\b' internal/relay` returns no matches.
- `git grep -n 'ProcessState' internal/relay` returns no matches.
- `go test ./internal/relay/ -v` is fully green, including `TestServerAutoResumeOnSIGTSTP`.
- `go test ./internal/...` is fully green.
- Two commits on `fix-ctrl-z-autocont`: the failing test, then the fix.
