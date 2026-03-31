# Quick Terminal Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embedded shell terminal to any session, launched from a button on the session card, opening the user's default shell in the session's cwd.

**Architecture:** A `shell_pty_id` field on `Session` tracks an optional shell PTY. New `open_session_shell` and `close_session_shell` Tauri commands manage the PTY lifecycle. The frontend adds a terminal button to SessionCard and a Detail/Terminal tab toggle in the main area.

**Tech Stack:** Rust (Tauri v2, portable-pty), Svelte 5, TypeScript, xterm.js, Vitest

---

### Task 1: Add `shell_pty_id` to Session (backend data model)

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing test for `shell_pty_id` default**

In `src-tauri/src/state.rs`, add to the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn session_new_shell_pty_id_is_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert!(s.shell_pty_id.is_none());
}

#[test]
fn session_shell_pty_id_serializes() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.shell_pty_id = Some("pty-abc".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["shell_pty_id"], "pty-abc");
}

#[test]
fn session_shell_pty_id_serializes_null_when_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["shell_pty_id"].is_null());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test session_new_shell_pty_id_is_none session_shell_pty_id_serializes session_shell_pty_id_serializes_null_when_none 2>&1`
Expected: compilation error — `shell_pty_id` field doesn't exist

- [ ] **Step 3: Add `shell_pty_id` field to `Session`**

In `src-tauri/src/state.rs`, add to the `Session` struct after `metadata`:

```rust
pub shell_pty_id: Option<String>,
```

In `Session::new()`, add after `metadata: IndexMap::new(),`:

```rust
shell_pty_id: None,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test session_new_shell_pty_id_is_none session_shell_pty_id_serializes session_shell_pty_id_serializes_null_when_none 2>&1`
Expected: all 3 pass

- [ ] **Step 5: Run full backend test suite**

Run: `cd src-tauri && cargo test 2>&1`
Expected: all tests pass (existing tests compile fine — `Session::new()` callers don't use struct literal syntax)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add shell_pty_id field to Session"
```

---

### Task 2: Add `detect_shell` function and tests

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing tests for `detect_shell`**

In `src-tauri/src/state.rs`, add to the test module:

```rust
#[test]
fn detect_shell_returns_non_empty() {
    let (path, name) = super::detect_shell();
    assert!(!path.is_empty());
    assert!(!name.is_empty());
}

#[test]
fn detect_shell_name_has_no_path_separator() {
    let (_, name) = super::detect_shell();
    assert!(!name.contains('/'));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test detect_shell 2>&1`
Expected: compilation error — `detect_shell` doesn't exist

- [ ] **Step 3: Implement `detect_shell`**

In `src-tauri/src/state.rs`, add after the `resolve_git_branch` function (before `const MAX_TOOL_HISTORY`):

```rust
/// Detect the user's default shell. Returns (path, display_name).
pub fn detect_shell() -> (String, String) {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let name = std::path::Path::new(&shell)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sh".to_string());
        (shell, name)
    }
    #[cfg(windows)]
    {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let name = "cmd".to_string();
        (shell, name)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test detect_shell 2>&1`
Expected: both tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add detect_shell function"
```

---

### Task 3: Add `open_session_shell` and `close_session_shell` commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement `open_session_shell` command**

In `src-tauri/src/lib.rs`, add after the `close_terminal` function:

```rust
#[tauri::command]
async fn open_session_shell(
    session_id: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
    let cwd = {
        let sessions = state.sessions.lock().unwrap();
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("session not found: {}", session_id))?;
        if let Some(ref pty_id) = session.shell_pty_id {
            return Ok(pty_id.clone());
        }
        session.cwd.clone()
    };

    let pty_id = uuid::Uuid::new_v4().to_string();
    let (shell_path, _shell_name) = state::detect_shell();

    let pty_mgr_inner = pty_mgr.inner().clone();
    let pty_id_for_spawn = pty_id.clone();
    let cwd_clone = cwd.clone();

    let reader = tokio::task::spawn_blocking(move || {
        pty_mgr_inner.spawn(pty::SpawnConfig {
            id: pty_id_for_spawn,
            cwd: &cwd_clone,
            cols: 80,
            rows: 24,
            program: &shell_path,
            args: &[],
            env: &[],
        })
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))??;

    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.shell_pty_id = Some(pty_id.clone());
        }
    }

    // Emit updated session list
    {
        let sessions = state.sessions.lock().unwrap();
        let mut session_list: Vec<_> = sessions.values().cloned().collect();
        session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let _ = app.emit("session-update", &session_list);
        crate::tray::update_tray(&app, &session_list);
    }

    // Spawn background thread to read PTY output and emit events
    let app_clone = app.clone();
    let pty_id_for_reader = pty_id.clone();
    let session_id_for_cleanup = session_id.clone();
    let state_for_cleanup = state.inner().clone();
    let pty_mgr_for_exit = pty_mgr.inner().clone();

    std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let engine = base64::engine::general_purpose::STANDARD;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded = engine.encode(&buf[..n]);
                    let _ = app_clone.emit(
                        "terminal-output",
                        serde_json::json!({
                            "session_id": pty_id_for_reader,
                            "data": encoded,
                        }),
                    );
                }
                Err(_) => break,
            }
        }

        let exit_code = pty_mgr_for_exit.try_wait(&pty_id_for_reader).ok().flatten();

        let _ = app_clone.emit(
            "terminal-exited",
            serde_json::json!({
                "session_id": pty_id_for_reader,
                "exit_code": exit_code,
            }),
        );

        // Clear shell_pty_id on the parent session
        {
            let mut sessions = state_for_cleanup.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id_for_cleanup) {
                session.shell_pty_id = None;
            }
            let mut session_list: Vec<_> = sessions.values().cloned().collect();
            session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            let _ = app_clone.emit("session-update", &session_list);
            crate::tray::update_tray(&app_clone, &session_list);
        }
    });

    Ok(pty_id)
}
```

- [ ] **Step 2: Implement `close_session_shell` command**

In `src-tauri/src/lib.rs`, add after `open_session_shell`:

```rust
#[tauri::command]
fn close_session_shell(
    session_id: String,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
    app: AppHandle,
) -> Result<(), String> {
    let pty_id = {
        let mut sessions = state.sessions.lock().unwrap();
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("session not found: {}", session_id))?;
        session.shell_pty_id.take()
    };

    if let Some(id) = pty_id {
        pty_mgr.close(&id);
    }

    let sessions = state.sessions.lock().unwrap();
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    Ok(())
}
```

- [ ] **Step 3: Update `dismiss_session` to clean up shell PTY**

In `src-tauri/src/lib.rs`, in the `dismiss_session` function, add shell cleanup before the existing `pty_mgr.close(&session_id)` call. Replace the first few lines of `dismiss_session`:

```rust
#[tauri::command]
fn dismiss_session(
    session_id: String,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
    app: AppHandle,
) {
    // Close shell PTY if one exists
    {
        let sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get(&session_id) {
            if let Some(ref shell_id) = session.shell_pty_id {
                pty_mgr.close(shell_id);
            }
        }
    }

    pty_mgr.close(&session_id);

    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    let mut session_list: Vec<_> = sessions.values().cloned().collect();
    session_list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    drop(sessions);

    let _ = app.emit("session-update", &session_list);
    crate::tray::update_tray(&app, &session_list);

    let db = state.db.lock().unwrap();
    db::end_session(&db, &session_id, &Utc::now().to_rfc3339());
}
```

- [ ] **Step 4: Register new commands**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list after `close_terminal,`:

```rust
open_session_shell,
close_session_shell,
```

- [ ] **Step 5: Run backend tests**

Run: `cd src-tauri && cargo test 2>&1`
Expected: all tests pass (compiles and existing tests still work)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add open_session_shell and close_session_shell commands"
```

---

### Task 4: Add socket API commands for shell

**Files:**
- Modify: `src-tauri/src/api.rs`

- [ ] **Step 1: Write failing tests**

In `src-tauri/src/api.rs`, add to the test module:

```rust
#[test]
fn action_open_session_shell_sets_pty_id() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_action("open_session_shell", &args, &state).unwrap();
    let pty_id = result["pty_id"].as_str().unwrap();
    assert!(!pty_id.is_empty());
    let sessions = state.sessions.lock().unwrap();
    assert_eq!(sessions.get("s1").unwrap().shell_pty_id.as_deref(), Some(pty_id));
}

#[test]
fn action_open_session_shell_idempotent() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result1 = handle_action("open_session_shell", &args, &state).unwrap();
    let result2 = handle_action("open_session_shell", &args, &state).unwrap();
    assert_eq!(result1["pty_id"], result2["pty_id"]);
}

#[test]
fn action_open_session_shell_not_found() {
    let state = test_state();
    let args = Some(serde_json::json!({"session_id": "nope"}));
    let err = handle_action("open_session_shell", &args, &state).unwrap_err();
    assert!(err.contains("session not found"));
}

#[test]
fn action_close_session_shell_clears_pty_id() {
    let state = test_state();
    insert_session(&state, "s1");
    // Set a shell_pty_id manually
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.get_mut("s1").unwrap().shell_pty_id = Some("pty-123".into());
    }
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_action("close_session_shell", &args, &state).unwrap();
    assert_eq!(result["closed"], true);
    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.get("s1").unwrap().shell_pty_id.is_none());
}

#[test]
fn action_close_session_shell_noop_when_no_shell() {
    let state = test_state();
    insert_session(&state, "s1");
    let args = Some(serde_json::json!({"session_id": "s1"}));
    let result = handle_action("close_session_shell", &args, &state).unwrap();
    assert_eq!(result["closed"], true);
}

#[test]
fn action_close_session_shell_not_found() {
    let state = test_state();
    let args = Some(serde_json::json!({"session_id": "nope"}));
    let err = handle_action("close_session_shell", &args, &state).unwrap_err();
    assert!(err.contains("session not found"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test action_open_session_shell action_close_session_shell 2>&1`
Expected: FAIL — unknown action command

- [ ] **Step 3: Implement socket API handlers**

In `src-tauri/src/api.rs`, in the `handle_action` function, add before the `_ => Err(...)` arm:

```rust
"open_session_shell" => {
    let session_id = get_session_id()?;
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("session not found: {}", session_id))?;
    if let Some(ref pty_id) = session.shell_pty_id {
        return Ok(serde_json::json!({"pty_id": pty_id}));
    }
    let pty_id = uuid::Uuid::new_v4().to_string();
    session.shell_pty_id = Some(pty_id.clone());
    Ok(serde_json::json!({"pty_id": pty_id}))
}
"close_session_shell" => {
    let session_id = get_session_id()?;
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("session not found: {}", session_id))?;
    session.shell_pty_id = None;
    Ok(serde_json::json!({"closed": true}))
}
```

Note: The socket API handler sets `shell_pty_id` but doesn't actually spawn a PTY (the socket API doesn't have access to `PtyManager`). The actual PTY spawn happens via the Tauri command. The socket API version is useful for querying/clearing state. If full PTY spawn via socket is needed later, it can be added.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test action_open_session_shell action_close_session_shell 2>&1`
Expected: all 6 tests pass

- [ ] **Step 5: Run full backend test suite**

Run: `cd src-tauri && cargo test 2>&1`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/api.rs
git commit -m "feat: add open_session_shell and close_session_shell socket API commands"
```

---

### Task 5: Update frontend types

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/grouping.test.ts`

- [ ] **Step 1: Add `shell_pty_id` to Session interface**

In `src/lib/types.ts`, add after `metadata: Record<string, MetadataEntry>;`:

```typescript
shell_pty_id: string | null;
```

- [ ] **Step 2: Fix `makeSession` in grouping test**

In `src/lib/grouping.test.ts`, add `shell_pty_id: null,` to the `makeSession` function after `metadata: {},`:

```typescript
shell_pty_id: null,
```

- [ ] **Step 3: Run frontend tests**

Run: `npm test 2>&1`
Expected: all tests pass

- [ ] **Step 4: Run type check**

Run: `npm run check 2>&1`
Expected: passes (the Dashboard `historySessions` mapping in `Dashboard.svelte` needs `shell_pty_id: null` added — see next task)

If the type check fails because `Dashboard.svelte` constructs `Session` objects for history sessions without `shell_pty_id`, fix it by adding `shell_pty_id: null,` to that object literal in `Dashboard.svelte` (around line 258, inside the `session={{...}}` prop).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/grouping.test.ts
git commit -m "feat: add shell_pty_id to frontend Session type"
```

---

### Task 6: Rename Terminal.svelte `sessionId` prop to `ptyId`

**Files:**
- Modify: `src/lib/components/Terminal.svelte`
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Rename prop in Terminal.svelte**

In `src/lib/components/Terminal.svelte`, replace the Props interface and destructuring:

Replace:
```typescript
interface Props {
  sessionId: string;
}

let { sessionId }: Props = $props();
```

With:
```typescript
interface Props {
  ptyId: string;
}

let { ptyId }: Props = $props();
```

Then replace all remaining occurrences of `sessionId` with `ptyId` in the file (there are usages in `invoke('write_terminal', ...)`, the `listen` callbacks filtering by `event.payload.session_id`, and the `invoke('resize_terminal', ...)`).

Note: The `invoke` calls still use `sessionId` as the parameter name for the Rust command (that's the Rust function parameter name). The mapping is:
- `invoke('write_terminal', { sessionId: ptyId, data: encoded })` — the key `sessionId` matches the Rust param name
- `invoke('resize_terminal', { sessionId: ptyId, cols: term.cols, rows: term.rows })` — same
- The `listen` callback filters: `event.payload.session_id !== ptyId` — the event payload field is `session_id` (set in Rust), compared against our `ptyId`

Full updated script section:

```typescript
interface Props {
  ptyId: string;
}

let { ptyId }: Props = $props();

let containerEl: HTMLDivElement;
let exited = $state(false);

onMount(() => {
  const term = new XTerm({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    theme: {
      background: '#000000',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#ff2d7840',
    },
    cursorBlink: true,
    convertEol: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(containerEl);

  const dataDisposable = term.onData((data: string) => {
    const encoded = btoa(data);
    invoke('write_terminal', { sessionId: ptyId, data: encoded });
  });

  let unlistenOutput: (() => void) | undefined;
  listen<TerminalOutputPayload>('terminal-output', (event) => {
    if (event.payload.session_id !== ptyId) return;
    const bytes = Uint8Array.from(atob(event.payload.data), (c) => c.charCodeAt(0));
    term.write(bytes);
  }).then((fn) => {
    unlistenOutput = fn;
  });

  let unlistenExit: (() => void) | undefined;
  listen<TerminalExitedPayload>('terminal-exited', (event) => {
    if (event.payload.session_id !== ptyId) return;
    exited = true;
    term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
  }).then((fn) => {
    unlistenExit = fn;
  });

  const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    if (width === 0 || height === 0) return;
    fitAddon.fit();
    if (!exited) {
      invoke('resize_terminal', {
        sessionId: ptyId,
        cols: term.cols,
        rows: term.rows,
      });
    }
  });
  resizeObserver.observe(containerEl);

  return () => {
    dataDisposable.dispose();
    unlistenOutput?.();
    unlistenExit?.();
    resizeObserver.disconnect();
    term.dispose();
  };
});
```

- [ ] **Step 2: Update Dashboard.svelte to use new prop name**

In `src/lib/components/Dashboard.svelte`, find the Terminal usage (around line 287):

Replace:
```svelte
<Terminal sessionId={session.session_id} />
```

With:
```svelte
<Terminal ptyId={session.session_id} />
```

This is correct because `spawn_terminal` uses the session_id as the PTY id.

- [ ] **Step 3: Run type check**

Run: `npm run check 2>&1`
Expected: passes

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Terminal.svelte src/lib/components/Dashboard.svelte
git commit -m "refactor: rename Terminal sessionId prop to ptyId"
```

---

### Task 7: Add terminal button to SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add `onOpenShell` prop**

In `src/lib/components/SessionCard.svelte`, update the Props interface. Add after `compact?: boolean;`:

```typescript
onOpenShell?: (sessionId: string) => void;
```

Update the destructuring. Replace:
```typescript
let { session, onDismiss, historyMode = false, endedAt, compact = false }: Props = $props();
```

With:
```typescript
let { session, onDismiss, historyMode = false, endedAt, compact = false, onOpenShell }: Props = $props();
```

- [ ] **Step 2: Add terminal button to header row**

In `src/lib/components/SessionCard.svelte`, in the `row-right` div, add the terminal button before the chevron span. Replace:

```svelte
<div class="row-right">
  <span class="uptime">{uptime}</span>
  <span class="chevron">{expanded ? '▼' : '▶'}</span>
</div>
```

With:

```svelte
<div class="row-right">
  <span class="uptime">{uptime}</span>
  {#if onOpenShell && !historyMode}
    <button
      class="open-terminal"
      title="Open terminal"
      onclick={(e) => { e.stopPropagation(); onOpenShell(session.session_id); }}
    >&#x25B8;_</button>
  {/if}
  <span class="chevron">{expanded ? '▼' : '▶'}</span>
</div>
```

- [ ] **Step 3: Add terminal button styles**

In `src/lib/components/SessionCard.svelte`, add CSS after the `.chevron` rule:

```css
.open-terminal {
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  font-family: monospace;
  padding: 1px 4px;
  opacity: 0;
  transition: opacity 0.1s, color 0.1s, border-color 0.1s;
}

.card:hover .open-terminal {
  opacity: 1;
}

.open-terminal:hover {
  color: var(--text-primary);
  border-color: var(--border);
}
```

- [ ] **Step 4: Run type check**

Run: `npm run check 2>&1`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add terminal button to SessionCard"
```

---

### Task 8: Wire up Dashboard — tab toggle and shell launch

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`
- Modify: `src/lib/components/ProjectGroup.svelte`

- [ ] **Step 1: Add shell launch function and tab state to Dashboard**

In `src/lib/components/Dashboard.svelte`, add after `let notificationPanelOpen = $state(false);`:

```typescript
let tabState = $state<Record<string, 'detail' | 'terminal'>>({});
```

Add the `openShell` function after `spawnSession`:

```typescript
async function openShell(sessionId: string) {
  try {
    const ptyId = await invoke<string>('open_session_shell', { sessionId });
    selectedSessionId = sessionId;
    tabState[sessionId] = 'terminal';
  } catch (e) {
    console.error('Failed to open shell:', e);
  }
}
```

- [ ] **Step 2: Pass `onOpenShell` to SessionCard instances**

In `src/lib/components/Dashboard.svelte`, find the compact SessionCard in the sidebar (around line 243):

Replace:
```svelte
<SessionCard session={item.session} onDismiss={handleDismiss} compact />
```

With:
```svelte
<SessionCard session={item.session} onDismiss={handleDismiss} onOpenShell={openShell} compact />
```

- [ ] **Step 3: Pass `onOpenShell` to ProjectGroup**

In `src/lib/components/Dashboard.svelte`, find the ProjectGroup component. Replace:

```svelte
<ProjectGroup
  cwd={item.cwd}
  sessions={item.sessions}
  {selectedSessionId}
  onSelect={selectSession}
  onDismiss={handleDismiss}
/>
```

With:

```svelte
<ProjectGroup
  cwd={item.cwd}
  sessions={item.sessions}
  {selectedSessionId}
  onSelect={selectSession}
  onDismiss={handleDismiss}
  onOpenShell={openShell}
/>
```

- [ ] **Step 4: Update ProjectGroup to accept and pass `onOpenShell`**

In `src/lib/components/ProjectGroup.svelte`, add to the Props interface after `onDismiss`:

```typescript
onOpenShell?: (sessionId: string) => void;
```

Update the destructuring to include it:

```typescript
let { cwd, sessions, selectedSessionId, onSelect, onDismiss, onOpenShell }: Props = $props();
```

Update the SessionCard usage inside ProjectGroup. Replace:

```svelte
<SessionCard {session} onDismiss={onDismiss} compact />
```

With:

```svelte
<SessionCard {session} onDismiss={onDismiss} {onOpenShell} compact />
```

- [ ] **Step 5: Add tab toggle and shell terminal pane to main area**

In `src/lib/components/Dashboard.svelte`, replace the main area section (the `{#if selectedSession?.source !== 'spawned'}` block and everything inside `.main-area`):

Replace:
```svelte
<!-- Main area -->
<div class="main-area">
  {#each sessionStore.sessions as session (session.session_id)}
    {#if session.source === 'spawned'}
      <div class="terminal-pane" class:active={selectedSessionId === session.session_id}>
        <Terminal ptyId={session.session_id} />
      </div>
    {/if}
  {/each}

  {#if selectedSession?.source !== 'spawned'}
    {#if selectedSession}
      <div class="detail-view">
        <SessionCard session={selectedSession} onDismiss={handleDismiss} />
      </div>
    {:else}
      <div class="no-selection">
        <span class="no-selection-text">Select a session</span>
      </div>
    {/if}
  {/if}
</div>
```

With:

```svelte
<!-- Main area -->
<div class="main-area">
  {#each sessionStore.sessions as session (session.session_id)}
    {#if session.source === 'spawned'}
      <div class="terminal-pane" class:active={selectedSessionId === session.session_id}>
        <Terminal ptyId={session.session_id} />
      </div>
    {/if}
  {/each}

  {#each sessionStore.sessions as session (session.session_id)}
    {#if session.shell_pty_id}
      <div class="terminal-pane" class:active={selectedSessionId === session.session_id && tabState[session.session_id] === 'terminal'}>
        <Terminal ptyId={session.shell_pty_id} />
      </div>
    {/if}
  {/each}

  {#if selectedSession?.source !== 'spawned'}
    {#if selectedSession}
      {#if selectedSession.shell_pty_id}
        <div class="tab-bar">
          <button
            class="tab-btn"
            class:active={tabState[selectedSession.session_id] !== 'terminal'}
            onclick={() => { tabState[selectedSession.session_id] = 'detail'; }}
          >Detail</button>
          <button
            class="tab-btn"
            class:active={tabState[selectedSession.session_id] === 'terminal'}
            onclick={() => { tabState[selectedSession.session_id] = 'terminal'; }}
          >Terminal</button>
        </div>
      {/if}
      {#if tabState[selectedSession.session_id] !== 'terminal'}
        <div class="detail-view">
          <SessionCard session={selectedSession} onDismiss={handleDismiss} onOpenShell={openShell} />
        </div>
      {/if}
    {:else}
      <div class="no-selection">
        <span class="no-selection-text">Select a session</span>
      </div>
    {/if}
  {/if}
</div>
```

- [ ] **Step 6: Add `shell_pty_id` to history session objects**

In `src/lib/components/Dashboard.svelte`, find the history session object construction (around line 258). Add `shell_pty_id: null,` after `metadata: {},`:

```typescript
shell_pty_id: null,
```

- [ ] **Step 7: Add tab bar styles**

In `src/lib/components/Dashboard.svelte`, add CSS after the `.detail-view` rule:

```css
.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  flex-shrink: 0;
}

.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 8px 12px;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover {
  color: var(--text-secondary);
}

.tab-btn.active {
  color: var(--text-primary);
  border-bottom-color: var(--active);
}
```

- [ ] **Step 8: Run type check**

Run: `npm run check 2>&1`
Expected: passes

- [ ] **Step 9: Run frontend tests**

Run: `npm test 2>&1`
Expected: all existing tests pass

- [ ] **Step 10: Commit**

```bash
git add src/lib/components/Dashboard.svelte src/lib/components/ProjectGroup.svelte
git commit -m "feat: wire up shell launch and tab toggle in Dashboard"
```

---

### Task 9: Manual smoke test

- [ ] **Step 1: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify terminal button**

- Start a Claude Code session in another terminal so a session card appears
- Hover over the session card — terminal button should appear
- Click the terminal button — a shell should open in the session's cwd
- Verify you can type commands in the embedded shell
- Verify the Detail/Terminal tab toggle works
- Switch to another session and back — tab state should be preserved
- Dismiss the session — shell should be killed cleanly

- [ ] **Step 3: Commit any fixes if needed**

---

### Task 10: Run full test suites

- [ ] **Step 1: Run backend tests**

Run: `cd src-tauri && cargo test 2>&1`
Expected: all tests pass

- [ ] **Step 2: Run frontend tests**

Run: `npm test 2>&1`
Expected: all tests pass

- [ ] **Step 3: Run type check**

Run: `npm run check 2>&1`
Expected: passes
