# Keyboard Shortcuts Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable keyboard shortcuts with a settings UI for rebinding, stored in Tauri Store.

**Architecture:** `shortcuts.ts` becomes stateful — module-level `activeBindings` array initialized to defaults, replaced when user bindings load from Tauri Store. New `ShortcutSettings.svelte` component handles recording mode and conflict resolution. Settings.svelte integrates it. No backend changes.

**Tech Stack:** Svelte 5, TypeScript, Vitest, @tauri-apps/plugin-store

---

### Task 1: Make shortcuts.ts Stateful with Configurable Bindings

**Files:**
- Modify: `src/lib/shortcuts.ts`
- Modify: `src/lib/shortcuts.test.ts`

- [ ] **Step 1: Write failing tests for new exports**

Add to `src/lib/shortcuts.test.ts`:

```typescript
import {
  matchShortcut,
  getBindings,
  getDefaultBindings,
  setBindings,
  formatBinding,
  type KeyEvent,
  type ShortcutBinding,
} from './shortcuts';

// ... existing tests stay unchanged ...

describe('getDefaultBindings', () => {
  it('returns 8 default bindings', () => {
    const defaults = getDefaultBindings();
    expect(defaults).toHaveLength(8);
  });

  it('includes all actions', () => {
    const actions = getDefaultBindings().map((b) => b.action);
    expect(actions).toContain('next-session');
    expect(actions).toContain('prev-session');
    expect(actions).toContain('new-session');
    expect(actions).toContain('dismiss-session');
    expect(actions).toContain('tab-active');
    expect(actions).toContain('tab-history');
    expect(actions).toContain('tab-settings');
    expect(actions).toContain('close-modal');
  });

  it('close-modal defaults to Escape with no modifiers', () => {
    const escape = getDefaultBindings().find((b) => b.action === 'close-modal');
    expect(escape).toEqual({
      action: 'close-modal',
      key: 'Escape',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });
});

describe('getBindings', () => {
  it('returns defaults before any setBindings call', () => {
    const bindings = getBindings();
    expect(bindings).toEqual(getDefaultBindings());
  });
});

describe('setBindings', () => {
  afterEach(() => {
    // Reset to defaults after each test
    setBindings(getDefaultBindings());
  });

  it('updates active bindings used by matchShortcut', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'L', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('L', { alt: true }))).toBe('next-session');
    expect(matchShortcut(key('J', { ctrl: true, shift: true }))).toBeNull();
  });

  it('getBindings reflects the change', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'dismiss-session' ? { ...b, key: 'X', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    setBindings(custom);
    const found = getBindings().find((b) => b.action === 'dismiss-session');
    expect(found?.key).toBe('X');
  });
});

describe('formatBinding', () => {
  it('formats Ctrl+Shift+J', () => {
    expect(formatBinding({ action: 'next-session', key: 'J', ctrl: true, shift: true, alt: false, meta: false })).toBe(
      'Ctrl+Shift+J',
    );
  });

  it('formats Escape with no modifiers', () => {
    expect(
      formatBinding({ action: 'close-modal', key: 'Escape', ctrl: false, shift: false, alt: false, meta: false }),
    ).toBe('Escape');
  });

  it('formats Alt+K', () => {
    expect(
      formatBinding({ action: 'next-session', key: 'K', ctrl: false, shift: false, alt: true, meta: false }),
    ).toBe('Alt+K');
  });

  it('formats Meta+Ctrl+A', () => {
    expect(
      formatBinding({ action: 'next-session', key: 'A', ctrl: true, shift: false, alt: false, meta: true }),
    ).toBe('Ctrl+Meta+A');
  });

  it('formats all modifiers', () => {
    expect(formatBinding({ action: 'next-session', key: 'Z', ctrl: true, shift: true, alt: true, meta: true })).toBe(
      'Ctrl+Shift+Alt+Meta+Z',
    );
  });
});

describe('matchShortcut with alt/meta modifiers', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('matches Alt binding', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'N', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('N', { alt: true }))).toBe('next-session');
  });

  it('does not match when extra modifier pressed', () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'N', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    setBindings(custom);
    expect(matchShortcut(key('N', { alt: true, ctrl: true }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/lib/shortcuts.test.ts`
Expected: FAIL — `getBindings`, `getDefaultBindings`, `setBindings`, `formatBinding` not exported

- [ ] **Step 3: Implement the stateful shortcuts module**

Replace `src/lib/shortcuts.ts` with:

```typescript
export type ShortcutAction =
  | 'next-session'
  | 'prev-session'
  | 'new-session'
  | 'dismiss-session'
  | 'tab-active'
  | 'tab-history'
  | 'tab-settings'
  | 'close-modal';

export interface ShortcutBinding {
  action: ShortcutAction;
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DEFAULT_BINDINGS: ShortcutBinding[] = [
  { action: 'next-session', key: 'J', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'prev-session', key: 'K', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'new-session', key: 'N', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'dismiss-session', key: 'D', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-active', key: '!', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-history', key: '@', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'tab-settings', key: '#', ctrl: true, shift: true, alt: false, meta: false },
  { action: 'close-modal', key: 'Escape', ctrl: false, shift: false, alt: false, meta: false },
];

let activeBindings: ShortcutBinding[] = [...DEFAULT_BINDINGS];

export function getDefaultBindings(): ShortcutBinding[] {
  return DEFAULT_BINDINGS.map((b) => ({ ...b }));
}

export function getBindings(): ShortcutBinding[] {
  return activeBindings.map((b) => ({ ...b }));
}

export function setBindings(bindings: ShortcutBinding[]): void {
  activeBindings = bindings.map((b) => ({ ...b }));
}

export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  if (binding.meta) parts.push('Meta');
  parts.push(binding.key);
  return parts.join('+');
}

export function matchShortcut(event: KeyEvent): ShortcutAction | null {
  for (const binding of activeBindings) {
    if (
      event.key === binding.key &&
      event.ctrlKey === binding.ctrl &&
      event.shiftKey === binding.shift &&
      event.altKey === binding.alt &&
      event.metaKey === binding.meta
    ) {
      return binding.action;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/lib/shortcuts.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortcuts.ts src/lib/shortcuts.test.ts
git commit -m "feat: make shortcuts module stateful with configurable bindings"
```

---

### Task 2: Store Integration (loadBindings / saveBindings)

**Files:**
- Modify: `src/lib/shortcuts.ts`
- Modify: `src/lib/shortcuts.test.ts`

- [ ] **Step 1: Write failing tests for loadBindings and saveBindings**

Add to `src/lib/shortcuts.test.ts`:

```typescript
import {
  matchShortcut,
  getBindings,
  getDefaultBindings,
  setBindings,
  formatBinding,
  loadBindings,
  saveBindings,
  type KeyEvent,
  type ShortcutBinding,
} from './shortcuts';

// ... after existing describe blocks ...

describe('loadBindings', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('loads bindings from store', async () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'Q', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    const mockStore = {
      get: vi.fn().mockResolvedValue(custom),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(mockStore.get).toHaveBeenCalledWith('shortcuts');
    const found = getBindings().find((b) => b.action === 'next-session');
    expect(found?.key).toBe('Q');
  });

  it('keeps defaults when store returns null', async () => {
    const mockStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(getBindings()).toEqual(getDefaultBindings());
  });

  it('keeps defaults when store returns empty array', async () => {
    const mockStore = {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      save: vi.fn(),
    };
    await loadBindings(mockStore as any);
    expect(getBindings()).toEqual(getDefaultBindings());
  });
});

describe('saveBindings', () => {
  afterEach(() => {
    setBindings(getDefaultBindings());
  });

  it('writes bindings to store and updates active bindings', async () => {
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'dismiss-session' ? { ...b, key: 'W', ctrl: false, shift: false, alt: true, meta: false } : b,
    );
    const mockStore = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    };
    await saveBindings(mockStore as any, custom);
    expect(mockStore.set).toHaveBeenCalledWith('shortcuts', custom);
    expect(mockStore.save).toHaveBeenCalled();
    const found = getBindings().find((b) => b.action === 'dismiss-session');
    expect(found?.key).toBe('W');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/lib/shortcuts.test.ts`
Expected: FAIL — `loadBindings` and `saveBindings` not exported

- [ ] **Step 3: Implement loadBindings and saveBindings**

Add to `src/lib/shortcuts.ts`, after `setBindings`:

```typescript
interface ShortcutStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): void;
  save(): Promise<void>;
}

export async function loadBindings(store: ShortcutStore): Promise<void> {
  const saved = await store.get<ShortcutBinding[]>('shortcuts');
  if (saved && saved.length > 0) {
    activeBindings = saved.map((b) => ({ ...b }));
  }
}

export async function saveBindings(store: ShortcutStore, bindings: ShortcutBinding[]): Promise<void> {
  activeBindings = bindings.map((b) => ({ ...b }));
  store.set('shortcuts', bindings);
  await store.save();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/lib/shortcuts.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortcuts.ts src/lib/shortcuts.test.ts
git commit -m "feat: add loadBindings and saveBindings for store persistence"
```

---

### Task 3: ShortcutSettings Component

**Files:**
- Create: `src/lib/components/ShortcutSettings.svelte`
- Create: `src/tests/ShortcutSettings.test.ts`

- [ ] **Step 1: Write failing tests for ShortcutSettings**

Create `src/tests/ShortcutSettings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ShortcutSettings from '$lib/components/ShortcutSettings.svelte';
import { setBindings, getDefaultBindings, type ShortcutBinding } from '$lib/shortcuts';

describe('ShortcutSettings', () => {
  beforeEach(() => {
    setBindings(getDefaultBindings());
  });

  it('renders all 8 shortcut actions', () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    expect(getByText('Next Session')).toBeTruthy();
    expect(getByText('Previous Session')).toBeTruthy();
    expect(getByText('New Session')).toBeTruthy();
    expect(getByText('Dismiss Session')).toBeTruthy();
    expect(getByText('Active Tab')).toBeTruthy();
    expect(getByText('History Tab')).toBeTruthy();
    expect(getByText('Settings Tab')).toBeTruthy();
    expect(getByText('Close Modal')).toBeTruthy();
  });

  it('displays current key bindings', () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
    expect(getByText('Escape')).toBeTruthy();
  });

  it('enters recording mode on binding click', async () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    await fireEvent.click(getByText('Ctrl+Shift+J'));
    expect(getByText('Press keys...')).toBeTruthy();
  });

  it('cancels recording without changing binding', async () => {
    const { getByText } = render(ShortcutSettings, {
      props: { onSave: vi.fn() },
    });
    await fireEvent.click(getByText('Ctrl+Shift+J'));
    await fireEvent.click(getByText('Cancel'));
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
  });

  it('resets all bindings to defaults', async () => {
    const onSave = vi.fn();
    const custom: ShortcutBinding[] = getDefaultBindings().map((b) =>
      b.action === 'next-session' ? { ...b, key: 'Q', ctrl: true, shift: false, alt: false, meta: false } : b,
    );
    setBindings(custom);
    const { getByText } = render(ShortcutSettings, {
      props: { onSave },
    });
    expect(getByText('Ctrl+Q')).toBeTruthy();
    await fireEvent.click(getByText('Reset to Defaults'));
    expect(getByText('Ctrl+Shift+J')).toBeTruthy();
    expect(onSave).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/tests/ShortcutSettings.test.ts`
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Implement ShortcutSettings component**

Create `src/lib/components/ShortcutSettings.svelte`:

```svelte
<script lang="ts">
  import {
    getBindings,
    getDefaultBindings,
    setBindings,
    formatBinding,
    type ShortcutBinding,
    type ShortcutAction,
  } from '$lib/shortcuts';

  let { onSave }: { onSave: (bindings: ShortcutBinding[]) => void } = $props();

  let bindings = $state<ShortcutBinding[]>(getBindings());
  let recordingAction = $state<ShortcutAction | null>(null);

  const ACTION_LABELS: Record<ShortcutAction, string> = {
    'next-session': 'Next Session',
    'prev-session': 'Previous Session',
    'new-session': 'New Session',
    'dismiss-session': 'Dismiss Session',
    'tab-active': 'Active Tab',
    'tab-history': 'History Tab',
    'tab-settings': 'Settings Tab',
    'close-modal': 'Close Modal',
  };

  function startRecording(action: ShortcutAction) {
    recordingAction = action;
  }

  function cancelRecording() {
    recordingAction = null;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!recordingAction) return;
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;

    event.preventDefault();
    event.stopPropagation();

    const newBinding: ShortcutBinding = {
      action: recordingAction,
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    };

    // Remove conflict: unbind any other action using this combo
    const updated = bindings.map((b) => {
      if (b.action === recordingAction) {
        return newBinding;
      }
      if (
        b.key === newBinding.key &&
        b.ctrl === newBinding.ctrl &&
        b.shift === newBinding.shift &&
        b.alt === newBinding.alt &&
        b.meta === newBinding.meta
      ) {
        return { ...b, key: '', ctrl: false, shift: false, alt: false, meta: false };
      }
      return b;
    });

    bindings = updated;
    setBindings(updated);
    onSave(updated);
    recordingAction = null;
  }

  function resetToDefaults() {
    const defaults = getDefaultBindings();
    bindings = defaults;
    setBindings(defaults);
    onSave(defaults);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="shortcut-settings">
  {#each bindings as binding}
    <div class="shortcut-row">
      <span class="shortcut-label">{ACTION_LABELS[binding.action]}</span>
      {#if recordingAction === binding.action}
        <span class="shortcut-recording">Press keys...</span>
        <button class="shortcut-cancel" onclick={cancelRecording}>Cancel</button>
      {:else}
        <button class="shortcut-key" onclick={() => startRecording(binding.action)}>
          {binding.key ? formatBinding(binding) : 'Unbound'}
        </button>
      {/if}
    </div>
  {/each}
  <button class="reset-btn" onclick={resetToDefaults}>Reset to Defaults</button>
</div>

<style>
  .shortcut-settings {
    padding: 0 0 8px 0;
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
  }

  .shortcut-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .shortcut-key {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
  }

  .shortcut-key:hover {
    border-color: var(--active);
  }

  .shortcut-recording {
    font-size: 12px;
    color: var(--active);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .shortcut-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    margin-left: 6px;
  }

  .reset-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    margin-top: 8px;
  }

  .reset-btn:hover {
    border-color: var(--text-muted);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/tests/ShortcutSettings.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ShortcutSettings.svelte src/tests/ShortcutSettings.test.ts
git commit -m "feat: add ShortcutSettings component with recording and reset"
```

---

### Task 4: Integrate ShortcutSettings into Settings.svelte

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Add imports and state to Settings.svelte**

In `src/lib/components/Settings.svelte`, add to the imports at the top of the `<script>` block (after the `ProfileEditor` import, line 8):

```typescript
  import ShortcutSettings from './ShortcutSettings.svelte';
  import { loadBindings, saveBindings, type ShortcutBinding } from '$lib/shortcuts';
```

- [ ] **Step 2: Load shortcuts in onMount**

In the `onMount` callback (after `profiles = await invoke<MonitoringProfile[]>('get_profiles');` on line 84), add:

```typescript
    await loadBindings(store);
```

- [ ] **Step 3: Add save handler function**

After the `deleteProfile` function (line 147), add:

```typescript
  async function saveShortcuts(bindings: ShortcutBinding[]) {
    if (store) {
      await saveBindings(store, bindings);
    }
  }
```

- [ ] **Step 4: Add Keyboard Shortcuts section to template**

In the template, after the `<button class="add-profile-btn">` (line 172) and before `<h3 class="settings-title">Alerts</h3>` (line 173), add:

```svelte
  <h3 class="settings-title">Keyboard Shortcuts</h3>
  <ShortcutSettings onSave={saveShortcuts} />
```

- [ ] **Step 5: Run type check and all tests**

Run: `npm run check && npm test`
Expected: All PASS, 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: integrate keyboard shortcuts section into Settings"
```

---

### Task 5: Update Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Add Keyboard Shortcuts Settings to Completed**

In `docs/ROADMAP.md`, add to the top of the "Completed" list (after `## Completed`):

```markdown
- **Keyboard Shortcuts Settings** — rebindable keyboard shortcuts with recording UI and persistence
```

If the High Priority section is empty, remove it.

- [ ] **Step 2: Run full verification**

Run: `npm run check && npm test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Keyboard Shortcuts Settings complete on roadmap"
```
