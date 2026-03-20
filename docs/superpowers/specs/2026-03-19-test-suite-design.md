# Test Suite Design for Jackdaw

## Approach

Extract-and-test: pull pure logic out of coupled functions where needed, add unit tests for all pure logic. No trait-based DI or heavy mocking infrastructure.

## Backend (Rust)

### Dependencies

Add to `src-tauri/Cargo.toml` under `[dev-dependencies]`:
- `tempfile` — for filesystem tests in hooks.rs

### state.rs — Unit Tests

Add `#[cfg(test)] mod tests` with:

**`extract_summary`**
- Each tool type: Bash→command, Read/Write/Edit→file_path, Glob/Grep→pattern, Agent→description
- `None` tool_input returns `None`
- Missing expected field returns `None`
- Strings >120 chars are truncated

**`Session::new`**
- Verify default field values (no current_tool, empty history, 0 subagents, not processing, not pending)

**`Session::set_current_tool`**
- Setting when `current_tool` is `None` — sets it, history unchanged
- Setting when `current_tool` is `Some` — previous tool moves to history

**`Session::complete_tool`**
- Match by `tool_use_id` — matched tool moves to history with completed data
- Event has `tool_use_id: None`, fallback to `tool_name` match — current tool moves to history
- Event has `tool_use_id: Some("wrong")` (ID mismatch) — incoming tool appended to history directly, current tool unchanged
- No current tool at all — incoming tool appended to history

**`Session::push_history`**
- Under 50 items — appends
- At 50 items — removes oldest, appends new (FIFO)

### hooks.rs — Unit + Filesystem Tests

**Pure JSON logic (unit tests):**

`check_status`
- Empty settings object → `NotInstalled`
- All 9 events with correct Jackdaw URL → `Installed`
- Some events present (e.g. 5 of 9 at correct port) → `Outdated` (partial install path)
- Zero correct-port hooks but has localhost:*/events URL → `Outdated` (old install path)
- No `hooks` key → `NotInstalled`

`install`
- Empty settings → adds hooks object with all 9 events
- Existing non-Jackdaw hooks preserved
- Existing Jackdaw hooks with wrong port replaced

`uninstall`
- Removes all Jackdaw matcher groups
- Preserves non-Jackdaw matcher groups
- Cleans up empty event arrays
- Removes empty hooks object

`is_jackdaw_matcher_group`
- Valid Jackdaw URL → true
- Non-Jackdaw URL → false
- Valid JSON object missing expected fields → false

**Filesystem tests (using `tempfile`):**

`read_settings`
- File exists with valid JSON → parsed
- File doesn't exist → returns `{}`

`write_settings`
- Writes JSON, creates parent dirs
- Atomic write (temp file + rename)

### tray.rs — Extract and Test

Extract a pure function:
```rust
pub fn compute_tray_state(sessions: &[Session]) -> (usize, usize)
// Returns (running_count, waiting_count)
// running: current_tool.is_some() || active_subagents > 0 || processing
// waiting: !running
```

Tests:
- No sessions → (0, 0)
- All running → (n, 0)
- All waiting → (0, n)
- Mixed → correct counts
- Pending-only session (pending_approval=true, processing=false, no tool, 0 subagents) → counts as waiting

## Frontend (TypeScript)

### Dependencies

Add to `package.json` devDependencies:
- `vitest` — test runner

Add `npm test` script: `vitest run`

### src/lib/utils.ts — New File

Extract from `SessionCard.svelte`:

**`getUptime(startedAt: string): string`**
- 5 minutes ago → `"5m ago"`
- 90 minutes ago → `"1h 30m ago"`
- 0 minutes → `"0m ago"`

**`shortenPath(path: string): string`**
- `/home/andy/projects/foo` → `~/projects/foo`
- `/home/otheruser/foo` → `~/foo` (replaces any `/home/*/` prefix)
- `/tmp/foo` → `/tmp/foo` (unchanged)
- `/Users/andy/foo` → `/Users/andy/foo` (macOS paths unchanged — regex only matches `/home/*/`)

**`shortenSessionId(id: string): string`**
- 12-char string → first 8 chars
- 5-char string → unchanged

### src/lib/stores/sessions.svelte.ts — Store Tests

Mock `@tauri-apps/api/event` (vi.mock).

**`SessionStore`**
- `count` returns `sessions.length`
- `runningCount` filters correctly: current_tool set, active_subagents > 0, processing true
- `runningCount` negative case: pending-only session (pending_approval=true, everything else false/null/0) → not counted as running

## Out of Scope

- Component/visual tests for Svelte components
- Integration tests for server.rs HTTP handler
- Tests for lib.rs Tauri commands
- Tests for tray.rs menu/icon creation (Tauri runtime required)
