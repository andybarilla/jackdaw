# Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive unit tests to Jackdaw's existing Rust backend and TypeScript frontend.

**Architecture:** Tests live alongside source code in Rust (`#[cfg(test)] mod tests`) and in co-located `.test.ts` files for TypeScript. Pure utility functions are extracted from Svelte components into a shared `utils.ts` module. A `compute_tray_state` function is extracted from `tray.rs` for testability.

**Tech Stack:** Rust `#[cfg(test)]` + `tempfile` crate (backend), Vitest (frontend)

---

### Task 1: Add `tempfile` dev-dependency to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dev-dependencies section**

Add at the end of `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add tempfile dev-dependency for tests"
```

---

### Task 2: Tests for `state.rs` — `extract_summary`

**Files:**
- Modify: `src-tauri/src/state.rs` (add `#[cfg(test)] mod tests` at bottom)

- [ ] **Step 1: Write failing tests for `extract_summary`**

Add at the bottom of `src-tauri/src/state.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_summary_bash_command() {
        let input = Some(json!({"command": "ls -la"}));
        assert_eq!(extract_summary("Bash", &input), Some("ls -la".into()));
    }

    #[test]
    fn extract_summary_read_file_path() {
        let input = Some(json!({"file_path": "/src/main.rs"}));
        assert_eq!(extract_summary("Read", &input), Some("/src/main.rs".into()));
    }

    #[test]
    fn extract_summary_edit_file_path() {
        let input = Some(json!({"file_path": "/src/lib.rs"}));
        assert_eq!(extract_summary("Edit", &input), Some("/src/lib.rs".into()));
    }

    #[test]
    fn extract_summary_write_file_path() {
        let input = Some(json!({"file_path": "/src/new.rs"}));
        assert_eq!(extract_summary("Write", &input), Some("/src/new.rs".into()));
    }

    #[test]
    fn extract_summary_glob_pattern() {
        let input = Some(json!({"pattern": "**/*.rs"}));
        assert_eq!(extract_summary("Glob", &input), Some("**/*.rs".into()));
    }

    #[test]
    fn extract_summary_grep_pattern() {
        let input = Some(json!({"pattern": "fn main"}));
        assert_eq!(extract_summary("Grep", &input), Some("fn main".into()));
    }

    #[test]
    fn extract_summary_agent_description() {
        let input = Some(json!({"description": "Search for files"}));
        assert_eq!(extract_summary("Agent", &input), Some("Search for files".into()));
    }

    #[test]
    fn extract_summary_none_input() {
        assert_eq!(extract_summary("Bash", &None), None);
    }

    #[test]
    fn extract_summary_missing_field() {
        let input = Some(json!({"other_field": "value"}));
        assert_eq!(extract_summary("Bash", &input), None);
    }

    #[test]
    fn extract_summary_unknown_tool() {
        let input = Some(json!({"command": "test"}));
        assert_eq!(extract_summary("UnknownTool", &input), None);
    }

    #[test]
    fn extract_summary_truncates_at_120_chars() {
        let long_cmd = "a".repeat(200);
        let input = Some(json!({"command": long_cmd}));
        let result = extract_summary("Bash", &input).unwrap();
        assert_eq!(result.len(), 120);
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd src-tauri && cargo test extract_summary`
Expected: all 11 tests pass (these test existing code, not TDD for new code)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "test: add extract_summary unit tests"
```

---

### Task 3: Tests for `state.rs` — `Session` methods

**Files:**
- Modify: `src-tauri/src/state.rs` (add to existing `mod tests`)

- [ ] **Step 1: Write tests for `Session::new`**

Add inside the existing `mod tests` block:

```rust
    #[test]
    fn session_new_defaults() {
        let s = Session::new("sess-1".into(), "/home/test".into());
        assert_eq!(s.session_id, "sess-1");
        assert_eq!(s.cwd, "/home/test");
        assert!(s.current_tool.is_none());
        assert!(s.tool_history.is_empty());
        assert_eq!(s.active_subagents, 0);
        assert!(!s.pending_approval);
        assert!(!s.processing);
    }
```

- [ ] **Step 2: Write tests for `Session::set_current_tool`**

```rust
    fn make_tool(name: &str, id: Option<&str>) -> ToolEvent {
        ToolEvent {
            tool_name: name.into(),
            timestamp: Utc::now(),
            summary: None,
            tool_use_id: id.map(String::from),
        }
    }

    #[test]
    fn set_current_tool_when_none() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Bash");
        assert!(s.tool_history.is_empty());
    }

    #[test]
    fn set_current_tool_moves_previous_to_history() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.set_current_tool(make_tool("Read", Some("id-2")));
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Read");
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }
```

- [ ] **Step 3: Write tests for `Session::complete_tool`**

```rust
    #[test]
    fn complete_tool_id_match() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(Some("id-1"), make_tool("Bash", Some("id-1")));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn complete_tool_name_fallback_when_no_event_id() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(None, make_tool("Bash", None));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Bash");
    }

    #[test]
    fn complete_tool_id_mismatch_keeps_current() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.set_current_tool(make_tool("Bash", Some("id-1")));
        s.complete_tool(Some("wrong-id"), make_tool("Read", Some("wrong-id")));
        // Current tool unchanged
        assert_eq!(s.current_tool.as_ref().unwrap().tool_name, "Bash");
        // Incoming tool appended to history
        assert_eq!(s.tool_history.len(), 1);
        assert_eq!(s.tool_history[0].tool_name, "Read");
    }

    #[test]
    fn complete_tool_no_current() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        s.complete_tool(Some("id-1"), make_tool("Bash", Some("id-1")));
        assert!(s.current_tool.is_none());
        assert_eq!(s.tool_history.len(), 1);
    }
```

- [ ] **Step 4: Write test for `push_history` cap**

```rust
    #[test]
    fn push_history_caps_at_50() {
        let mut s = Session::new("s1".into(), "/tmp".into());
        for i in 0..55 {
            s.set_current_tool(make_tool(&format!("Tool{}", i), None));
        }
        // 55 set_current_tool calls: first one has no previous, so 54 pushed to history
        // Plus current_tool holds Tool54
        assert_eq!(s.tool_history.len(), 50);
        // Oldest should be Tool4 (first 4 were evicted)
        assert_eq!(s.tool_history[0].tool_name, "Tool4");
        assert_eq!(s.tool_history[49].tool_name, "Tool53");
    }
```

- [ ] **Step 5: Run all state tests**

Run: `cd src-tauri && cargo test state::tests`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "test: add Session method unit tests"
```

---

### Task 4: Tests for `hooks.rs` — pure JSON logic

**Files:**
- Modify: `src-tauri/src/hooks.rs` (add `#[cfg(test)] mod tests` at bottom)

Note: `is_jackdaw_matcher_group` and `jackdaw_matcher_group` are currently private (`fn`, not `pub fn`). Tests in the same module can access them. `check_status`, `install`, `uninstall` are already `pub`.

- [ ] **Step 1: Write tests for `is_jackdaw_matcher_group`**

Add at the bottom of `src-tauri/src/hooks.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_jackdaw_matcher_group_valid() {
        let mg = json!({
            "hooks": [{"type": "http", "url": "http://localhost:9876/events", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_different_port() {
        let mg = json!({
            "hooks": [{"type": "http", "url": "http://localhost:1234/events", "timeout": 5}]
        });
        assert!(is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_non_jackdaw_url() {
        let mg = json!({
            "hooks": [{"type": "http", "url": "http://example.com/webhook"}]
        });
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_missing_hooks_field() {
        let mg = json!({"matcher": "something"});
        assert!(!is_jackdaw_matcher_group(&mg));
    }

    #[test]
    fn is_jackdaw_matcher_group_empty_hooks_array() {
        let mg = json!({"hooks": []});
        assert!(!is_jackdaw_matcher_group(&mg));
    }
}
```

- [ ] **Step 2: Run to verify they pass**

Run: `cd src-tauri && cargo test hooks::tests::is_jackdaw`
Expected: all 5 tests pass

- [ ] **Step 3: Write tests for `check_status`**

Add to the existing `mod tests`:

```rust
    fn full_installed_settings(port: u16) -> Value {
        let url = format!("http://localhost:{}/events", port);
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop",
                       "SessionEnd", "UserPromptSubmit", "SubagentStart",
                       "SubagentStop", "Notification"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "http", "url": url, "timeout": 5}]
            }]));
        }
        json!({"hooks": hooks})
    }

    #[test]
    fn check_status_empty_settings() {
        let settings = json!({});
        assert!(matches!(check_status(&settings, 9876), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_no_hooks_key() {
        let settings = json!({"other": "stuff"});
        assert!(matches!(check_status(&settings, 9876), HookStatus::NotInstalled));
    }

    #[test]
    fn check_status_all_installed() {
        let settings = full_installed_settings(9876);
        assert!(matches!(check_status(&settings, 9876), HookStatus::Installed));
    }

    #[test]
    fn check_status_partial_install() {
        // Only 5 of 9 events
        let url = "http://localhost:9876/events";
        let events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];
        let mut hooks = serde_json::Map::new();
        for event in events {
            hooks.insert(event.into(), json!([{
                "hooks": [{"type": "http", "url": url, "timeout": 5}]
            }]));
        }
        let settings = json!({"hooks": hooks});
        assert!(matches!(check_status(&settings, 9876), HookStatus::Outdated));
    }

    #[test]
    fn check_status_wrong_port_detected() {
        // Installed at port 1234, checking for 9876
        let settings = full_installed_settings(1234);
        assert!(matches!(check_status(&settings, 9876), HookStatus::Outdated));
    }
```

- [ ] **Step 4: Run to verify**

Run: `cd src-tauri && cargo test hooks::tests::check_status`
Expected: all 5 tests pass

- [ ] **Step 5: Write tests for `install`**

```rust
    #[test]
    fn install_empty_settings() {
        let mut settings = json!({});
        install(&mut settings, 9876).unwrap();
        assert!(matches!(check_status(&settings, 9876), HookStatus::Installed));
    }

    #[test]
    fn install_preserves_non_jackdaw_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": {"tool_name": "Bash"},
                    "hooks": [{"type": "http", "url": "http://other-service.com/hook"}]
                }]
            }
        });
        install(&mut settings, 9876).unwrap();
        // Jackdaw hooks installed
        assert!(matches!(check_status(&settings, 9876), HookStatus::Installed));
        // Other hook still present
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 2); // other + jackdaw
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other-service.com/hook");
    }

    #[test]
    fn install_replaces_old_jackdaw_hooks() {
        // Install at port 1234, then reinstall at 9876
        let mut settings = json!({});
        install(&mut settings, 1234).unwrap();
        assert!(matches!(check_status(&settings, 1234), HookStatus::Installed));
        install(&mut settings, 9876).unwrap();
        assert!(matches!(check_status(&settings, 9876), HookStatus::Installed));
        // Only one matcher group per event (old removed)
        let arr = settings["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
    }
```

- [ ] **Step 6: Write tests for `uninstall`**

```rust
    #[test]
    fn uninstall_removes_jackdaw_hooks() {
        let mut settings = json!({});
        install(&mut settings, 9876).unwrap();
        uninstall(&mut settings);
        assert!(matches!(check_status(&settings, 9876), HookStatus::NotInstalled));
        // hooks key removed entirely since empty
        assert!(settings.get("hooks").is_none());
    }

    #[test]
    fn uninstall_preserves_other_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"type": "http", "url": "http://other.com/hook"}]},
                    {"hooks": [{"type": "http", "url": "http://localhost:9876/events", "timeout": 5}]}
                ]
            }
        });
        uninstall(&mut settings);
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["hooks"][0]["url"], "http://other.com/hook");
    }

    #[test]
    fn uninstall_noop_when_not_installed() {
        let mut settings = json!({"other": "data"});
        uninstall(&mut settings);
        assert_eq!(settings, json!({"other": "data"}));
    }
```

- [ ] **Step 7: Run all hooks tests**

Run: `cd src-tauri && cargo test hooks::tests`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/hooks.rs
git commit -m "test: add hooks.rs unit tests"
```

---

### Task 5: Tests for `hooks.rs` — filesystem functions

**Files:**
- Modify: `src-tauri/src/hooks.rs` (add to existing `mod tests`)

- [ ] **Step 1: Write filesystem tests using `tempfile`**

Add to the existing `mod tests` block:

```rust
    #[test]
    fn read_settings_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"hooks":{}}"#).unwrap();
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({"hooks": {}}));
    }

    #[test]
    fn read_settings_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = read_settings(&path).unwrap();
        assert_eq!(result, json!({}));
    }

    #[test]
    fn write_settings_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("dir").join("settings.json");
        let settings = json!({"hooks": {}});
        write_settings(&path, &settings).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        let parsed: Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, settings);
    }

    #[test]
    fn write_settings_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = json!({});
        install(&mut settings, 9876).unwrap();
        write_settings(&path, &settings).unwrap();
        let loaded = read_settings(&path).unwrap();
        assert!(matches!(check_status(&loaded, 9876), HookStatus::Installed));
    }

    #[test]
    fn write_settings_atomic_no_temp_file_left() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = json!({"test": true});
        write_settings(&path, &settings).unwrap();
        // The .json.tmp file should not remain after atomic rename
        let temp_path = path.with_extension("json.tmp");
        assert!(!temp_path.exists());
        // The actual file should exist with correct content
        assert!(path.exists());
    }
```

- [ ] **Step 2: Run filesystem tests**

Run: `cd src-tauri && cargo test hooks::tests`
Expected: all tests pass (including previous ones)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hooks.rs
git commit -m "test: add hooks.rs filesystem tests"
```

---

### Task 6: Extract and test `compute_tray_state` from `tray.rs`

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Write the failing test**

Add at the bottom of `src-tauri/src/tray.rs`:

```rust
/// Compute running/waiting counts from session list.
/// Returns (running, waiting) where:
/// - running: session has current_tool, active_subagents > 0, or processing
/// - waiting: session has none of those
pub fn compute_tray_state(sessions: &[Session]) -> (usize, usize) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use crate::state::ToolEvent;

    fn idle_session() -> Session {
        Session::new("s1".into(), "/tmp".into())
    }

    fn running_session_with_tool() -> Session {
        let mut s = Session::new("s2".into(), "/tmp".into());
        s.set_current_tool(ToolEvent {
            tool_name: "Bash".into(),
            timestamp: Utc::now(),
            summary: None,
            tool_use_id: None,
        });
        s
    }

    fn running_session_with_subagents() -> Session {
        let mut s = Session::new("s3".into(), "/tmp".into());
        s.active_subagents = 1;
        s
    }

    fn running_session_processing() -> Session {
        let mut s = Session::new("s4".into(), "/tmp".into());
        s.processing = true;
        s
    }

    fn pending_only_session() -> Session {
        let mut s = Session::new("s5".into(), "/tmp".into());
        s.pending_approval = true;
        s
    }

    #[test]
    fn tray_state_no_sessions() {
        assert_eq!(compute_tray_state(&[]), (0, 0));
    }

    #[test]
    fn tray_state_all_running() {
        let sessions = vec![running_session_with_tool(), running_session_with_subagents()];
        assert_eq!(compute_tray_state(&sessions), (2, 0));
    }

    #[test]
    fn tray_state_all_waiting() {
        let sessions = vec![idle_session(), idle_session()];
        assert_eq!(compute_tray_state(&sessions), (0, 2));
    }

    #[test]
    fn tray_state_mixed() {
        let sessions = vec![running_session_with_tool(), idle_session(), running_session_processing()];
        assert_eq!(compute_tray_state(&sessions), (2, 1));
    }

    #[test]
    fn tray_state_pending_only_counts_as_waiting() {
        let sessions = vec![pending_only_session()];
        assert_eq!(compute_tray_state(&sessions), (0, 1));
    }
}
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd src-tauri && cargo test tray::tests`
Expected: FAIL with `not yet implemented`

- [ ] **Step 3: Implement `compute_tray_state`**

Replace the `todo!()` body with:

```rust
pub fn compute_tray_state(sessions: &[Session]) -> (usize, usize) {
    let running = sessions.iter().filter(|s| s.current_tool.is_some() || s.active_subagents > 0 || s.processing).count();
    let waiting = sessions.iter().filter(|s| s.current_tool.is_none() && s.active_subagents == 0 && !s.processing).count();
    (running, waiting)
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd src-tauri && cargo test tray::tests`
Expected: all 5 tests pass

- [ ] **Step 5: Refactor `update_tray` to use `compute_tray_state`**

In the `update_tray` function, replace lines 126-127:

```rust
    let running = sessions.iter().filter(|s| s.current_tool.is_some() || s.active_subagents > 0 || s.processing).count();
    let waiting = sessions.iter().filter(|s| s.current_tool.is_none() && s.active_subagents == 0 && !s.processing).count();
```

with:

```rust
    let (running, waiting) = compute_tray_state(sessions);
```

- [ ] **Step 6: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/tray.rs
git commit -m "refactor: extract compute_tray_state and add tests"
```

---

### Task 7: Set up Vitest for frontend

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Add test script to `package.json`**

Add to the `"scripts"` section:

```json
"test": "vitest run"
```

- [ ] **Step 3: Verify Vitest runs (no tests yet)**

Run: `npm test`
Expected: exits successfully with "no test files found" or similar

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for frontend testing"
```

---

### Task 8: Extract utility functions from `SessionCard.svelte`

**Files:**
- Create: `src/lib/utils.ts`
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Create `src/lib/utils.ts` with extracted functions**

```typescript
/** Format a started_at timestamp as relative uptime like "5m ago" or "1h 30m ago" */
export function getUptime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

/** Replace /home/<user>/ prefix with ~ */
export function shortenPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, '~');
}

/** Truncate session ID to 8 characters */
export function shortenSessionId(id: string): string {
  return id.length > 8 ? id.substring(0, 8) : id;
}
```

- [ ] **Step 2: Update `SessionCard.svelte` to import from utils**

Replace the three function definitions (lines 16-33) with:

```typescript
  import { getUptime, shortenPath, shortenSessionId } from '$lib/utils';
```

Place this import alongside the existing imports at the top of the `<script>` block (after the `import type` line). Remove the three local function definitions.

- [ ] **Step 3: Verify the app still compiles**

Run: `npm run check`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils.ts src/lib/components/SessionCard.svelte
git commit -m "refactor: extract utility functions from SessionCard"
```

---

### Task 9: Tests for `src/lib/utils.ts`

**Files:**
- Create: `src/lib/utils.test.ts`

- [ ] **Step 1: Write tests**

Create `src/lib/utils.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getUptime, shortenPath, shortenSessionId } from './utils';

describe('shortenPath', () => {
  it('replaces /home/<user>/ with ~', () => {
    expect(shortenPath('/home/andy/projects/foo')).toBe('~/projects/foo');
  });

  it('replaces any user home', () => {
    expect(shortenPath('/home/otheruser/foo')).toBe('~/foo');
  });

  it('leaves non-home paths unchanged', () => {
    expect(shortenPath('/tmp/foo')).toBe('/tmp/foo');
  });

  it('leaves macOS paths unchanged', () => {
    expect(shortenPath('/Users/andy/foo')).toBe('/Users/andy/foo');
  });
});

describe('shortenSessionId', () => {
  it('truncates long IDs to 8 chars', () => {
    expect(shortenSessionId('abcdef123456')).toBe('abcdef12');
  });

  it('leaves short IDs unchanged', () => {
    expect(shortenSessionId('abc')).toBe('abc');
  });

  it('leaves exactly 8-char IDs unchanged', () => {
    expect(shortenSessionId('abcdefgh')).toBe('abcdefgh');
  });
});

describe('getUptime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns minutes for <60 min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:05:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours and minutes for >=60 min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T13:30:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('1h 30m ago');
  });

  it('returns 0m for just started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00Z'));
    expect(getUptime('2026-03-19T12:00:00Z')).toBe('0m ago');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/utils.test.ts
git commit -m "test: add utility function tests"
```

---

### Task 10: Tests for `SessionStore`

**Files:**
- Create: `src/lib/stores/sessions.test.ts`
- Possibly modify: `vite.config.js`

**Important:** `SessionStore` uses Svelte 5 runes (`$state`, `$derived`) in a `.svelte.ts` file. These require the Svelte compiler to transform. The `sveltekit()` plugin in `vite.config.js` wraps `@sveltejs/vite-plugin-svelte`, which should handle `.svelte.ts` files — but Vitest's compatibility with this is not guaranteed without explicit configuration.

- [ ] **Step 1: Configure Vitest to handle Svelte runes**

First, try running a minimal test. If `.svelte.ts` files fail to compile, add explicit Svelte plugin config to `vite.config.js`:

```javascript
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Inside defineConfig, add:
test: {
  alias: {
    '$lib': './src/lib',
  },
},
```

If that still fails (because `sveltekit()` conflicts with the test environment), create a separate `vitest.config.ts`:

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    alias: {
      '$lib': './src/lib',
    },
  },
});
```

This requires `npm install --save-dev @sveltejs/vite-plugin-svelte` if not already available transitively.

- [ ] **Step 2: Write the test file**

Create `src/lib/stores/sessions.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock Tauri event API before importing the store
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Dynamic import after mock is set up
const { sessionStore } = await import('./sessions.svelte');

describe('SessionStore', () => {
  function makeSession(overrides: Record<string, unknown> = {}) {
    return {
      session_id: 'test-session',
      cwd: '/tmp',
      started_at: '2026-03-19T12:00:00Z',
      current_tool: null,
      tool_history: [],
      active_subagents: 0,
      pending_approval: false,
      processing: false,
      ...overrides,
    };
  }

  it('count returns session length', () => {
    sessionStore.sessions = [makeSession(), makeSession({ session_id: 's2' })];
    expect(sessionStore.count).toBe(2);
  });

  it('count is 0 when empty', () => {
    sessionStore.sessions = [];
    expect(sessionStore.count).toBe(0);
  });

  it('runningCount counts sessions with current_tool', () => {
    sessionStore.sessions = [
      makeSession({ current_tool: { tool_name: 'Bash', timestamp: '', summary: null } }),
      makeSession({ session_id: 's2' }),
    ];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount counts sessions with active_subagents', () => {
    sessionStore.sessions = [makeSession({ active_subagents: 2 })];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount counts sessions with processing', () => {
    sessionStore.sessions = [makeSession({ processing: true })];
    expect(sessionStore.runningCount).toBe(1);
  });

  it('runningCount does not count pending-only sessions', () => {
    sessionStore.sessions = [makeSession({ pending_approval: true })];
    expect(sessionStore.runningCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`

If Svelte rune compilation fails despite the config above, this is a known limitation of Svelte 5 runes in Vitest. In that case, skip this test file for now and note it as a TODO. The utility function tests (Task 9) still provide frontend coverage.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/sessions.test.ts
git commit -m "test: add SessionStore unit tests"
```

If config files were modified, include them in the commit:
```bash
git add src/lib/stores/sessions.test.ts vite.config.js  # or vitest.config.ts
git commit -m "test: add SessionStore unit tests with Vitest Svelte config"
```

---

### Task 11: Update CLAUDE.md with test commands

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Commands section**

In `CLAUDE.md`, update the commands block to include test commands:

```bash
npm run tauri dev       # Full dev mode (Rust + Vite hot-reload on :1420)
npm run tauri build     # Production build (output: src-tauri/target/release/bundle/)
npm run check           # Svelte/TypeScript type checking
npm run check:watch     # Type checking in watch mode
npm test                # Run frontend tests (Vitest)
cd src-tauri && cargo test  # Run backend tests
```

Also update the line "No test framework is configured yet. There are no tests." to:

```
Backend tests: `cd src-tauri && cargo test`. Frontend tests: `npm test` (Vitest).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with test commands"
```
