# Progress Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual progress indicators to SessionCard — a prominent progress bar for explicit progress, tool velocity stats, and a completion flash animation.

**Architecture:** Frontend-only feature. Explicit progress already works via the `set_metadata` socket API with `MetadataValue::Progress`. We add a `computeToolVelocity()` utility function (tested independently), then modify `SessionCard.svelte` to render a primary progress bar, tool velocity stats, and completion flash. Two Rust unit tests for `explicit_progress()` on `Session`. No backend serialization changes.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, Rust (unit tests only)

---

### Task 1: Rust `explicit_progress()` method

**Files:**
- Modify: `src-tauri/src/state.rs:145-232` (Session impl block)

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block at the bottom of `state.rs`:

```rust
#[test]
fn explicit_progress_returns_none_when_no_progress_metadata() {
    let s = Session::new("s1".into(), "/tmp".into());
    assert_eq!(s.explicit_progress(), None);
}

#[test]
fn explicit_progress_returns_value_when_progress_metadata_set() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.metadata.insert(
        "progress".into(),
        MetadataEntry {
            key: "progress".into(),
            value: MetadataValue::Progress(75.0),
        },
    );
    assert_eq!(s.explicit_progress(), Some(75.0));
}

#[test]
fn explicit_progress_ignores_non_progress_metadata_with_progress_key() {
    let mut s = Session::new("s1".into(), "/tmp".into());
    s.metadata.insert(
        "progress".into(),
        MetadataEntry {
            key: "progress".into(),
            value: MetadataValue::Text("75%".into()),
        },
    );
    assert_eq!(s.explicit_progress(), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test explicit_progress`
Expected: compilation error — `explicit_progress` method does not exist.

- [ ] **Step 3: Implement `explicit_progress()`**

Add to the `impl Session` block in `state.rs`, after the `is_busy()` method (after line 170):

```rust
pub fn explicit_progress(&self) -> Option<f64> {
    self.metadata.get("progress").and_then(|entry| {
        if let MetadataValue::Progress(v) = &entry.value {
            Some(*v)
        } else {
            None
        }
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test explicit_progress`
Expected: all 3 tests pass.

- [ ] **Step 5: Run full backend test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add explicit_progress() method to Session"
```

---

### Task 2: Frontend `computeToolVelocity` utility + tests

**Files:**
- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/utils.test.ts`:

```typescript
import { computeToolVelocity } from './utils';
import type { ToolEvent } from './types';

describe('computeToolVelocity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero for empty history and no current tool', () => {
    expect(computeToolVelocity([], null, '2026-03-31T11:50:00Z')).toEqual({ total: 0, rate: 0 });
  });

  it('counts current tool in total', () => {
    const current: ToolEvent = { tool_name: 'Bash', timestamp: '2026-03-31T11:59:00Z', summary: null };
    expect(computeToolVelocity([], current, '2026-03-31T11:50:00Z').total).toBe(1);
  });

  it('calculates rate from tools in last 5 minutes', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:56:00Z', summary: null },
      { tool_name: 'Read', timestamp: '2026-03-31T11:57:00Z', summary: null },
      { tool_name: 'Edit', timestamp: '2026-03-31T11:58:00Z', summary: null },
      { tool_name: 'Bash', timestamp: '2026-03-31T11:59:00Z', summary: null },
    ];
    const result = computeToolVelocity(history, null, '2026-03-31T11:50:00Z');
    expect(result.total).toBe(4);
    // 4 tools in 5 min window = 0.8/min
    expect(result.rate).toBe(0.8);
  });

  it('excludes tools older than 5 minutes from rate', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:50:00Z', summary: null }, // older than 5 min
      { tool_name: 'Read', timestamp: '2026-03-31T11:58:00Z', summary: null },
    ];
    const result = computeToolVelocity(history, null, '2026-03-31T11:50:00Z');
    expect(result.total).toBe(2);
    // 1 tool in 5 min window = 0.2/min
    expect(result.rate).toBe(0.2);
  });

  it('uses session start time for rate window when session started less than 5 minutes ago', () => {
    const history: ToolEvent[] = [
      { tool_name: 'Bash', timestamp: '2026-03-31T11:58:00Z', summary: null },
      { tool_name: 'Read', timestamp: '2026-03-31T11:59:00Z', summary: null },
    ];
    // Session started 2 min ago
    const result = computeToolVelocity(history, null, '2026-03-31T11:58:00Z');
    expect(result.total).toBe(2);
    // 2 tools in 2 min = 1.0/min
    expect(result.rate).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/lib/utils.test.ts`
Expected: compilation error — `computeToolVelocity` is not exported from `./utils`.

- [ ] **Step 3: Implement `computeToolVelocity`**

Add to the end of `src/lib/utils.ts`:

```typescript
import type { ToolEvent } from './types';

/** Compute tool count and recent rate (tools/min over last 5 minutes) */
export function computeToolVelocity(
  toolHistory: ToolEvent[],
  currentTool: ToolEvent | null,
  startedAt: string
): { total: number; rate: number } {
  const total = toolHistory.length + (currentTool ? 1 : 0);
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const recentCount = toolHistory.filter(
    (t) => new Date(t.timestamp).getTime() > fiveMinAgo
  ).length;
  const startTime = new Date(startedAt).getTime();
  const windowMinutes =
    startTime > fiveMinAgo ? (now - startTime) / 60000 : 5;
  const rate =
    windowMinutes > 0
      ? Math.round((recentCount / windowMinutes) * 10) / 10
      : 0;
  return { total, rate };
}
```

Note: The import for `ToolEvent` must go at the top of the file. Move it to the imports section.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/lib/utils.test.ts`
Expected: all tests pass including the new `computeToolVelocity` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: add computeToolVelocity utility"
```

---

### Task 3: SessionCard progress bar and tool velocity display

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add imports and derived state**

In the `<script>` block of `SessionCard.svelte`, add the import (at the top with other imports):

```typescript
import { computeToolVelocity } from '$lib/utils';
```

Note: `getUptime` etc. are already imported from `$lib/utils`, so just add `computeToolVelocity` to that existing import.

Add these derived values after the existing `let metadataEntries` line (after line 42):

```typescript
let explicitProgress = $derived(
  session.metadata['progress']?.value.type === 'progress'
    ? session.metadata['progress'].value.content
    : null
);

let toolVelocity = $derived(
  computeToolVelocity(session.tool_history, session.current_tool, session.started_at)
);
```

- [ ] **Step 2: Add progress bar to template**

Insert after the git branch section (after line 92, the closing `{/if}` of the git_branch block) and before the tool row:

```svelte
{#if explicitProgress !== null}
  <div class="card-progress">
    <div
      class="card-progress-fill"
      style="width: {Math.min(100, Math.max(0, explicitProgress))}%; background: var(--accent-color)"
    ></div>
  </div>
{/if}
```

- [ ] **Step 3: Add tool velocity to header**

In the `.row-right` div (around line 74), add the tool velocity display before the uptime span:

```svelte
{#if isActive && toolVelocity.total > 0}
  <span class="tool-velocity">{toolVelocity.total} tools · {toolVelocity.rate}/min</span>
{/if}
```

The `.row-right` section should look like:

```svelte
<div class="row-right">
  {#if isActive && toolVelocity.total > 0}
    <span class="tool-velocity">{toolVelocity.total} tools · {toolVelocity.rate}/min</span>
  {/if}
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

- [ ] **Step 4: Add CSS styles**

Add to the `<style>` block:

```css
.card-progress {
  height: 2px;
  background: var(--border);
  width: 100%;
}

.card-progress-fill {
  height: 100%;
  border-radius: 1px;
  transition: width 0.5s ease;
}

.tool-velocity {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add progress bar and tool velocity to SessionCard"
```

---

### Task 4: Completion flash animation

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add completion flash state**

In the `<script>` block of `SessionCard.svelte`, add after the `toolVelocity` derived value:

```typescript
let prevProcessing = $state(session.processing);
let showCompletion = $state(false);

$effect(() => {
  if (prevProcessing && !session.processing) {
    showCompletion = true;
    const timer = setTimeout(() => (showCompletion = false), 2000);
    return () => clearTimeout(timer);
  }
  prevProcessing = session.processing;
});
```

- [ ] **Step 2: Apply flash class to card**

Modify the outer `.card` div to include the completion flash class. Change:

```svelte
<div
  class="card"
  class:expanded
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
>
```

To:

```svelte
<div
  class="card"
  class:expanded
  class:completion-flash={showCompletion}
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
>
```

- [ ] **Step 3: Add flash animation CSS**

Add to the `<style>` block:

```css
.card.completion-flash {
  animation: flash-complete 2s ease-out;
}

@keyframes flash-complete {
  0% { border-left-color: var(--success); }
  100% { border-left-color: var(--accent-color); }
}
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add completion flash animation to SessionCard"
```

---

### Task 5: Suppress duplicate progress bar in MetadataDisplay

When explicit progress is set with key `"progress"`, it now renders prominently on the card. The same entry also renders inside `MetadataDisplay`. Filter it out to avoid duplication.

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Filter progress from metadata entries**

Change the existing `metadataEntries` derived value from:

```typescript
let metadataEntries = $derived(Object.values(session.metadata));
```

To:

```typescript
let metadataEntries = $derived(
  Object.values(session.metadata).filter(
    (e) => !(e.key === 'progress' && e.value.type === 'progress')
  )
);
```

This removes the `"progress"` entry from the metadata section since it's now shown as the primary progress bar.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Run full test suite**

Run: `npm test -- --run && cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: deduplicate progress display in SessionCard"
```
