# Multi-Agent Orchestration View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parent-child session tracking and a tree visualization so users can see subagent hierarchies at a glance.

**Architecture:** Add `parent_session_id` field to `Session` with hybrid assignment (explicit for spawned terminals, heuristic for external subagents). Modify `grouping.ts` to nest children under parents in the sidebar. Add `TreeNode.svelte` and `AgentTree.svelte` components for the tree detail tab. Extend Dashboard tab state to include `'tree'`.

**Tech Stack:** Rust (state, server), Svelte 5, TypeScript, Vitest

---

### Task 1: Add `parent_session_id` to Session + pending subagent tracking

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `state.rs`:

```rust
#[test]
fn session_new_parent_session_id_is_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert!(s.parent_session_id.is_none());
}

#[test]
fn session_parent_session_id_serializes_null_when_none() {
    let s = Session::new("s1".into(), "/tmp".into());
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["parent_session_id"].is_null());
}

#[test]
fn session_parent_session_id_serializes_when_set() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.parent_session_id = Some("parent-1".into());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["parent_session_id"], "parent-1");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test parent_session_id`
Expected: compilation error — field does not exist.

- [ ] **Step 3: Add `parent_session_id` to Session struct**

In `state.rs`, add to the `Session` struct (after `shell_pty_id` field, around line 62):

```rust
pub parent_session_id: Option<String>,
```

And in `Session::new()` (around line 162), add:

```rust
parent_session_id: None,
```

- [ ] **Step 4: Add `pending_subagent_starts` to AppState**

In `state.rs`, add to the `AppState` struct (after `spawned_id_map`, around line 81):

```rust
pub pending_subagent_starts: Mutex<Vec<(String, String, DateTime<Utc>)>>,
```

And in `AppState::new()` (around line 91), add:

```rust
pending_subagent_starts: Mutex::new(Vec::new()),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test parent_session_id`
Expected: 3 tests pass.

Run: `cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add parent_session_id to Session and pending_subagent_starts to AppState"
```

---

### Task 2: Heuristic parent matching in server.rs

**Files:**
- Modify: `src-tauri/src/server.rs`

- [ ] **Step 1: Add pending subagent recording on SubagentStart**

In `server.rs`, find the `"SubagentStart"` match arm (around line 295). Change it from:

```rust
"SubagentStart" => {
    if let Some(session) = sessions.get_mut(&session_id) {
        session.active_subagents = session.active_subagents.saturating_add(1);
    }
}
```

To:

```rust
"SubagentStart" => {
    if let Some(session) = sessions.get_mut(&session_id) {
        session.active_subagents = session.active_subagents.saturating_add(1);
        let cwd = session.cwd.clone();
        state.pending_subagent_starts.lock().unwrap().push(
            (session_id.clone(), cwd, Utc::now())
        );
    }
}
```

- [ ] **Step 2: Add parent matching on SessionStart**

In `server.rs`, find the session creation block. This is in the `handle_hook_event` function, before the event match block. There's a section that creates new sessions when they don't exist (around lines 170-210). Find where `Session::new(session_id.clone(), payload.cwd.clone())` is called for new sessions and add parent matching after session creation:

After the new session is inserted into the sessions map and before the event match block, add:

```rust
// Try to match this new session to a pending subagent start
{
    let mut pending = state.pending_subagent_starts.lock().unwrap();
    let now = Utc::now();
    // Prune entries older than 5 seconds
    pending.retain(|(_, _, ts)| (now - *ts).num_seconds() < 5);
    // Find a matching pending start (same cwd, within 2 seconds)
    if let Some(pos) = pending.iter().position(|(_, cwd, ts)| {
        cwd == &payload.cwd && (now - *ts).num_seconds() < 2
    }) {
        let (parent_id, _, _) = pending.remove(pos);
        if let Some(session) = sessions.get_mut(&session_id) {
            session.parent_session_id = Some(parent_id);
        }
    }
}
```

This code should run only for newly created sessions (not existing ones). Place it inside the block that handles creating a new session — right after the `sessions.insert(...)` call.

- [ ] **Step 3: Run full backend test suite**

Run: `cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: heuristic parent-child matching on SubagentStart/SessionStart"
```

---

### Task 3: Explicit parent for spawned terminals

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `parent_session_id` parameter to `spawn_terminal`**

In `lib.rs`, find the `spawn_terminal` command (around line 153). Add an optional parameter:

Change the function signature from:

```rust
async fn spawn_terminal(
    cwd: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
```

To:

```rust
async fn spawn_terminal(
    cwd: String,
    parent_session_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pty_mgr: tauri::State<'_, Arc<pty::PtyManager>>,
) -> Result<String, String> {
```

- [ ] **Step 2: Set parent_session_id on the spawned session**

In the session creation block (around line 164-168), after `session.source = SessionSource::Spawned;`, add:

```rust
session.parent_session_id = parent_session_id;
```

- [ ] **Step 3: Run full backend test suite**

Run: `cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: pass parent_session_id to spawned terminals"
```

---

### Task 4: Frontend type + grouping changes

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/grouping.ts`
- Modify: `src/lib/grouping.test.ts`

- [ ] **Step 1: Add `parent_session_id` to Session type**

In `src/lib/types.ts`, add to the `Session` interface (after `shell_pty_id`):

```typescript
parent_session_id: string | null;
```

- [ ] **Step 2: Write failing grouping tests**

In `src/lib/grouping.test.ts`, update `makeSession` to include the new field:

Add `parent_session_id: null,` to the return object (after `shell_pty_id: null,`).

Then add these tests:

```typescript
describe('parent-child grouping', () => {
  it('excludes child sessions from top-level rendering', () => {
    const sessions = [
      makeSession('parent', '/a', '2026-03-30T01:00:00Z'),
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 'parent' },
    ];
    const result = buildRenderList(sessions);
    // Parent renders as session, child is excluded (not a group, not a standalone)
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
    if (result[0].type === 'session') {
      expect(result[0].session.session_id).toBe('parent');
    }
  });

  it('child with no matching parent renders as top-level (orphaned)', () => {
    const sessions = [
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 'gone-parent' },
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
  });

  it('children do not count toward cwd group threshold', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      { ...makeSession('child', '/a', '2026-03-30T02:00:00Z'), parent_session_id: 's1' },
    ];
    const result = buildRenderList(sessions);
    // s1 is standalone (child excluded from grouping), not a group
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('session');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run src/lib/grouping.test.ts`
Expected: failures — `parent_session_id` missing from makeSession, and grouping logic doesn't filter children.

- [ ] **Step 4: Update makeSession in test file**

Add `parent_session_id: null,` to `makeSession` in `grouping.test.ts` (after `shell_pty_id: null,`).

Also add `parent_session_id: null,` to `makeSession` in `src/lib/stores/sessions.test.ts` (after `shell_pty_id: null,`).

- [ ] **Step 5: Implement grouping changes**

Replace the entire `buildRenderList` function in `src/lib/grouping.ts`:

```typescript
export function buildRenderList(sessions: Session[]): RenderItem[] {
  const sessionIds = new Set(sessions.map(s => s.session_id));

  // Separate children (those with a parent that exists in the current session list)
  const children = new Set<string>();
  for (const s of sessions) {
    if (s.parent_session_id && sessionIds.has(s.parent_session_id)) {
      children.add(s.session_id);
    }
  }

  // Only group top-level sessions (non-children)
  const topLevel = sessions.filter(s => !children.has(s.session_id));

  const byCwd = new Map<string, Session[]>();
  for (const s of topLevel) {
    const group = byCwd.get(s.cwd);
    if (group) {
      group.push(s);
    } else {
      byCwd.set(s.cwd, [s]);
    }
  }

  const items: RenderItem[] = [];
  for (const [cwd, group] of byCwd) {
    if (group.length >= 2) {
      items.push({ type: 'group', key: `group:${cwd}`, cwd, sessions: group });
    } else {
      items.push({ type: 'session', key: group[0].session_id, session: group[0] });
    }
  }

  items.sort((a, b) => {
    const aTime = a.type === 'group'
      ? Math.max(...a.sessions.map(s => new Date(s.started_at).getTime()))
      : new Date(a.session.started_at).getTime();
    const bTime = b.type === 'group'
      ? Math.max(...b.sessions.map(s => new Date(s.started_at).getTime()))
      : new Date(b.session.started_at).getTime();
    return bTime - aTime;
  });

  return items;
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -- --run src/lib/grouping.test.ts`
Expected: all tests pass.

Run: `npm test -- --run`
Expected: all tests pass.

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/grouping.ts src/lib/grouping.test.ts src/lib/stores/sessions.test.ts
git commit -m "feat: add parent_session_id type and filter children from grouping"
```

---

### Task 5: Sidebar child indentation in Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add child sessions derivation**

In Dashboard.svelte's `<script>` block, add a derived value that computes children per session:

```typescript
let childrenByParent = $derived(() => {
  const map = new Map<string, Session[]>();
  const sessionIds = new Set(sessionStore.sessions.map(s => s.session_id));
  for (const s of sessionStore.sessions) {
    if (s.parent_session_id && sessionIds.has(s.parent_session_id)) {
      const list = map.get(s.parent_session_id) || [];
      list.push(s);
      map.set(s.parent_session_id, list);
    }
  }
  // Sort children by started_at ascending
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }
  return map;
});
```

- [ ] **Step 2: Render children under parent in sidebar**

In the sidebar's `{#each renderList as item}` block, after the `SessionCard` for a standalone session (around line 326-327), add child rendering:

Change the session item rendering from:

```svelte
{:else}
  <div
    class="sidebar-session"
    class:selected={selectedSessionId === item.session.session_id}
    onclick={() => selectSession(item.session.session_id)}
    role="button"
    tabindex="0"
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(item.session.session_id)}
  >
    <SessionCard session={item.session} onDismiss={handleDismiss} onOpenShell={openShell} compact />
  </div>
{/if}
```

To:

```svelte
{:else}
  <div
    class="sidebar-session"
    class:selected={selectedSessionId === item.session.session_id}
    onclick={() => selectSession(item.session.session_id)}
    role="button"
    tabindex="0"
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(item.session.session_id)}
  >
    <SessionCard session={item.session} onDismiss={handleDismiss} onOpenShell={openShell} compact />
  </div>
  {#if childrenByParent().has(item.session.session_id)}
    {#each childrenByParent().get(item.session.session_id) ?? [] as child (child.session_id)}
      <div
        class="sidebar-session child-session"
        class:selected={selectedSessionId === child.session_id}
        onclick={() => selectSession(child.session_id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(child.session_id)}
      >
        <SessionCard session={child} onDismiss={handleDismiss} onOpenShell={openShell} compact />
      </div>
    {/each}
  {/if}
{/if}
```

- [ ] **Step 3: Add CSS for child indentation**

Add to Dashboard.svelte's `<style>` block:

```css
.child-session {
  margin-left: 20px;
  border-left: 1px solid var(--border);
  padding-left: 8px;
}
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: render child sessions indented under parent in sidebar"
```

---

### Task 6: TreeNode.svelte component

**Files:**
- Create: `src/lib/components/TreeNode.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/TreeNode.svelte`:

```svelte
<script lang="ts">
  import type { Session } from '$lib/types';
  import { getProjectName, getSessionState } from '$lib/utils';
  import ToolIcon from './ToolIcon.svelte';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    onSelect: (sessionId: string) => void;
    onOpenShell: (sessionId: string) => void;
  }

  let { session, onDismiss, onSelect, onOpenShell }: Props = $props();

  let state = $derived(getSessionState(session));
  let lastTool = $derived(
    session.current_tool ?? (session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null)
  );
</script>

<div
  class="tree-node"
  style="--node-color: var(--state-{state})"
  onclick={() => onSelect(session.session_id)}
  role="button"
  tabindex="0"
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(session.session_id)}
>
  <div class="node-header">
    <span class="node-name">{getProjectName(session.cwd, session.display_name)}</span>
    <span class="node-state">{state === 'approval' ? 'APPROVAL' : state === 'running' ? 'RUNNING' : 'INPUT'}</span>
  </div>
  {#if lastTool}
    <div class="node-tool">
      <ToolIcon tool_name={lastTool.tool_name} size={10} />
      <span class="node-tool-name">{lastTool.tool_name}</span>
      {#if lastTool.summary}
        <span class="node-tool-summary">{lastTool.summary}</span>
      {/if}
    </div>
  {/if}
  <div class="node-actions">
    <button class="node-btn" onclick={(e) => { e.stopPropagation(); onDismiss(session.session_id); }}>Dismiss</button>
    <button class="node-btn" onclick={(e) => { e.stopPropagation(); onOpenShell(session.session_id); }}>&#x25B8;_</button>
  </div>
</div>

<style>
  .tree-node {
    background: var(--card-bg);
    border: 2px solid var(--node-color, var(--border));
    border-radius: 4px;
    padding: 10px 14px;
    min-width: 180px;
    max-width: 240px;
    cursor: pointer;
  }

  .tree-node:hover {
    background: var(--tool-bg);
  }

  .node-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    gap: 8px;
  }

  .node-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-state {
    font-size: 9px;
    font-weight: 600;
    color: var(--node-color);
    flex-shrink: 0;
  }

  .node-tool {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    overflow: hidden;
  }

  .node-tool-name {
    font-size: 10px;
    font-weight: 600;
    color: var(--node-color);
    flex-shrink: 0;
  }

  .node-tool-summary {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-actions {
    display: flex;
    gap: 4px;
  }

  .node-btn {
    background: var(--tool-bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 9px;
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 2px;
  }

  .node-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
</style>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/TreeNode.svelte
git commit -m "feat: add TreeNode component"
```

---

### Task 7: AgentTree.svelte component

**Files:**
- Create: `src/lib/components/AgentTree.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/AgentTree.svelte`:

```svelte
<script lang="ts">
  import type { Session } from '$lib/types';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    parentSession: Session;
    childSessions: Session[];
    onDismiss: (sessionId: string) => void;
    onSelect: (sessionId: string) => void;
    onOpenShell: (sessionId: string) => void;
  }

  let { parentSession, childSessions, onDismiss, onSelect, onOpenShell }: Props = $props();
</script>

<div class="agent-tree">
  <div class="tree-layout">
    <div class="parent-col">
      <TreeNode session={parentSession} {onDismiss} {onSelect} {onOpenShell} />
    </div>

    {#if childSessions.length > 0}
      <div class="connector-col">
        {#each childSessions as _, i}
          <div class="connector-segment" class:first={i === 0} class:last={i === childSessions.length - 1} class:only={childSessions.length === 1}></div>
        {/each}
      </div>

      <div class="children-col">
        {#each childSessions as child (child.session_id)}
          <TreeNode session={child} {onDismiss} {onSelect} {onOpenShell} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .agent-tree {
    padding: 24px;
    overflow: auto;
  }

  .tree-layout {
    display: flex;
    align-items: flex-start;
  }

  .parent-col {
    display: flex;
    align-items: center;
    align-self: center;
  }

  .connector-col {
    display: flex;
    flex-direction: column;
    width: 40px;
    align-self: stretch;
  }

  .connector-segment {
    flex: 1;
    border-right: 1px solid var(--border);
    min-height: 20px;
  }

  .connector-segment.first {
    border-top: none;
    border-bottom: 1px solid var(--border);
  }

  .connector-segment.last {
    border-top: 1px solid var(--border);
    border-bottom: none;
  }

  .connector-segment.only {
    border-top: none;
    border-bottom: none;
    border-right: 1px solid var(--border);
    position: relative;
  }

  .connector-segment.only::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 0;
    width: 100%;
    height: 1px;
    background: var(--border);
  }

  .connector-segment:not(.first):not(.last):not(.only) {
    border-top: none;
    border-bottom: none;
  }

  .children-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    justify-content: center;
  }
</style>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/AgentTree.svelte
git commit -m "feat: add AgentTree component"
```

---

### Task 8: Tree tab in Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Import AgentTree**

Add to Dashboard.svelte's imports:

```typescript
import AgentTree from './AgentTree.svelte';
```

- [ ] **Step 2: Extend tab state type**

Change the `tabState` declaration from:

```typescript
let tabState = $state<Record<string, 'detail' | 'terminal'>>({});
```

To:

```typescript
let tabState = $state<Record<string, 'detail' | 'terminal' | 'tree'>>({});
```

- [ ] **Step 3: Add childSessions derived value**

Add after the existing `childrenByParent` derived:

```typescript
let selectedChildSessions = $derived(
  selectedSession
    ? sessionStore.sessions.filter(s => s.parent_session_id === selectedSession.session_id)
        .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    : []
);

let showTreeTab = $derived(
  selectedSession !== undefined && (selectedChildSessions.length > 0 || (selectedSession?.active_subagents ?? 0) > 0)
);
```

- [ ] **Step 4: Add Tree tab button**

Find the tab-bar section that renders Detail/Terminal buttons (around line 425-436). Change the condition from `{#if selectedSession.shell_pty_id}` to always show the tab bar when there's a tree or terminal:

```svelte
{#if selectedSession.shell_pty_id || showTreeTab}
  <div class="tab-bar">
    <button
      class="tab-btn"
      class:active={!tabState[selectedSession.session_id] || tabState[selectedSession.session_id] === 'detail'}
      onclick={() => { tabState[selectedSession.session_id] = 'detail'; }}
    >Detail</button>
    {#if showTreeTab}
      <button
        class="tab-btn"
        class:active={tabState[selectedSession.session_id] === 'tree'}
        onclick={() => { tabState[selectedSession.session_id] = 'tree'; }}
      >Tree</button>
    {/if}
    {#if selectedSession.shell_pty_id}
      <button
        class="tab-btn"
        class:active={tabState[selectedSession.session_id] === 'terminal'}
        onclick={() => { tabState[selectedSession.session_id] = 'terminal'; }}
      >Terminal</button>
    {/if}
  </div>
{/if}
```

- [ ] **Step 5: Render AgentTree when tree tab is active**

Find the section that conditionally renders the detail view (around line 438). Change from:

```svelte
{#if tabState[selectedSession.session_id] !== 'terminal'}
  <div class="detail-view">
    <SessionCard session={selectedSession} onDismiss={handleDismiss} onOpenShell={openShell} />
  </div>
```

To:

```svelte
{#if !tabState[selectedSession.session_id] || tabState[selectedSession.session_id] === 'detail'}
  <div class="detail-view">
    <SessionCard session={selectedSession} onDismiss={handleDismiss} onOpenShell={openShell} />
  </div>
{:else if tabState[selectedSession.session_id] === 'tree'}
  <AgentTree
    parentSession={selectedSession}
    childSessions={selectedChildSessions}
    onDismiss={handleDismiss}
    onSelect={selectSession}
    onOpenShell={openShell}
  />
```

The existing terminal rendering stays as-is for the `'terminal'` tab state.

- [ ] **Step 6: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Run full test suite**

Run: `npm test -- --run && cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add Tree tab to Dashboard with AgentTree rendering"
```

---

### Task 9: Frontend tests

**Files:**
- Create: `src/lib/components/TreeNode.test.ts`

- [ ] **Step 1: Write TreeNode tests**

Create `src/lib/components/TreeNode.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TreeNode from './TreeNode.svelte';
import type { Session } from '$lib/types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'test-session',
    cwd: '/home/user/project',
    started_at: '2026-04-01T12:00:00Z',
    git_branch: null,
    current_tool: null,
    tool_history: [],
    active_subagents: 0,
    pending_approval: false,
    processing: true,
    has_unread: false,
    source: 'external',
    display_name: null,
    metadata: {},
    shell_pty_id: null,
    parent_session_id: null,
    ...overrides,
  };
}

describe('TreeNode', () => {
  const noop = () => {};

  it('renders session name from cwd', () => {
    render(TreeNode, {
      props: { session: makeSession(), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('project')).toBeTruthy();
  });

  it('renders display_name when set', () => {
    render(TreeNode, {
      props: { session: makeSession({ display_name: 'My Agent' }), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('renders state badge', () => {
    render(TreeNode, {
      props: { session: makeSession({ processing: true }), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('RUNNING')).toBeTruthy();
  });

  it('renders current tool', () => {
    const session = makeSession({
      current_tool: { tool_name: 'Bash', timestamp: '2026-04-01T12:00:00Z', summary: 'npm test' },
    });
    render(TreeNode, {
      props: { session, onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
  });

  it('renders action buttons', () => {
    render(TreeNode, {
      props: { session: makeSession(), onDismiss: noop, onSelect: noop, onOpenShell: noop },
    });
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --run src/lib/components/TreeNode.test.ts`
Expected: all 5 tests pass.

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/TreeNode.test.ts
git commit -m "test: add TreeNode component tests"
```
