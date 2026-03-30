# Accent Bar + State Labels + Unread Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the session status dot with a left accent bar colored by state, add text labels for attention states, and track unread activity per session.

**Architecture:** Add `has_unread: bool` to `Session` (runtime-only). Set on state-change events, cleared via new Tauri command. Frontend replaces `SessionStatusIcon` with a CSS left border + optional label. Accent bar color and label derived from session state.

**Tech Stack:** Rust, Svelte 5, Tauri commands

---

### Task 1: Add `has_unread` to Session Struct

**Files:**
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/server.rs` (test module)

- [ ] **Step 1: Write failing test**

In `src-tauri/src/server.rs` test module:

```rust
#[test]
fn session_has_unread_defaults_to_false() {
    use crate::state::Session;
    let session = Session::new("s1".into(), "/tmp".into());
    assert!(!session.has_unread);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test session_has_unread_defaults_to_false`
Expected: FAIL — `has_unread` doesn't exist

- [ ] **Step 3: Add `has_unread` field**

In `src-tauri/src/state.rs`, add to `Session` struct:

```rust
pub has_unread: bool,
```

In `Session::new()`, add:

```rust
has_unread: false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test session_has_unread_defaults_to_false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/server.rs
git commit -m "feat: add has_unread field to Session"
```

---

### Task 2: Set `has_unread` on State-Change Events

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Write failing tests**

In `src-tauri/src/server.rs` test module:

```rust
#[test]
fn notification_sets_has_unread() {
    use crate::state::Session;
    let mut session = Session::new("s1".into(), "/tmp".into());
    session.processing = true;

    // Simulate Notification event
    if session.processing {
        session.pending_approval = true;
        session.has_unread = true;
    }

    assert!(session.has_unread);
}

#[test]
fn stop_sets_has_unread() {
    use crate::state::Session;
    let mut session = Session::new("s1".into(), "/tmp".into());
    session.processing = true;

    // Simulate Stop event
    session.processing = false;
    session.pending_approval = false;
    session.has_unread = true;

    assert!(session.has_unread);
}
```

- [ ] **Step 2: Run tests to verify they pass**

These tests pass immediately since they set `has_unread` directly. The real verification is that we wire it in `handle_event`.

Run: `cd src-tauri && cargo test notification_sets_has_unread stop_sets_has_unread`
Expected: PASS

- [ ] **Step 3: Wire `has_unread = true` in handle_event**

In `src-tauri/src/server.rs`, in the `handle_event` match arms:

In the `"Notification"` arm, after `session.pending_approval = true;`, add:

```rust
session.has_unread = true;
```

In the `"Stop"` arm, after `session.pending_approval = false;`, add:

```rust
session.has_unread = true;
```

Do NOT set `has_unread` on `UserPromptSubmit` — that clears the attention state, not creates one.

- [ ] **Step 4: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: set has_unread on notification and stop events"
```

---

### Task 3: Add `mark_session_read` Tauri Command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

In `src-tauri/src/lib.rs`, add:

```rust
#[tauri::command]
fn mark_session_read(session_id: String, state: tauri::State<'_, Arc<AppState>>) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.has_unread = false;
    }
}
```

- [ ] **Step 2: Register the command**

In the `tauri::Builder` chain in `run()`, add `mark_session_read` to the `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    dismiss_session,
    get_session_history,
    get_retention_days,
    set_retention_days,
    check_hooks_status,
    install_hooks,
    uninstall_hooks,
    mark_session_read,
])
```

- [ ] **Step 3: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add mark_session_read Tauri command"
```

---

### Task 4: Add `has_unread` to Frontend Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add field to Session interface**

In `src/lib/types.ts`, add to `Session`:

```typescript
has_unread: boolean;
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: May show errors in components that destructure Session — that's fine, we fix in next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add has_unread to frontend Session type"
```

---

### Task 5: Replace SessionStatusIcon with Accent Bar

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Define session state derivation and color map**

In `SessionCard.svelte`, replace the existing `isPending` and `isActive` derivations with a unified state:

```typescript
type CardState = 'approval' | 'input' | 'running' | 'idle';

let cardState = $derived<CardState>(
  session.pending_approval
    ? 'approval'
    : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
      ? 'running'
      : historyMode
        ? 'idle'
        : 'input'
);

let isActive = $derived(cardState === 'running');
let isPending = $derived(cardState === 'approval');
```

- [ ] **Step 2: Remove SessionStatusIcon import and usage**

Remove the import:

```typescript
// DELETE: import SessionStatusIcon from './SessionStatusIcon.svelte';
```

Remove `<SessionStatusIcon {session} size={14} {historyMode} />` from the header row.

- [ ] **Step 3: Add accent bar and state label to template**

Replace the outer `<div class="card" ...>` wrapper. The card gets a left border via CSS variable:

```svelte
<div
  class="card"
  class:expanded
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
>
```

Add state label in the header row, after the project name and before any existing badges:

```svelte
{#if cardState === 'approval'}
  <span class="state-label approval">APPROVAL</span>
{:else if cardState === 'input' && !historyMode}
  <span class="state-label input">INPUT</span>
{/if}
```

- [ ] **Step 4: Add unread dot**

In the header row, after the project name (and before the state label):

```svelte
{#if session.has_unread}
  <span class="unread-dot"></span>
{/if}
```

- [ ] **Step 5: Call `mark_session_read` on expand**

Update the `toggleExpand` function:

```typescript
import { invoke } from '@tauri-apps/api/core';

async function toggleExpand() {
  expanded = !expanded;
  if (expanded && session.has_unread) {
    await invoke('mark_session_read', { sessionId: session.session_id });
  }
}
```

- [ ] **Step 6: Update styles**

Remove the `.card.running` and `.card.needs-attention` rule sets. Replace with:

```css
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent-color, var(--border));
}

.card.has-attention {
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent-color) 10%, transparent);
}

:root {
  --state-approval: #d4a017;
  --state-input: #3fb950;
  --state-running: #ff2d78;
  --state-idle: #444444;
}
```

Note: The CSS custom properties `--state-*` should go in `app.css` alongside the other custom properties. Add them there instead of in the component.

```css
.state-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.state-label.approval {
  color: var(--state-approval);
}

.state-label.input {
  color: var(--state-input);
}

.unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-color);
  flex-shrink: 0;
}
```

- [ ] **Step 7: Remove idle-text span**

The "idle" text is now communicated by the gray accent bar, so remove:

```svelte
<!-- DELETE this block -->
{#if !isActive && !isPending && !historyMode}
  <span class="idle-text">idle</span>
{/if}
```

And delete the `.idle-text` CSS rule.

- [ ] **Step 8: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/SessionCard.svelte src/app.css
git commit -m "feat: replace status dot with accent bar, state labels, and unread dot"
```

---

### Task 6: Update SessionStore `globalState` for New States

**Files:**
- Modify: `src/lib/stores/sessions.svelte.ts`

- [ ] **Step 1: Add `runningCount` getter**

The store's `globalState` already handles the priority correctly (approval > input > running > idle). Verify it still works with the new `has_unread` field. No changes needed to the store logic — `has_unread` is per-session UI state, not global state.

However, add a `hasUnread` getter for the header to optionally use:

```typescript
get hasUnread(): boolean {
  return this.sessions.some(s => s.has_unread);
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/sessions.svelte.ts
git commit -m "feat: add hasUnread getter to session store"
```

---

### Task 7: Clean Up Unused SessionStatusIcon

**Files:**
- Delete: `src/lib/components/SessionStatusIcon.svelte` (if no longer imported anywhere)

- [ ] **Step 1: Check for remaining imports**

Search for `SessionStatusIcon` across the codebase. If only imported in `SessionCard.svelte` (which we already removed), delete the file.

Run: `grep -r "SessionStatusIcon" src/`

- [ ] **Step 2: Delete if unused**

```bash
rm src/lib/components/SessionStatusIcon.svelte
```

- [ ] **Step 3: Run all checks**

Run: `npm run check && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove unused SessionStatusIcon component"
```

---

### Task 8: Verify End-to-End

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 2: Run frontend checks and tests**

Run: `npm run check && npm test`
Expected: PASS

- [ ] **Step 3: Manual smoke test**

Run: `npm run tauri dev`
- Verify left accent bars appear on all session cards
- Verify colors: pink for running, yellow for approval-waiting, green for input-waiting, gray for idle
- Verify "APPROVAL" label appears when a session needs approval
- Verify "INPUT" label appears when a session is waiting for input
- Verify unread dot appears after a state change, disappears when card is expanded
- Verify history tab cards show gray accent bars (idle state)
