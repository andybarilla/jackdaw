# Compact Session Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace always-expanded session cards with compact rows that auto-show active tools and expand on click for history.

**Architecture:** Rework `SessionCard.svelte` into three layers: compact header row (always visible), stable tool row (visible when active), expandable detail section (click to toggle). Add `getProjectName` utility. Reduce dashboard gap.

**Tech Stack:** Svelte 5 (runes, `transition:slide`), Vitest, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-20-compact-session-cards-design.md`

---

### Task 1: Add `getProjectName` utility

The compact header needs just the last directory segment (e.g., "api-server" from "/home/andy/projects/api-server").

**Files:**
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/lib/utils.test.ts`:

```typescript
import { getUptime, shortenPath, shortenSessionId, getProjectName } from './utils';

// ... existing tests ...

describe('getProjectName', () => {
  it('returns last path segment', () => {
    expect(getProjectName('/home/andy/projects/api-server')).toBe('api-server');
  });

  it('handles trailing slash', () => {
    expect(getProjectName('/home/andy/projects/foo/')).toBe('foo');
  });

  it('returns root for root path', () => {
    expect(getProjectName('/')).toBe('/');
  });

  it('handles Windows-style paths', () => {
    expect(getProjectName('C:\\Users\\andy\\projects\\api-server')).toBe('api-server');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getProjectName` is not exported from `./utils`

- [ ] **Step 3: Implement `getProjectName`**

Add to `src/lib/utils.ts`:

```typescript
/** Extract last directory segment from a path (handles both Unix and Windows separators) */
export function getProjectName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '.') return '/';
  return trimmed.split(/[/\\]/).pop()!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS (16 existing + 4 new = 20)

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: add getProjectName utility"
```

---

### Task 2: Rewrite `SessionCard.svelte` — compact header row

Replace the current card layout with the compact header row. This task builds the collapsed-only view (no tool row or expanded section yet).

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Replace the `<script>` block**

Replace the entire `<script>` in `SessionCard.svelte` with:

```typescript
import type { Session } from '$lib/types';
import { getUptime, getProjectName, shortenSessionId } from '$lib/utils';
import { slide } from 'svelte/transition';

interface Props {
  session: Session;
  onDismiss: (sessionId: string) => void;
}

let { session, onDismiss }: Props = $props();

let expanded = $state(false);
let isPending = $derived(session.pending_approval);
let isActive = $derived(!isPending && (session.current_tool !== null || session.active_subagents > 0 || session.processing));
let uptime = $derived(getUptime(session.started_at));
let recentHistory = $derived(session.tool_history.slice(-5).reverse());

// Last completed tool for dimmed state between rapid tool calls
let lastTool = $derived(session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null);

function toggleExpand() {
  expanded = !expanded;
}
```

- [ ] **Step 2: Replace the template with compact header row only**

Replace the entire template (everything between `</script>` and `<style>`) with:

```svelte
<div class="card" class:expanded>
  <!-- Header row: always visible, clickable -->
  <div class="row-header" onclick={toggleExpand} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggleExpand()}>
    <div class="row-left">
      <span class="status-dot" class:running={isActive} class:pending={isPending}></span>
      <span class="project-name">{getProjectName(session.cwd)}</span>
      {#if !isActive && !isPending}
        <span class="idle-text">idle</span>
      {/if}
      {#if session.active_subagents > 0}
        <span class="subagent-count">· {session.active_subagents} agent{session.active_subagents === 1 ? '' : 's'}</span>
      {/if}
    </div>
    <div class="row-right">
      <span class="uptime">{uptime}</span>
      <span class="chevron">{expanded ? '▼' : '▶'}</span>
    </div>
  </div>

  <!-- Tool row: visible when active -->
  {#if isActive}
    <div class="tool-row">
      {#if session.current_tool}
        <div class="tool-display active">
          <span class="tool-icon">▶</span>
          <span class="tool-name">{session.current_tool.tool_name}</span>
          {#if session.current_tool.summary}
            <span class="tool-summary">{session.current_tool.summary}</span>
          {/if}
        </div>
      {:else if lastTool}
        <div class="tool-display dimmed">
          <span class="tool-icon">✓</span>
          <span class="tool-name">{lastTool.tool_name}</span>
          {#if lastTool.summary}
            <span class="tool-summary">{lastTool.summary}</span>
          {/if}
        </div>
      {:else}
        <div class="tool-display dimmed">
          <span class="tool-summary">processing...</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Expanded section: toggle on click -->
  {#if expanded}
    <div class="expanded-section" transition:slide={{ duration: 150 }}>
      <div class="expanded-header">
        <span class="session-id">Session {shortenSessionId(session.session_id)}</span>
        <button class="dismiss" onclick={() => onDismiss(session.session_id)}>Dismiss</button>
      </div>
      {#if recentHistory.length > 0}
        <div class="history">
          {#each recentHistory as tool}
            <div class="history-item">
              <span class="done-mark">✓</span>
              <span class="history-tool-name">{tool.tool_name}</span>
              {#if tool.summary}
                <span class="history-summary">{tool.summary}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Replace styles**

Replace the entire `<style>` block with:

```css
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.card.expanded {
  border-color: var(--blue);
}

.row-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}

.row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--yellow);
  flex-shrink: 0;
}

.status-dot.pending {
  background: var(--blue);
  animation: pulse 2s infinite;
}

.status-dot.running {
  background: var(--green);
  animation: pulse 2s infinite;
}

.project-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}

.idle-text {
  font-size: 11px;
  color: var(--text-muted);
}

.subagent-count {
  font-size: 11px;
  color: var(--blue);
}

.uptime {
  font-size: 11px;
  color: var(--text-muted);
}

.chevron {
  font-size: 10px;
  color: var(--text-muted);
}

/* Tool row */
.tool-row {
  padding: 0 14px 10px;
}

.tool-display {
  background: var(--tool-bg);
  border: 1px solid var(--tool-border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.tool-display.dimmed {
  background: var(--card-bg);
  border-color: var(--border);
  opacity: 0.5;
}

.tool-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.tool-display.active .tool-icon,
.tool-display.active .tool-name {
  color: var(--blue);
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.tool-summary {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-display.dimmed .tool-name,
.tool-display.dimmed .tool-icon {
  color: var(--text-muted);
}

.tool-display.dimmed .tool-summary {
  color: var(--text-muted);
}

/* Expanded section */
.expanded-section {
  border-top: 1px solid var(--border);
  margin: 0 14px;
  padding: 10px 0 12px;
}

.expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.session-id {
  font-size: 11px;
  color: var(--text-muted);
}

.dismiss {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.dismiss:hover {
  background: var(--border);
  color: var(--text-primary);
}

.history {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.8;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.done-mark {
  color: var(--text-muted);
}

.history-tool-name {
  color: var(--text-secondary);
}

.history-summary {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

- [ ] **Step 4: Run type checking**

Run: `npm run check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: rewrite SessionCard with compact/expand layout"
```

---

### Task 3: Reduce Dashboard gap

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Change gap from 12px to 6px**

In `Dashboard.svelte`, change the `.session-list` gap:

```css
/* old */
gap: 12px;

/* new */
gap: 6px;
```

- [ ] **Step 2: Run type checking**

Run: `npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: reduce session list gap for compact cards"
```

---

### Task 4: Add regression tests for pending+active edge cases

The `isActive` derivation in `SessionCard` mirrors `runningCount` logic. Add regression tests covering pending sessions that also have active tools/subagents — these should NOT count as running. These tests pass immediately against existing store logic.

**Files:**
- Modify: `src/lib/stores/sessions.test.ts`

- [ ] **Step 1: Add edge case tests**

Add to `sessions.test.ts` inside the existing `describe('SessionStore')`:

```typescript
it('runningCount excludes pending sessions with current_tool', () => {
  sessionStore.sessions = [
    makeSession({ pending_approval: true, current_tool: { tool_name: 'Bash', timestamp: '', summary: null } }),
  ];
  expect(sessionStore.runningCount).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS (20 existing + 1 new = 21)

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/sessions.test.ts
git commit -m "test: add pending+active edge case test for session store"
```

---

### Task 5: Visual verification

- [ ] **Step 1: Start dev server and verify**

Run: `npm run tauri dev`

Verify:
1. Sessions appear as compact rows with status dot, project name, uptime, chevron
2. Active sessions show the tool row below the header
3. Idle/waiting sessions are single compact rows
4. Clicking a row expands to show history and dismiss button
5. Clicking again collapses
6. Rapid tool completions show dimmed last-tool instead of flickering
7. Pending-approval sessions show blue dot, no tool row

- [ ] **Step 2: Run all checks**

```bash
npm test && npm run check
```

Expected: All tests pass, no type errors

- [ ] **Step 3: Commit any fixes if needed**
