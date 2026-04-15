# Sidebar ANSI Stripping Hardening Design

## Summary

Jackdaw sometimes displays ANSI escape sequences in session sidebar text derived from backend session output processing. The current implementation uses two hand-rolled regular expressions to strip ANSI codes in separate packages:

- `internal/session/statustracker.go`
- `internal/notification/ansi.go`

This change will adopt a dedicated ANSI-stripping library, create a single shared backend helper in `internal/ansi`, and route all current backend PTY-output sanitization through that helper. Because PTY reads may split escape sequences across chunk boundaries, the status-tracker path will also gain minimal carryover buffering so partial ANSI fragments do not leak into sidebar `last_line` text.

## Problem

The sidebar displays `DashboardSession.last_line`, which comes from `StatusTracker.LastLine()` after `HandleOutput()` processes PTY output. ANSI sequences are currently removed with a local regex before prompt detection and last-line extraction, but the regex is duplicated and may not cover all real terminal escape variants. When unsupported or partial sequences survive, the sidebar can show raw escape text.

## Goals

- Eliminate ANSI escape sequences from sidebar-derived session text reliably.
- Replace hand-maintained stripping regexes with a purpose-built library.
- Centralize ANSI stripping so display-text derivation does not drift across packages.
- Preserve existing status-tracker behavior for prompt detection and last-line truncation.
- Ensure split ANSI sequences across PTY reads do not leak fragments into `last_line`.
- Keep notification/error-detection stripping behavior aligned with session output stripping.

## Non-goals

- Changing terminal rendering in xterm.js.
- Reworking session lifecycle or dashboard transport formats.
- Broad terminal output normalization beyond ANSI stripping.
- Frontend-side sanitization as the primary fix or fallback for this change.

## Context and Current Architecture

### Sidebar data flow

1. PTY output is read by the backend session manager.
2. `StatusTracker.HandleOutput()` receives raw bytes.
3. The tracker strips ANSI codes, extracts a non-empty non-prompt last line, and updates status.
4. `Manager.DashboardData()` exposes `last_line` to the frontend.
5. `frontend/src/lib/Sidebar.svelte` renders `session.last_line`.

### Current stripping implementation

There are two separate regex-based stripping implementations today:

- `internal/session/statustracker.go`: local `ansiPattern`
- `internal/notification/ansi.go`: package helper `StripANSI`

This duplication creates two issues:

- correctness can diverge over time
- fixes in one path may not propagate to the other

### Repo audit scope for this change

A targeted audit of current PTY-output sanitization paths found these relevant backend call sites:

- `internal/session/statustracker.go` for sidebar-facing `last_line` extraction and prompt detection
- `internal/notification/errordetector.go` via `internal/notification/ansi.go`
- `internal/notification/pattern.go` via `internal/notification/ansi.go`

For this hardening pass, these are the complete required migration targets. Completion means all three call paths use the same shared ANSI helper.

## Library Choice

Use `github.com/acarl005/stripansi` as the dedicated ANSI-stripping dependency.

### Selection criteria it satisfies

- purpose-built specifically for removing ANSI escape sequences
- simple, low-risk API surface
- appropriate for backend sanitization before parsing display text
- avoids maintaining custom regexes in Jackdaw code

## Options Considered

### Option A — Keep regexes and patch them further

**Pros**
- no dependency changes
- smallest code diff

**Cons**
- still hand-maintained
- high chance of incomplete coverage for real-world escape sequences
- duplicated logic remains
- does not address long-term maintainability
- still leaves chunk-boundary behavior underspecified

### Option B — Adopt a dedicated Go ANSI-stripping library, centralize stripping, and handle split PTY chunks in status tracking (recommended)

**Pros**
- purpose-built stripping behavior
- simpler application code
- one stripping source used by status tracking and notification/error detection
- explicit handling for chunk-boundary leakage in the sidebar path
- easy to extend tests around one canonical helper

**Cons**
- adds a dependency
- requires a small wrapper layer and carryover state in `StatusTracker`

### Option C — Add frontend-side sanitization on top of backend regexes

**Pros**
- protects the final rendering layer
- can mask backend misses in the sidebar

**Cons**
- fixes symptoms, not root cause
- other backend consumers could still observe dirty text
- duplicates sanitization across backend and frontend
- not aligned with the current architecture where display text is derived server-side

## Decision

Choose **Option B**.

Jackdaw will:

1. add `github.com/acarl005/stripansi`
2. create `internal/ansi` as the single shared sanitization package
3. migrate current backend call sites to it
4. add minimal carryover buffering in `StatusTracker` so split escape sequences across PTY reads do not leak into sidebar text or prompt detection

## Proposed Design

### 1. Create a canonical helper package

Create `internal/ansi` as the canonical backend helper package.

Planned exported helpers:

- `StripString(s string) string`
- `StripBytes(b []byte) []byte`

Implementation notes:

- The package will wrap `github.com/acarl005/stripansi`.
- `StripBytes` may convert through string internally so call sites remain byte-oriented.
- Empty or nil input returns empty output.

This package becomes the only place in Jackdaw that knows about ANSI-stripping implementation details.

### 2. Migrate all current backend sanitization call sites

Update these paths to use `internal/ansi`:

- `internal/session/statustracker.go`
- `internal/notification/errordetector.go`
- `internal/notification/pattern.go`

`internal/notification/ansi.go` should either be removed or reduced to a thin compatibility wrapper that delegates to `internal/ansi`, depending on what yields the cleanest migration. The end state must not keep separate regex logic.

### 3. Handle split ANSI sequences in `StatusTracker`

A library swap alone is not enough because `HandleOutput(data []byte)` is called per PTY read, and escape sequences can be split across chunks.

To address that, `StatusTracker` will maintain a small carryover buffer for incomplete trailing escape fragments from the previous chunk.

Processing model:

1. prepend carryover bytes to the new chunk
2. detect whether the combined bytes end with an incomplete ANSI sequence
3. keep the incomplete suffix in carryover for the next call
4. strip ANSI from the complete prefix only
5. run last-line extraction and prompt detection on the cleaned complete bytes

Carryover contract:

- buffer incomplete trailing **CSI** sequences beginning with `ESC [` and ending only when their final byte arrives
- buffer incomplete trailing **OSC** sequences beginning with `ESC ]` and ending only on either `BEL` (`\x07`) or string terminator `ESC \\`
- no other ESC-prefixed sequence families are required for chunk-boundary buffering in this change
- maximum carryover size: **256 bytes**
- overflow behavior: if the incomplete trailing fragment would exceed 256 bytes, discard the carryover buffer and fall back to stateless stripping for that chunk so memory cannot grow without bound

Scope decision:

- carryover buffering is required only in the sidebar/status-tracker path where chunk-boundary leakage affects user-visible text and prompt detection
- notification/error-detection paths are migrated to the shared helper but remain intentionally stateless in this change
- rationale: notification matching analyzes transient output for side effects, while the reported bug is specifically leakage into sidebar display text; keeping notification paths stateless minimizes scope while still centralizing stripping logic

### 4. Preserve status-tracker behavior

The following behavior must remain unchanged apart from improved sanitization:

- prompt detection using the Claude Code prompt line
- `idle` transition debounce timing
- `last_line` extraction of the final non-empty, non-prompt line
- truncation of stored `last_line` preserved exactly as today: after stripping and byte-to-string conversion, cap using the current `len(s) > 200` / `s[:200]` behavior
- no status changes after terminal states

### 5. Regression-focused testing

Tests must cover the real failure modes relevant to this change.

Required fixtures:

- colored output reaches `LastLine()` without ANSI remnants
- prompt wrapped in ANSI codes still transitions to `idle`
- OSC/title sequences are removed
- a split escape sequence across two `HandleOutput()` calls does not leak raw fragments into `last_line`
- notification stripping remains consistent after the shared-helper migration

## Files Expected to Change

- `go.mod`
- `go.sum`
- `internal/session/statustracker.go`
- `internal/session/statustracker_test.go`
- `internal/notification/errordetector.go` and/or `internal/notification/pattern.go`
- `internal/notification/ansi.go` if retained as a wrapper, otherwise removed
- `internal/notification/ansi_test.go` if retained, otherwise tests move to shared helper
- `internal/ansi/ansi.go`
- `internal/ansi/ansi_test.go`

## Error Handling

- ANSI stripping remains best-effort and non-failing.
- Empty or nil input should safely return empty output.
- Carryover buffering in `StatusTracker` must never grow without bound.
- No user-visible errors are introduced by the sanitization layer.

## Testing Strategy

### Automated

Run:

- `go test ./internal/...`

Focus assertions on:

- status tracker idle prompt detection after stripping
- last-line extraction without ANSI remnants
- split-sequence handling across PTY reads
- notification/error detector inputs being stripped consistently

### Manual

Create or use a session that emits colored/status-rich output and verify:

- sidebar `last_line` shows plain text only
- no raw escape sequences appear in session list cards
- status transitions still behave correctly for prompt and approval states

## Risks

- The dependency may not cover every edge case exactly as desired, so regression tests are required.
- Carryover logic adds a small amount of statefulness to `StatusTracker`; bounded buffering and targeted tests keep this low risk.
- If stripping semantics change subtly, prompt detection could regress; prompt tests are therefore mandatory.

## Rollout Notes

This is a low-risk backend hardening change with no frontend API changes expected.

## Approval Request

If approved, the next phase will produce an implementation plan that:

1. adds `github.com/acarl005/stripansi`,
2. creates `internal/ansi`,
3. migrates the audited backend call sites,
4. implements bounded carryover buffering in `StatusTracker`,
5. adds regression coverage,
6. verifies the internal Go test suite.
