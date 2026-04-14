# Ctrl-Z Auto-Resume Design

## Problem

Jackdaw's relay spawns session commands (e.g. `claude`) directly as the PTY's child process — no shell in between (`internal/relay/server.go:33`). Claude Code binds Ctrl+Z in its own input handler and calls `raise(SIGTSTP)` on itself, expecting a parent shell to catch `SIGCHLD` and provide job control (`fg`).

There is no parent shell in Jackdaw's session model. When Claude self-suspends, the process enters stopped state (`T`) and no one ever resumes it. Keystrokes typed into the terminal flow through the PTY into a buffer that the stopped child never reads. The terminal appears "dead" with visual garble from Claude's last alt-screen frame, and the session is effectively lost until the user kills it.

Reproduction: open a Jackdaw session running `claude`, press Ctrl+Z. Observe the "Claude Code has been suspended. Run `fg` to bring Claude Code back." banner; shell input then has no effect because there is no shell.

## Goal

Ctrl+Z inside any Jackdaw session must not be able to leave the child stuck in stopped state. After the child stops, it should be resumed automatically and transparently, so the user's session keeps working.

Non-goals:
- Building shell-like job control into Jackdaw sessions (roadmap item, not this fix).
- Preventing Claude from self-suspending (we don't control Claude's keybindings).
- Preserving the brief "suspended" banner Claude prints — acceptable collateral, disappears on next redraw.

## Approach

The relay watches its own child process for stopped state and immediately sends `SIGCONT` whenever it stops. This works universally for any command the relay spawns, not just Claude, and closes the bug without introducing shells or other process-model changes.

Detection mechanism: replace the current `s.cmd.Wait()` call in `Server.waitProcess()` with a `syscall.Wait4` loop targeting the specific child pid (never `-1` — we don't reap unrelated children). Pass `WUNTRACED` so `Wait4` returns on both stop and exit. On each return:

- `syscall.WIFSTOPPED(status)` true → call `s.cmd.Process.Signal(syscall.SIGCONT)` and continue the loop.
- `syscall.WIFEXITED(status)` or `syscall.WIFSIGNALED(status)` true → process has terminated; store exit info on `Server` and return.

Use `syscall.Wait4` (not `golang.org/x/sys/unix`) to match existing imports in the package.

## Key Implementation Constraint

Go's `exec.Cmd.Wait()` internally calls `waitpid` to reap the child. Running a custom `Wait4` loop alongside `cmd.Wait()` creates two waiters for the same pid, which is undefined behavior. The plan must ensure only one waiter exists.

Resolution: the custom `Wait4` loop becomes the single waiter; `s.cmd.Wait()` is no longer called. Store the final exit status (e.g. as a new field on `Server` — exact shape is a plan-level decision) and expose it via whatever method previously relied on `cmd.ProcessState`. The plan-writer must grep `internal/relay/` for uses of `s.cmd.ProcessState` and `s.cmd.Wait` and migrate them to read from the new field. For a PTY-started child, stdio pipes are not attached via `exec.Cmd`, so skipping `cmd.Wait()` should not leak Go-side resources — the plan must still confirm by inspection.

## Scope

One file changes: `internal/relay/server.go`. The `waitProcess` function is rewritten; no API or wire-protocol changes. No frontend changes.

## Testing

- Unit test: spin up a relay with a short-lived test binary that raises `SIGTSTP` on itself, assert the relay sends `SIGCONT` and the child then runs to completion instead of staying stopped. Test lives alongside existing relay tests.
- Manual test: open a Jackdaw session with `claude`, press Ctrl+Z, confirm the session keeps working and input reaches Claude again.
- Regression: existing relay tests (session exit handling, scrollback replay after exit) must continue to pass — this change alters how the relay learns about exit, and any test that peeks at `cmd.ProcessState` post-wait needs to read the new state location instead.

## Out of Scope

- Shell-wrapped sessions (approach B from design discussion).
- Intercepting Ctrl+Z in the frontend.
- Fixing Claude Code's upstream behavior.
- Platform support: the fix is Linux/macOS only. Jackdaw doesn't support Windows, so no portability shim is needed.
