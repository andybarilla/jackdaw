# Sidebar ANSI Strip Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan.

**Goal:** Replace duplicated regex-based ANSI stripping with a shared backend helper, and harden sidebar-facing status tracking against split PTY escape sequences without changing existing `last_line` truncation or frontend data flow.
**Architecture:** Add a new `internal/ansi` package that wraps `github.com/acarl005/stripansi` and becomes the single backend sanitization implementation. Keep notification matching stateless, but make `StatusTracker` stateful enough to buffer trailing partial CSI and OSC fragments across `HandleOutput()` calls so sidebar `last_line` and prompt detection stop leaking split escape text.
**Tech Stack:** Go 1.22, Wails v2 backend, `github.com/acarl005/stripansi`, existing Go test suite under `internal/...`.

---

## Scope guard

This plan is intentionally limited to the approved design in `docs/superpowers/specs/2026-04-15-sidebar-ansi-strip-design.md`:

- add `github.com/acarl005/stripansi`
- create `internal/ansi`
- migrate status tracker and notification consumers to the shared helper
- add bounded carryover buffering in `StatusTracker` for split CSI and OSC sequences
- support OSC terminators `BEL` and `ESC \\`
- cap carryover at 256 bytes with discard-and-fallback overflow behavior
- preserve current `last_line` truncation semantics exactly
- leave notification paths stateless

Do **not** add frontend sanitization, dashboard schema changes, broader terminal normalization, or unrelated refactors.

## Codebase map verified during planning

### Existing files and responsibilities

- `internal/session/statustracker.go:3-154`
  - owns session status transitions, prompt detection, and sidebar `last_line` derivation
  - currently strips ANSI with a package-local regex before extracting lines
- `internal/session/statustracker_test.go:9-260`
  - covers prompt detection, status transitions, last-line extraction, ANSI stripping, and truncation
- `internal/notification/ansi.go:1-9`
  - currently owns a second ANSI-stripping regex helper
- `internal/notification/ansi_test.go:1-45`
  - currently tests the notification-local stripping helper
- `internal/notification/errordetector.go:45-56`
  - strips ANSI before line-by-line error pattern matching
- `internal/notification/pattern.go:40-47`
  - strips ANSI before input/approval prompt matching
- `frontend/src/lib/Sidebar.svelte`
  - simply renders `session.last_line`; no sanitization is performed here now
- `go.mod:5-39`
  - dependency declaration site for the new stripping library

### Planned file structure after implementation

- `go.mod`
  - direct dependency on `github.com/acarl005/stripansi`
- `go.sum`
  - checksum updates from `go mod tidy` or `go test`
- `internal/ansi/ansi.go` **(new)**
  - canonical shared ANSI helper with `StripString(string) string` and `StripBytes([]byte) []byte`
- `internal/ansi/ansi_test.go` **(new)**
  - canonical stripping tests, including CSI and OSC coverage
- `internal/session/statustracker.go`
  - import shared helper and add bounded carryover handling for trailing partial CSI/OSC sequences
- `internal/session/statustracker_test.go`
  - add regression tests for split sequences, prompt detection with ANSI, OSC stripping, and overflow fallback
- `internal/notification/errordetector.go`
  - call `internal/ansi.StripBytes`
- `internal/notification/pattern.go`
  - call `internal/ansi.StripBytes`
- `internal/notification/ansi.go`
  - temporarily become a thin compatibility wrapper around `internal/ansi` during migration, then be deleted after notification consumers move
- `internal/notification/ansi_test.go`
  - either become thin-wrapper coverage temporarily or be deleted in the final migration task after canonical coverage lives in `internal/ansi/ansi_test.go`
- `frontend/src/lib/Sidebar.svelte`
  - **no code change expected**; backend hardening should preserve its current rendering contract

## Implementation notes the engineer must follow

- TDD first on every task.
- All new exported helpers must have explicit parameter and return types.
- Keep imports at the top of files.
- Do not change `Sidebar.svelte` unless implementation unexpectedly proves the spec wrong. That should be escalated instead of widened.
- Preserve `StatusTracker.LastLine()` truncation exactly as it exists today:
  - convert the selected line to `string`
  - if `len(s) > 200`, store `s[:200]`
- Carryover buffering rules for `StatusTracker`:
  - prepend prior carryover to the new PTY chunk
  - detect incomplete trailing CSI sequences that start with `ESC [` and have not yet reached a final byte
  - detect incomplete trailing OSC sequences that start with `ESC ]` and have not yet reached `BEL` (`\x07`) or `ESC \\`
  - buffer only the incomplete trailing suffix; process the complete prefix immediately
  - maximum carryover length is 256 bytes
  - if the incomplete suffix would exceed 256 bytes, discard carryover and process the chunk statelessly with plain stripping
- Notification code remains stateless in this change; do not add buffering there.

---

### Task 1: Introduce the shared ANSI helper package

**Files:**
- Modify: `go.mod:5-39`
- Modify: `go.sum`
- Create: `internal/ansi/ansi.go`
- Create: `internal/ansi/ansi_test.go`
- Modify: `internal/notification/ansi.go:1-9`
- Optional modify or later delete: `internal/notification/ansi_test.go:1-45`
- Reference only: `docs/superpowers/specs/2026-04-15-sidebar-ansi-strip-design.md`

- [ ] **Step 1: Write the failing shared-helper tests**
Create `internal/ansi/ansi_test.go` with package-level tests for the new canonical API:
  - `TestStripStringRemovesColorCodes`
  - `TestStripBytesRemovesMultipleCSISequences`
  - `TestStripBytesRemovesOSCBELSequence`
  - `TestStripBytesRemovesOSCSTSequence`
  - `TestStripBytesPreservesPlainText`
  - `TestStripBytesHandlesNilInput`

Use concrete fixtures like these in the test body:

```go
package ansi

import "testing"

func TestStripStringRemovesColorCodes(t *testing.T) {
	input := "\x1b[31merror: something failed\x1b[0m"
	got := StripString(input)
	want := "error: something failed"
	if got != want {
		t.Fatalf("StripString() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesMultipleCSISequences(t *testing.T) {
	input := []byte("\x1b[1m\x1b[33mwarning:\x1b[0m something happened")
	got := string(StripBytes(input))
	want := "warning: something happened"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesOSCBELSequence(t *testing.T) {
	input := []byte("\x1b]0;title\x07error: failed")
	got := string(StripBytes(input))
	want := "error: failed"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesOSCSTSequence(t *testing.T) {
	input := []byte("\x1b]0;title\x1b\\build failed")
	got := string(StripBytes(input))
	want := "build failed"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesPreservesPlainText(t *testing.T) {
	input := []byte("just normal text")
	got := string(StripBytes(input))
	want := "just normal text"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesHandlesNilInput(t *testing.T) {
	got := StripBytes(nil)
	if len(got) != 0 {
		t.Fatalf("len(StripBytes(nil)) = %d, want 0", len(got))
	}
}
```

- [ ] **Step 2: Run the new tests and confirm they fail before implementation**
Run:
```bash
go test ./internal/ansi
```
Expected: FAIL with a package-not-found or undefined-symbol error because `internal/ansi` and its helpers do not exist yet.

- [ ] **Step 3: Implement the shared helper and dependency**
Add `github.com/acarl005/stripansi` to `go.mod` as a direct dependency and create `internal/ansi/ansi.go` with the approved public API:

```go
func StripString(s string) string
func StripBytes(b []byte) []byte
```

Implementation requirements:
- use `github.com/acarl005/stripansi` as the primary stripping library
- supplement it so `internal/ansi` also removes **OSC sequences terminated by `ESC \\`** (`ST`), since the approved spec requires support for both OSC terminators:
  - `BEL` (`\x07`)
  - `ESC \\`
- it is acceptable for `internal/ansi` to use a small additional regex or targeted post-processing pass for `ESC ] ... ESC \\` removal after calling the library
- `StripString("")` should return `""`
- `StripBytes(nil)` should return `[]byte{}`
- `StripBytes` may convert through `string` internally and return `[]byte(StripString(string(b)))`

Then convert the duplicated notification-local helper into a temporary compatibility wrapper so the repo stays buildable while consumers are migrated:
- change `internal/notification/ansi.go` to delegate to `internal/ansi.StripBytes`
- keep `internal/notification/ansi_test.go` only if needed for compatibility during the transition; otherwise remove it in Task 3 after all consumers migrate

Notes:
- Do not leave the repository in a knowingly uncompilable state at the end of this task.

- [ ] **Step 4: Run helper tests and module tidy/verification**
Run:
```bash
go test ./internal/ansi
```
Expected: PASS

Then run:
```bash
go test ./internal/...
```
Expected: PASS, because the temporary notification compatibility wrapper keeps existing consumers buildable until Task 3.

- [ ] **Step 5: Commit the helper-package slice**
Run:
```bash
git add go.mod go.sum internal/ansi/ansi.go internal/ansi/ansi_test.go internal/notification/ansi.go internal/notification/ansi_test.go
git commit -m "Add shared ANSI stripping helper"
```

---

### Task 2: Harden `StatusTracker` against split ANSI sequences

**Files:**
- Modify: `internal/session/statustracker.go:3-93`
- Modify: `internal/session/statustracker_test.go:22-260`
- Reference only: `internal/ansi/ansi.go`

- [ ] **Step 1: Add failing status-tracker regression tests**
Extend `internal/session/statustracker_test.go` with these tests before modifying the implementation:

1. `TestHandleOutputWithANSIStillTriggersIdle`
   - keep the current ANSI-wrapped prompt coverage, but rename if needed for clarity.
2. `TestLastLineRemovesOSCSequence`
   - feed `[]byte("\x1b]0;title\x07build completed\n")`
   - expect `LastLine()` to be `"build completed"`
3. `TestLastLineHandlesSplitCSISequenceAcrossChunks`
   - first call: `st.HandleOutput([]byte("\x1b[32"))`
   - second call: `st.HandleOutput([]byte("mcolored output\x1b[0m\n"))`
   - expect `LastLine()` to be `"colored output"`
4. `TestPromptDetectionHandlesSplitCSIWrappedPromptAcrossChunks`
   - first call: `st.HandleOutput([]byte("\x1b[32"))`
   - second call: `st.HandleOutput([]byte("m❯\x1b[0m "))`
   - after debounce, expect `StatusIdle`
5. `TestLastLineHandlesSplitOSCBELSequenceAcrossChunks`
   - first call: `st.HandleOutput([]byte("\x1b]0;tit"))`
   - second call: `st.HandleOutput([]byte("le\x07ready\n"))`
   - expect `LastLine()` to be `"ready"`
6. `TestLastLineHandlesSplitOSCSTSequenceAcrossChunks`
   - first call: `st.HandleOutput([]byte("\x1b]0;title\x1b"))`
   - second call: `st.HandleOutput([]byte("\\ready\n"))`
   - expect `LastLine()` to be `"ready"`
7. `TestCarryoverOverflowFallsBackToStatelessStripping`
   - build an incomplete OSC payload longer than 256 bytes that also includes visible printable text in the same overflowing chunk, e.g. `[]byte("\x1b]0;" + strings.Repeat("a", 300) + " visible output\n")`
   - call `HandleOutput()` with that single overflowing payload
   - expect the tracker to keep operating without panic and to process that same chunk statelessly rather than discard it
   - assert `LastLine()` reflects the processed output from the overflowing chunk in whatever exact form the fallback logic is designed to preserve after stateless stripping
   - then call `HandleOutput([]byte("safe output\n"))` and confirm the tracker still updates `LastLine()` to `"safe output"`
8. `TestLastLineTruncationStillCapsAt200AfterStrip`
   - construct a line where ANSI is removed but resulting text is still over 200 bytes
   - expect `len(LastLine()) == 200`

Use existing `newTestTracker()` and existing debounce timing.

- [ ] **Step 2: Run the status-tracker tests to confirm failure**
Run:
```bash
go test ./internal/session
```
Expected: FAIL in the newly added split-sequence and OSC tests because current `HandleOutput()` strips each chunk statelessly and leaks partial escape fragments.

- [ ] **Step 3: Implement bounded carryover in `StatusTracker`**
Update `internal/session/statustracker.go` with these exact structural changes:

1. Replace the local ANSI regex import/usage with `internal/ansi`.
2. Add a carryover field to `StatusTracker`:

```go
carryover []byte
```

3. Add constants near the top of the file:

```go
const (
	maxANSICarryover = 256
)
```

4. Refactor `HandleOutput(data []byte)` so it:
   - locks before mutating carryover state
   - prepends `st.carryover` to the new `data`
   - splits the combined bytes into:
     - a complete prefix to sanitize immediately
     - an incomplete trailing ANSI suffix to save in `st.carryover`
   - strips ANSI from the complete prefix using `ansi.StripBytes`
   - reuses the current last-line extraction and prompt detection logic on the stripped prefix
   - preserves terminal-state short-circuiting and idle debounce behavior

5. Add private helpers in the same file to keep `HandleOutput()` readable:

Suggested signatures:

```go
func splitTrailingANSICarryover(data []byte) (complete []byte, carryover []byte)
func trailingPartialCSIStart(data []byte) int
func trailingPartialOSCStart(data []byte) int
func hasCompleteOSCTerminator(data []byte, start int) bool
```

Implementation requirements for those helpers:
- `trailingPartialCSIStart` should find the last `ESC [` sequence whose final byte has not arrived yet.
- A valid CSI final byte is any byte in the standard final range `0x40` through `0x7e`.
- `trailingPartialOSCStart` should find the last `ESC ]` sequence whose terminator is still incomplete.
- OSC is complete only if, after the `ESC ]` start, the sequence contains either:
  - `BEL` (`0x07`), or
  - `ESC \\`
- `splitTrailingANSICarryover` should prefer the earliest incomplete trailing escape start when both detection helpers find candidates in the suffix.
- If the carryover candidate length exceeds 256 bytes, return the full input as `complete` and `nil` carryover so stripping falls back to stateless processing for that chunk.

6. Preserve current last-line logic exactly after sanitization:
   - split on `\n`
   - trim right `\r `
   - skip empty lines and prompt lines
   - convert selected line to string
   - truncate with `if len(s) > 200 { s = s[:200] }`
   - store to `st.lastLine`

7. Preserve current prompt detection and debounce semantics exactly, but run them against stripped complete bytes only.
8. If `splitTrailingANSICarryover` returns an empty `complete` prefix, `HandleOutput()` must only update `st.carryover` and return immediately without running last-line extraction, prompt detection, or debounce-cancel logic. This preserves existing idle/prompt semantics when a read contains only an incomplete trailing escape fragment.

- [ ] **Step 4: Run the status-tracker test suite**
Run:
```bash
go test ./internal/session
```
Expected: PASS

Then run a focused regression command for the most fragile cases:
```bash
go test ./internal/session -run 'TestLastLineHandlesSplit|TestPromptDetectionHandlesSplit|TestCarryoverOverflowFallsBackToStatelessStripping|TestLastLineTruncationStillCapsAt200AfterStrip'
```
Expected: PASS

- [ ] **Step 5: Commit the status-tracker slice**
Run:
```bash
git add internal/session/statustracker.go internal/session/statustracker_test.go
git commit -m "Harden status tracker ANSI carryover handling"
```

---

### Task 3: Migrate notification consumers to the shared helper

**Files:**
- Modify: `internal/notification/errordetector.go:3-56`
- Modify: `internal/notification/pattern.go:3-48`
- Delete: `internal/notification/ansi.go`
- Delete or migrate: `internal/notification/ansi_test.go`
- Optional create if absent: `internal/notification/errordetector_test.go`
- Optional create if absent: `internal/notification/pattern_test.go`
- Reference only: `internal/ansi/ansi.go`
- Verify unchanged: `frontend/src/lib/Sidebar.svelte`

- [ ] **Step 1: Add failing notification regression tests if package coverage is missing**
If `internal/notification` does not already have tests for ANSI-bearing inputs in detector/matcher paths, add narrow tests that prove the consumers use stripped text rather than raw escape bytes.

Minimum required assertions:

1. `ErrorDetector.Feed()` fires on ANSI-wrapped error text:
```go
[]byte("\x1b[31merror: build failed\x1b[0m\n")
```
2. `PatternMatcher.Feed()` fires on ANSI-wrapped approval/input prompt text:
```go
[]byte("\x1b[33mApprove action?\x1b[0m")
```
3. Both remain stateless across chunk boundaries in this change:
   - do **not** add tests that expect split ANSI buffering here
   - only test complete-chunk stripping

Implementation note: use the package’s existing `Service` test pattern if one exists; otherwise, instantiate a minimal service double that records notifications.

- [ ] **Step 2: Run the notification tests to establish the pre-migration baseline**
Run:
```bash
go test ./internal/notification
```
Expected: this may already PASS because the temporary compatibility wrapper from Task 1 delegates to `internal/ansi`. The purpose of this step is to establish the baseline before switching consumers to direct imports and removing the wrapper.

- [ ] **Step 3: Switch notification consumers to `internal/ansi` and remove the temporary compatibility layer**
In `internal/notification/errordetector.go` and `internal/notification/pattern.go`:
- import `github.com/andybarilla/jackdaw/internal/ansi`
- replace `StripANSI(data)` with `ansi.StripBytes(data)`
- make no other behavioral changes

After both consumers are migrated:
- delete `internal/notification/ansi.go`
- delete `internal/notification/ansi_test.go` if it only covered the temporary wrapper, or migrate any still-useful assertions into `internal/ansi/ansi_test.go`

Do **not** introduce buffering, extra normalization, or message formatting changes.

- [ ] **Step 4: Run package and cross-package verification**
Run:
```bash
go test ./internal/notification
```
Expected: PASS

Then run:
```bash
go test ./internal/...
```
Expected: PASS

Optional frontend safety check, since `Sidebar.svelte` is intentionally untouched:
```bash
cd frontend && npm run check
```
Expected: PASS, confirming no accidental frontend contract breakage.

- [ ] **Step 5: Commit the notification migration slice**
Run:
```bash
git add -A internal/notification internal/ansi
git commit -m "Migrate notification ANSI stripping to shared helper"
```

This stages modified, added, and deleted files safely, including removal of `internal/notification/ansi.go` and `internal/notification/ansi_test.go`. Do not include `frontend/src/lib/Sidebar.svelte` unless it was actually modified, which is not expected in this plan.

---

## Final verification checklist

Before handing the work back, run these commands from repo root and record the outputs in the work log:

```bash
go test ./internal/...
cd frontend && npm run check
```

Expected:
- `go test ./internal/...` → PASS
- `cd frontend && npm run check` → PASS

Manual verification checklist:
- Launch the app in dev mode:
```bash
GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41
```
- Create or attach to a session that emits colored output and OSC title updates.
- Confirm sidebar cards show plain `last_line` text only.
- Confirm ANSI-wrapped prompt output still transitions session status to idle.
- Confirm no raw `^[`/escape fragments appear in the sidebar when ANSI sequences are split across output chunks.

## Expected end state

- All backend ANSI stripping goes through `internal/ansi`.
- `StatusTracker` no longer leaks split CSI/OSC fragments into sidebar `last_line`.
- Notification detectors use the same shared stripping implementation but remain stateless.
- `Sidebar.svelte` continues rendering `session.last_line` unchanged.

Plan complete and saved to `docs/superpowers/plans/2026-04-15-sidebar-ansi-strip-hardening.md`. Ready to execute?
