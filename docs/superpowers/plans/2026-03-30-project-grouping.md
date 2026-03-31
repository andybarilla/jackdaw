# Project Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group sidebar sessions by `cwd` so multiple agents in the same project are visually clustered.

**Architecture:** Frontend-only. Extract a pure `buildRenderList()` function (testable with Vitest), add a `$derived` in Dashboard that calls it, create a new `ProjectGroup.svelte` component for grouped rendering. No backend or store changes.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest

---

### Task 1: Extract `getSessionState` helper and `buildRenderList` with tests

**Files:**
- Modify: `src/lib/utils.ts`
- Create: `src/lib/grouping.ts`
- Create: `src/lib/grouping.test.ts`

The card state derivation logic currently lives inline in `SessionCard.svelte`. We need it in `ProjectGroup.svelte` too (for status dots and attention labels). Extract it as a pure function.

- [ ] **Step 1: Add `getSessionState` to `src/lib/utils.ts`**

Add to the end of `src/lib/utils.ts`:

```typescript
export type SessionState = 'approval' | 'input' | 'running' | 'idle';

/** Derive the visual state of a session (same logic as SessionCard's cardState) */
export function getSessionState(session: { pending_approval: boolean; current_tool: unknown | null; active_subagents: number; processing: boolean }): SessionState {
  if (session.pending_approval) return 'approval';
  if (session.current_tool !== null || session.active_subagents > 0 || session.processing) return 'running';
  return 'input';
}
```

- [ ] **Step 2: Add tests for `getSessionState` in `src/lib/utils.test.ts`**

Add to the end of `src/lib/utils.test.ts`:

```typescript
import { getSessionState } from './utils';

describe('getSessionState', () => {
  const base = { pending_approval: false, current_tool: null, active_subagents: 0, processing: false };

  it('returns approval when pending_approval is true', () => {
    expect(getSessionState({ ...base, pending_approval: true })).toBe('approval');
  });

  it('returns running when processing', () => {
    expect(getSessionState({ ...base, processing: true })).toBe('running');
  });

  it('returns running when current_tool is set', () => {
    expect(getSessionState({ ...base, current_tool: { tool_name: 'Bash' } })).toBe('running');
  });

  it('returns running when active_subagents > 0', () => {
    expect(getSessionState({ ...base, active_subagents: 2 })).toBe('running');
  });

  it('returns input when idle', () => {
    expect(getSessionState(base)).toBe('input');
  });

  it('approval takes priority over running', () => {
    expect(getSessionState({ ...base, pending_approval: true, processing: true })).toBe('approval');
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: All `getSessionState` tests PASS.

- [ ] **Step 4: Create `src/lib/grouping.ts` with `buildRenderList`**

```typescript
import type { Session } from '$lib/types';

type GroupItem = { type: 'group'; key: string; cwd: string; sessions: Session[] };
type SessionItem = { type: 'session'; key: string; session: Session };
export type RenderItem = GroupItem | SessionItem;

/** Group sessions by cwd for sidebar rendering. Groups only formed for 2+ sessions sharing a cwd. */
export function buildRenderList(sessions: Session[]): RenderItem[] {
  const byCwd = new Map<string, Session[]>();
  for (const s of sessions) {
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

  // Sort by most recent started_at descending (groups use max of their sessions)
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

- [ ] **Step 5: Create `src/lib/grouping.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildRenderList } from './grouping';
import type { Session } from '$lib/types';

function makeSession(id: string, cwd: string, startedAt: string): Session {
  return {
    session_id: id,
    cwd,
    started_at: startedAt,
    git_branch: null,
    current_tool: null,
    tool_history: [],
    active_subagents: 0,
    pending_approval: false,
    processing: false,
    has_unread: false,
    source: 'external',
    display_name: null,
    metadata: {},
  };
}

describe('buildRenderList', () => {
  it('returns empty list for no sessions', () => {
    expect(buildRenderList([])).toEqual([]);
  });

  it('returns bare session items when all cwds are unique', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/b', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'session')).toBe(true);
  });

  it('groups sessions sharing a cwd', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    if (result[0].type === 'group') {
      expect(result[0].sessions).toHaveLength(2);
      expect(result[0].cwd).toBe('/a');
      expect(result[0].key).toBe('group:/a');
    }
  });

  it('mixes groups and singles', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T02:00:00Z'),
      makeSession('s3', '/b', '2026-03-30T03:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    expect(result).toHaveLength(2);
    // /b is newest, so it comes first
    expect(result[0].type).toBe('session');
    expect(result[1].type).toBe('group');
  });

  it('sorts by most recent started_at descending', () => {
    const sessions = [
      makeSession('s1', '/old', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/new', '2026-03-30T03:00:00Z'),
      makeSession('s3', '/old', '2026-03-30T02:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    // /new (03:00) first, then /old group (max 02:00)
    expect(result[0].type).toBe('session');
    expect(result[1].type).toBe('group');
  });

  it('groups use max started_at for sort order', () => {
    const sessions = [
      makeSession('s1', '/a', '2026-03-30T01:00:00Z'),
      makeSession('s2', '/a', '2026-03-30T05:00:00Z'),
      makeSession('s3', '/b', '2026-03-30T03:00:00Z'),
    ];
    const result = buildRenderList(sessions);
    // /a group has max 05:00, /b has 03:00 → group first
    expect(result[0].type).toBe('group');
    expect(result[1].type).toBe('session');
  });

  it('uses session_id as key for singles', () => {
    const sessions = [makeSession('s1', '/a', '2026-03-30T01:00:00Z')];
    const result = buildRenderList(sessions);
    expect(result[0].key).toBe('s1');
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: All `buildRenderList` tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts src/lib/grouping.ts src/lib/grouping.test.ts
git commit -m "feat: add buildRenderList grouping logic and getSessionState helper"
```

---

### Task 2: Create `ProjectGroup.svelte` component

**Files:**
- Create: `src/lib/components/ProjectGroup.svelte`

- [ ] **Step 1: Create `src/lib/components/ProjectGroup.svelte`**

```svelte
<script lang="ts">
  import type { Session } from '$lib/types';
  import { getProjectName } from '$lib/utils';
  import { getSessionState } from '$lib/utils';
  import type { SessionState } from '$lib/utils';
  import SessionCard from './SessionCard.svelte';

  interface Props {
    cwd: string;
    sessions: Session[];
    selectedSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onDismiss: (sessionId: string) => void;
  }

  let { cwd, sessions, selectedSessionId, onSelect, onDismiss }: Props = $props();

  let collapsed = $state(false);

  let sessionStates = $derived<SessionState[]>(sessions.map(s => getSessionState(s)));

  // Highest-priority attention state for collapsed header label
  let attentionLabel = $derived<string | null>(
    sessionStates.includes('approval') ? 'APPROVAL'
    : sessionStates.includes('input') ? 'INPUT'
    : null
  );

  function toggleCollapse() {
    collapsed = !collapsed;
  }
</script>

<div class="project-group">
  <div class="group-header" onclick={toggleCollapse} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleCollapse())}>
    <div class="header-left">
      <span class="chevron">{collapsed ? '▶' : '▼'}</span>
      <span class="project-name">{getProjectName(cwd)}</span>
      <span class="session-count">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
      {#if collapsed && attentionLabel}
        <span class="attention-label" class:approval={attentionLabel === 'APPROVAL'} class:input={attentionLabel === 'INPUT'}>{attentionLabel}</span>
      {/if}
    </div>
    <div class="header-right">
      {#each sessionStates as state}
        <span class="status-dot" style="background: var(--state-{state})"></span>
      {/each}
    </div>
  </div>

  {#if !collapsed}
    <div class="group-body">
      {#each sessions as session (session.session_id)}
        <div
          class="sidebar-session"
          class:selected={selectedSessionId === session.session_id}
          onclick={() => onSelect(session.session_id)}
          role="button"
          tabindex="0"
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(session.session_id)}
        >
          <SessionCard {session} onDismiss={onDismiss} compact />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .project-group {
    background: var(--card-bg);
    border: 1px solid var(--border);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .chevron {
    font-size: 10px;
    color: var(--text-muted);
  }

  .project-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .session-count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .attention-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .attention-label.approval {
    color: var(--state-approval);
  }

  .attention-label.input {
    color: var(--state-input);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .group-body {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-session {
    cursor: pointer;
    transition: background 0.1s;
  }

  .sidebar-session:hover {
    background: var(--tool-bg);
  }

  .sidebar-session.selected {
    background: var(--tool-bg);
    outline: 1px solid var(--border);
  }
</style>
```

- [ ] **Step 2: Verify types compile**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ProjectGroup.svelte
git commit -m "feat: add ProjectGroup component for grouped sidebar rendering"
```

---

### Task 3: Wire up grouping in Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add imports to Dashboard.svelte**

At the top of the `<script>` block, after the existing imports, add:

```typescript
import ProjectGroup from './ProjectGroup.svelte';
import { buildRenderList } from '$lib/grouping';
```

- [ ] **Step 2: Add the derived render list**

After the `selectedSession` derived declaration (line 26-28), add:

```typescript
let renderList = $derived(buildRenderList(sessionStore.sessions));
```

- [ ] **Step 3: Replace the flat session list in the active tab**

Replace the block from `{#each sessionStore.sessions as session (session.session_id)}` through its closing `{/each}` (lines 196-207) with:

```svelte
            {#each renderList as item (item.key)}
              {#if item.type === 'group'}
                <ProjectGroup
                  cwd={item.cwd}
                  sessions={item.sessions}
                  {selectedSessionId}
                  onSelect={selectSession}
                  onDismiss={handleDismiss}
                />
              {:else}
                <div
                  class="sidebar-session"
                  class:selected={selectedSessionId === item.session.session_id}
                  onclick={() => selectSession(item.session.session_id)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSession(item.session.session_id)}
                >
                  <SessionCard session={item.session} onDismiss={handleDismiss} compact />
                </div>
              {/if}
            {/each}
```

- [ ] **Step 4: Update SessionCard import in Dashboard to also use getSessionState**

No change needed — SessionCard's internal `cardState` logic is untouched. The `getSessionState` function is only used by `ProjectGroup.svelte`.

- [ ] **Step 5: Verify types compile**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: wire up project grouping in sidebar"
```

---

### Task 4: Use `getSessionState` in `SessionCard.svelte` to deduplicate

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

Now that `getSessionState` exists, deduplicate the inline card state logic in SessionCard.

- [ ] **Step 1: Import `getSessionState` in SessionCard.svelte**

Add to the imports at the top of the `<script>` block:

```typescript
import { getSessionState } from '$lib/utils';
```

- [ ] **Step 2: Replace the inline `cardState` derivation**

Replace lines 21-31 (the `type CardState` and `let cardState = $derived<CardState>(...)`) with:

```typescript
let cardState = $derived(
  historyMode
    ? (session.pending_approval
        ? 'approval'
        : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
          ? 'running'
          : 'idle')
    : getSessionState(session)
);
```

This preserves the `historyMode → idle` mapping while using the shared function for active sessions.

- [ ] **Step 3: Remove the now-unused `CardState` type alias**

The `type CardState = ...` line is no longer needed since `getSessionState` returns `SessionState`.

- [ ] **Step 4: Verify types compile and tests pass**

Run: `npm run check && npm test`
Expected: No type errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "refactor: use shared getSessionState in SessionCard"
```

---

### Task 5: Manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Start dev mode**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify single-session behavior**

With 1 active session, the sidebar should look identical to before — bare SessionCard, no group wrapper.

- [ ] **Step 3: Verify multi-session grouping**

Start 2+ Claude Code sessions in the same directory. Verify:
- They appear in a card-style group container with project name, session count, and status dots
- Clicking the header collapses/expands the group
- When collapsed, an attention label appears if any session needs APPROVAL or INPUT
- Clicking a session inside the group selects it and shows the detail view

- [ ] **Step 4: Verify keyboard navigation**

Use next/prev session shortcuts (j/k or arrow keys). Verify they cycle through all sessions regardless of group state.

- [ ] **Step 5: Run full test suite**

Run: `npm test && cd src-tauri && cargo test`
Expected: All tests PASS (no backend changes, but verify nothing broke).
