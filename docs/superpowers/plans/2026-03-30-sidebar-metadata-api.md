# Sidebar Metadata API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable external tools and scripts to push custom metadata (status labels, progress bars, log lines) into Jackdaw sessions via the bidirectional IPC API.

**Architecture:** Three new API actions (`register_session`, `set_metadata`, `end_session`) in the existing request/response protocol. Metadata stored as `IndexMap<String, MetadataEntry>` on `Session`. Frontend renders metadata entries below the tool row with type-specific components (text labels, progress bars, collapsible log blocks).

**Tech Stack:** Rust (indexmap crate), Svelte 5, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-30-sidebar-metadata-api-design.md`

---

## File Structure

**Create:**
- `src/lib/components/MetadataDisplay.svelte` — Renders metadata entries (text/progress/log) for a session card

**Modify:**
- `src-tauri/Cargo.toml` — Add `indexmap` dependency with `serde` feature
- `src-tauri/src/state.rs` — Add `MetadataEntry`, `MetadataValue` types; add `display_name` and `metadata` fields to `Session`
- `src-tauri/src/api.rs` — Add `register_session`, `set_metadata`, `end_session` action handlers
- `src/lib/types.ts` — Add `MetadataEntry`, `MetadataValue` types; extend `Session`
- `src/lib/components/SessionCard.svelte` — Integrate `MetadataDisplay`, update card title logic
- `src/lib/utils.ts` — Update `getProjectName` to handle `display_name`

**Test:**
- `src-tauri/src/state.rs` — Unit tests for metadata types and session methods
- `src-tauri/src/api.rs` — Unit tests for new action handlers
- `src-tauri/tests/socket_api.rs` — Integration tests for metadata actions over socket
- `src/lib/utils.test.ts` — Tests for updated `getProjectName`

---

### Task 1: Add `indexmap` Dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add indexmap to Cargo.toml**

In `src-tauri/Cargo.toml`, add `indexmap` to `[dependencies]` after the `rusqlite` line:

```toml
indexmap = { version = "2", features = ["serde"] }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add indexmap dependency for ordered metadata"
```

---

### Task 2: Add Metadata Types and Session Fields

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing tests for MetadataValue serialization**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/state.rs`:

```rust
#[test]
fn metadata_value_text_serializes_as_tagged() {
    let entry = MetadataEntry {
        key: "status".into(),
        value: MetadataValue::Text("compiling".into()),
    };
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["key"], "status");
    assert_eq!(json["value"]["type"], "text");
    assert_eq!(json["value"]["content"], "compiling");
}

#[test]
fn metadata_value_progress_serializes_as_tagged() {
    let entry = MetadataEntry {
        key: "coverage".into(),
        value: MetadataValue::Progress(87.5),
    };
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["value"]["type"], "progress");
    assert_eq!(json["value"]["content"], 87.5);
}

#[test]
fn metadata_value_log_serializes_as_tagged() {
    let entry = MetadataEntry {
        key: "build_log".into(),
        value: MetadataValue::Log(vec!["line 1".into(), "line 2".into()]),
    };
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["value"]["type"], "log");
    let content = json["value"]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(content[0], "line 1");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test metadata_value`
Expected: FAIL — `MetadataEntry` and `MetadataValue` not defined

- [ ] **Step 3: Add MetadataValue and MetadataEntry types**

In `src-tauri/src/state.rs`, add the `indexmap` import at the top alongside the existing imports:

```rust
use indexmap::IndexMap;
```

Then add these types after the `SessionSource` enum (after line 29):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "content", rename_all = "lowercase")]
pub enum MetadataValue {
    Text(String),
    Progress(f64),
    Log(Vec<String>),
}

#[derive(Debug, Clone, Serialize)]
pub struct MetadataEntry {
    pub key: String,
    pub value: MetadataValue,
}
```

- [ ] **Step 4: Run serialization tests to verify they pass**

Run: `cd src-tauri && cargo test metadata_value`
Expected: all 3 tests PASS

- [ ] **Step 5: Write failing tests for new Session fields**

Add to tests in `src-tauri/src/state.rs`:

```rust
#[test]
fn session_new_has_empty_metadata() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert!(s.metadata.is_empty());
    assert!(s.display_name.is_none());
}

#[test]
fn session_display_name_serializes() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.display_name = Some("CI Build #456".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["display_name"], "CI Build #456");
}

#[test]
fn session_metadata_serializes_in_order() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.metadata.insert("status".into(), MetadataEntry {
        key: "status".into(),
        value: MetadataValue::Text("building".into()),
    });
    s.metadata.insert("progress".into(), MetadataEntry {
        key: "progress".into(),
        value: MetadataValue::Progress(50.0),
    });
    let json = serde_json::to_value(&s).unwrap();
    let meta = json["metadata"].as_object().unwrap();
    let keys: Vec<&String> = meta.keys().collect();
    assert_eq!(keys, vec!["status", "progress"]);
}
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd src-tauri && cargo test session_new_has_empty_metadata session_display_name_serializes session_metadata_serializes`
Expected: FAIL — fields don't exist on Session

- [ ] **Step 7: Add display_name and metadata fields to Session**

In `src-tauri/src/state.rs`, add two fields to the `Session` struct (after `source`):

```rust
pub display_name: Option<String>,
pub metadata: IndexMap<String, MetadataEntry>,
```

Update `Session::new()` to initialize them:

```rust
display_name: None,
metadata: IndexMap::new(),
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all tests PASS (existing + new)

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add MetadataEntry/MetadataValue types and Session fields"
```

---

### Task 3: Add `register_session` API Action

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing unit tests**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/api.rs`:

```rust
#[test]
fn action_register_session_creates_new() {
    let state = test_state();
    let args = Some(serde_json::json!({
        "session_id": "build-1",
        "display_name": "CI Build #456"
    }));
    let result = handle_action("register_session", &args, &state).unwrap();
    assert_eq!(result["registered"], true);
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get("build-1").unwrap();
    assert_eq!(session.display_name.as_deref(), Some("CI Build #456"));
    assert_eq!(session.cwd, "");
    assert!(!session.processing);
}

#[test]
fn action_register_session_updates_existing_display_name() {
    let state = test_state();
    insert_session(&state, "build-1");
    let args = Some(serde_json::json!({
        "session_id": "build-1",
        "display_name": "Updated Name"
    }));
    let result = handle_action("register_session", &args, &state).unwrap();
    assert_eq!(result["registered"], true);
    let sessions = state.sessions.lock().unwrap();
    assert_eq!(sessions.get("build-1").unwrap().display_name.as_deref(), Some("Updated Name"));
}

#[test]
fn action_register_session_missing_display_name() {
    let state = test_state();
    let args = Some(serde_json::json!({"session_id": "build-1"}));
    let err = handle_action("register_session", &args, &state).unwrap_err();
    assert!(err.contains("missing args.display_name"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test action_register_session`
Expected: FAIL — unknown action command

- [ ] **Step 3: Implement register_session action**

In `src-tauri/src/api.rs`, add `use crate::state::Session;` at the top with the existing imports.

Add this arm to the `match command` block in `handle_action`, before the `_ => Err(...)` arm:

```rust
"register_session" => {
    let session_id = get_session_id()?;
    let display_name = args
        .as_ref()
        .and_then(|a| a.get("display_name"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.display_name".to_string())?;
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(existing) = sessions.get_mut(&session_id) {
        existing.display_name = Some(display_name.to_string());
    } else {
        let mut session = Session::new(session_id.clone(), String::new());
        session.display_name = Some(display_name.to_string());
        sessions.insert(session_id, session);
    }
    Ok(serde_json::json!({"registered": true}))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test action_register_session`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: add register_session API action"
```

---

### Task 4: Add `set_metadata` API Action

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing unit tests**

Add to tests in `src-tauri/src/api.rs`:

```rust
use crate::state::{MetadataValue, MetadataEntry};

#[test]
fn action_set_metadata_text() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "status", "value": "compiling"}]
    }));
    let result = handle_action("set_metadata", &args, &state).unwrap();
    assert_eq!(result["updated"], true);
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get("s1").unwrap().metadata.get("status").unwrap();
    assert!(matches!(&entry.value, MetadataValue::Text(s) if s == "compiling"));
}

#[test]
fn action_set_metadata_progress() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "coverage", "value": 87.5, "type": "progress"}]
    }));
    handle_action("set_metadata", &args, &state).unwrap();
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get("s1").unwrap().metadata.get("coverage").unwrap();
    assert!(matches!(&entry.value, MetadataValue::Progress(v) if (*v - 87.5).abs() < f64::EPSILON));
}

#[test]
fn action_set_metadata_log_appends() {
    let state = test_state();
    insert_session(&state, "s1");
    let args1 = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "log", "value": "line 1", "type": "log"}]
    }));
    handle_action("set_metadata", &args1, &state).unwrap();
    let args2 = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "log", "value": "line 2", "type": "log"}]
    }));
    handle_action("set_metadata", &args2, &state).unwrap();
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get("s1").unwrap().metadata.get("log").unwrap();
    match &entry.value {
        MetadataValue::Log(lines) => {
            assert_eq!(lines.len(), 2);
            assert_eq!(lines[0], "line 1");
            assert_eq!(lines[1], "line 2");
        }
        _ => panic!("expected Log variant"),
    }
}

#[test]
fn action_set_metadata_log_caps_at_50() {
    let state = test_state();
    insert_session(&state, "s1");
    for i in 0..55 {
        let args = Some(serde_json::json!({
            "session_id": "s1",
            "entries": [{"key": "log", "value": format!("line {}", i), "type": "log"}]
        }));
        handle_action("set_metadata", &args, &state).unwrap();
    }
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get("s1").unwrap().metadata.get("log").unwrap();
    match &entry.value {
        MetadataValue::Log(lines) => {
            assert_eq!(lines.len(), 50);
            assert_eq!(lines[0], "line 5");
            assert_eq!(lines[49], "line 54");
        }
        _ => panic!("expected Log variant"),
    }
}

#[test]
fn action_set_metadata_null_removes_key() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "status", "value": "ok"}]
    }));
    handle_action("set_metadata", &args, &state).unwrap();
    let args_remove = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "status", "value": null}]
    }));
    handle_action("set_metadata", &args_remove, &state).unwrap();
    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.get("s1").unwrap().metadata.get("status").is_none());
}

#[test]
fn action_set_metadata_session_not_found() {
    let state = test_state();
    let args = Some(serde_json::json!({
        "session_id": "nope",
        "entries": [{"key": "status", "value": "ok"}]
    }));
    let err = handle_action("set_metadata", &args, &state).unwrap_err();
    assert!(err.contains("session not found"));
}

#[test]
fn action_set_metadata_default_type_is_text() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({
        "session_id": "s1",
        "entries": [{"key": "status", "value": "building"}]
    }));
    handle_action("set_metadata", &args, &state).unwrap();
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get("s1").unwrap().metadata.get("status").unwrap();
    assert!(matches!(&entry.value, MetadataValue::Text(_)));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test action_set_metadata`
Expected: FAIL — unknown action command

- [ ] **Step 3: Implement set_metadata action**

Add this arm to the `match command` block in `handle_action`, before the `_ => Err(...)` arm:

```rust
"set_metadata" => {
    let session_id = get_session_id()?;
    let entries = args
        .as_ref()
        .and_then(|a| a.get("entries"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing args.entries".to_string())?;
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("session not found: {}", session_id))?;
    for entry in entries {
        let key = entry
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "entry missing key".to_string())?;
        if entry.get("value").map_or(false, |v| v.is_null()) {
            session.metadata.shift_remove(key);
            continue;
        }
        let entry_type = entry
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("text");
        let metadata_value = match entry_type {
            "progress" => {
                let v = entry
                    .get("value")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| "progress value must be a number".to_string())?;
                MetadataValue::Progress(v)
            }
            "log" => {
                let line = entry
                    .get("value")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "log value must be a string".to_string())?
                    .to_string();
                if let Some(existing) = session.metadata.get_mut(key) {
                    if let MetadataValue::Log(ref mut lines) = existing.value {
                        lines.push(line);
                        if lines.len() > MAX_METADATA_LOG {
                            lines.drain(..lines.len() - MAX_METADATA_LOG);
                        }
                        continue;
                    }
                }
                MetadataValue::Log(vec![line])
            }
            _ => {
                let v = entry
                    .get("value")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "text value must be a string".to_string())?
                    .to_string();
                MetadataValue::Text(v)
            }
        };
        session.metadata.insert(
            key.to_string(),
            MetadataEntry {
                key: key.to_string(),
                value: metadata_value,
            },
        );
    }
    Ok(serde_json::json!({"updated": true}))
}
```

Also add a constant at the top of `api.rs` (after imports):

```rust
const MAX_METADATA_LOG: usize = 50;
```

And add the import for the metadata types:

```rust
use crate::state::{MetadataEntry, MetadataValue};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test action_set_metadata`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: add set_metadata API action"
```

---

### Task 5: Add `end_session` API Action

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing unit tests**

Add to tests in `src-tauri/src/api.rs`:

```rust
#[test]
fn action_end_session_removes() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_action("end_session", &args, &state).unwrap();
    assert_eq!(result["ended"], true);
    assert!(state.sessions.lock().unwrap().is_empty());
}

#[test]
fn action_end_session_not_found() {
    let state = test_state();
    let args = Some(serde_json::json!({"session_id": "nope"}));
    let err = handle_action("end_session", &args, &state).unwrap_err();
    assert!(err.contains("session not found"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test action_end_session`
Expected: FAIL — unknown action command

- [ ] **Step 3: Implement end_session action**

Add this arm to `handle_action` in `src-tauri/src/api.rs`, before the `_ => Err(...)` arm:

```rust
"end_session" => {
    let session_id = get_session_id()?;
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.remove(&session_id).is_some() {
        Ok(serde_json::json!({"ended": true}))
    } else {
        Err(format!("session not found: {}", session_id))
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test action_end_session`
Expected: all 2 tests PASS

- [ ] **Step 5: Run full backend test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: add end_session API action"
```

---

### Task 6: Socket Integration Tests for Metadata Actions

**Files:**
- Modify: `src-tauri/tests/socket_api.rs`

- [ ] **Step 1: Write integration tests**

Add to `src-tauri/tests/socket_api.rs`:

```rust
#[tokio::test]
async fn action_register_session_via_socket() {
    let (state, _dir) = test_state();

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"register_session\",\"id\":\"r1\",\"args\":{\"session_id\":\"build-1\",\"display_name\":\"CI Build\"}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["registered"], true);

    let sessions = state.sessions.lock().unwrap();
    assert_eq!(sessions.get("build-1").unwrap().display_name.as_deref(), Some("CI Build"));
}

#[tokio::test]
async fn action_set_metadata_via_socket() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"set_metadata\",\"id\":\"r2\",\"args\":{\"session_id\":\"s1\",\"entries\":[{\"key\":\"status\",\"value\":\"building\"}]}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["updated"], true);

    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.get("s1").unwrap().metadata.contains_key("status"));
}

#[tokio::test]
async fn action_end_session_via_socket() {
    let (state, _dir) = test_state();
    insert_session(&state, "s1");

    let client = spawn_dispatch(state.clone());
    let (read_half, mut write_half) = tokio::io::split(client);
    let mut lines = BufReader::new(read_half).lines();

    write_half
        .write_all(
            b"{\"type\":\"action\",\"command\":\"end_session\",\"id\":\"r3\",\"args\":{\"session_id\":\"s1\"}}\n",
        )
        .await
        .unwrap();

    let resp: serde_json::Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(resp["ok"].as_bool().unwrap());
    assert_eq!(resp["data"]["ended"], true);
    assert!(state.sessions.lock().unwrap().is_empty());
}
```

- [ ] **Step 2: Run integration tests**

Run: `cd src-tauri && cargo test --test socket_api`
Expected: all tests PASS (existing + new)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/socket_api.rs
git commit -m "test: add socket integration tests for metadata actions"
```

---

### Task 7: Frontend Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add MetadataValue and MetadataEntry types**

In `src/lib/types.ts`, add after the `ToolEvent` interface (after line 5):

```typescript
export type MetadataValue =
  | { type: 'text'; content: string }
  | { type: 'progress'; content: number }
  | { type: 'log'; content: string[] };

export interface MetadataEntry {
  key: string;
  value: MetadataValue;
}
```

- [ ] **Step 2: Add display_name and metadata to Session**

In the `Session` interface, add after `source`:

```typescript
display_name: string | null;
metadata: Record<string, MetadataEntry>;
```

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: type errors in SessionCard/Dashboard where `display_name` and `metadata` are now expected but not used. This is expected — we'll fix in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add metadata types to frontend"
```

---

### Task 8: MetadataDisplay Component

**Files:**
- Create: `src/lib/components/MetadataDisplay.svelte`

- [ ] **Step 1: Create the MetadataDisplay component**

Create `src/lib/components/MetadataDisplay.svelte`:

```svelte
<script lang="ts">
  import type { MetadataEntry } from '$lib/types';

  interface Props {
    entries: MetadataEntry[];
    accentColor?: string;
  }

  let { entries, accentColor = 'var(--active)' }: Props = $props();

  let expandedLogs = $state<Set<string>>(new Set());

  function toggleLog(key: string): void {
    const next = new Set(expandedLogs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedLogs = next;
  }
</script>

{#if entries.length > 0}
  <div class="metadata-entries">
    {#each entries as entry (entry.key)}
      {#if entry.value.type === 'text'}
        <div class="meta-row">
          <span class="meta-key">{entry.key}</span>
          <span class="meta-value">{entry.value.content}</span>
        </div>
      {:else if entry.value.type === 'progress'}
        <div class="meta-progress">
          <div class="meta-row">
            <span class="meta-key">{entry.key}</span>
            <span class="meta-value">{Math.round(entry.value.content)}%</span>
          </div>
          <div class="progress-track">
            <div
              class="progress-bar"
              style="width: {Math.min(100, Math.max(0, entry.value.content))}%; background: {accentColor}"
            ></div>
          </div>
        </div>
      {:else if entry.value.type === 'log'}
        <div class="meta-log">
          <div
            class="meta-row clickable"
            onclick={() => toggleLog(entry.key)}
            role="button"
            tabindex="0"
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleLog(entry.key))}
          >
            <span class="meta-key">{entry.key}</span>
            <span class="meta-value">{expandedLogs.has(entry.key) ? '▾' : '▸'} {entry.value.content.length} line{entry.value.content.length === 1 ? '' : 's'}</span>
          </div>
          {#if expandedLogs.has(entry.key)}
            <pre class="log-block">{entry.value.content.join('\n')}</pre>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .metadata-entries {
    padding: 6px 14px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .meta-row.clickable {
    cursor: pointer;
    user-select: none;
  }

  .meta-key {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  .meta-value {
    font-size: 11px;
    color: var(--text-primary);
  }

  .meta-progress {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .progress-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .log-block {
    font-family: monospace;
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--tool-bg);
    border: 1px solid var(--border);
    padding: 6px 8px;
    margin: 4px 0 0;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: MetadataDisplay compiles cleanly. There may still be errors in other components from the Session type change — those are addressed in the next task.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/MetadataDisplay.svelte
git commit -m "feat: add MetadataDisplay component"
```

---

### Task 9: Integrate Metadata into SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Write failing test for getProjectName with display_name**

Add to `src/lib/utils.test.ts`:

```typescript
describe('getProjectName', () => {
  // ... existing tests ...

  it('returns display_name when provided', () => {
    expect(getProjectName('', 'CI Build #456')).toBe('CI Build #456');
  });

  it('prefers display_name over cwd', () => {
    expect(getProjectName('/home/user/project', 'Custom Name')).toBe('Custom Name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run utils`
Expected: FAIL — `getProjectName` doesn't accept a second argument

- [ ] **Step 3: Update getProjectName to accept display_name**

In `src/lib/utils.ts`, update `getProjectName`:

```typescript
export function getProjectName(cwd: string, displayName?: string | null): string {
  if (displayName) return displayName;
  // ... existing cwd logic unchanged ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run utils`
Expected: all tests PASS

- [ ] **Step 5: Update SessionCard to show metadata and use display_name**

In `src/lib/components/SessionCard.svelte`:

Add the import for MetadataDisplay after the ToolIcon import:

```typescript
import MetadataDisplay from './MetadataDisplay.svelte';
```

Update the project name in the template to pass `display_name`:

```svelte
<span class="project-name">{getProjectName(session.cwd, session.display_name)}</span>
```

Add a derived value for metadata entries (after the `lastTool` derived):

```typescript
let metadataEntries = $derived(Object.values(session.metadata));
```

Add the MetadataDisplay component after the tool-row section (after the `{/if}` that closes the tool-row block, before the expanded-section):

```svelte
{#if metadataEntries.length > 0}
  <MetadataDisplay entries={metadataEntries} accentColor="var(--accent-color)" />
{/if}
```

- [ ] **Step 6: Run type check and tests**

Run: `npm run check && npm test`
Expected: all checks and tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/SessionCard.svelte src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: integrate metadata display into SessionCard"
```

---

### Task 10: Verify Full Stack

**Files:** None (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests PASS

- [ ] **Step 2: Run full frontend test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: no errors

- [ ] **Step 4: Verify dev build starts**

Run: `npm run tauri dev`
Expected: app launches, existing sessions display correctly. Metadata section is empty for normal Claude Code sessions (no metadata pushed yet).

- [ ] **Step 5: Commit any remaining fixes, if needed**
