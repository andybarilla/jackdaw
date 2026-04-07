# Terminal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate xterm.js SearchAddon so users can find text in terminal output via Ctrl+F.

**Architecture:** SearchAddon is loaded per terminal instance. A `SearchBar` Svelte component renders a floating bar at the top of each terminal wrapper. App-level keybinding dispatches open/close to the active terminal via a bound method reference. Search state (query, options) lives in the SearchBar component; no backend changes needed.

**Tech Stack:** `@xterm/addon-search` ^0.15, Svelte 5, existing keybinding system

---

### Task 1: Install SearchAddon dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd frontend && npm install @xterm/addon-search
```

- [ ] **Step 2: Verify installation**

```bash
cd frontend && npm ls @xterm/addon-search
```

Expected: Shows `@xterm/addon-search@0.15.x` (or similar v0.15+)

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(search): add @xterm/addon-search dependency"
```

---

### Task 2: Add `terminal.search` keybinding

**Files:**
- Modify: `frontend/src/lib/keybindings.ts`
- Modify: `frontend/src/lib/keybindings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/keybindings.test.ts`:

```typescript
it("has a binding for terminal.search", () => {
  const actions = Object.keys(DEFAULT_KEYMAP) as Action[];
  expect(actions).toContain("terminal.search");
});
```

And add a match test in the `matchKeybinding` describe block:

```typescript
it("matches Ctrl+F to terminal.search", () => {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
  });
  expect(matchKeybinding(event, DEFAULT_KEYMAP)).toBe("terminal.search");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/keybindings.test.ts
```

Expected: 2 FAIL — `terminal.search` not in Action type or DEFAULT_KEYMAP.

- [ ] **Step 3: Add the action and binding**

In `frontend/src/lib/keybindings.ts`, add `"terminal.search"` to the `Action` union:

```typescript
export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "app.toggleSidebar"
  | "terminal.search";
```

Add to `DEFAULT_KEYMAP`:

```typescript
export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+W",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
  "terminal.search": "Ctrl+f",
};
```

Note: `Ctrl+f` (lowercase f, no Shift) so it matches the browser-standard Ctrl+F.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/lib/keybindings.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/keybindings.ts frontend/src/lib/keybindings.test.ts
git commit -m "feat(search): add terminal.search keybinding (Ctrl+F)"
```

---

### Task 3: Load SearchAddon in Terminal component

**Files:**
- Modify: `frontend/src/lib/Terminal.svelte`

This task adds the SearchAddon to each terminal and exposes `openSearch`/`closeSearch` methods that will be called from the search bar (Task 4). No UI yet — just wiring.

- [ ] **Step 1: Import and load the addon**

In `frontend/src/lib/Terminal.svelte`, add the import:

```typescript
import { SearchAddon } from "@xterm/addon-search";
```

Add a module-level variable alongside the existing ones:

```typescript
let searchAddon: SearchAddon;
```

In `onMount`, after `terminal.loadAddon(new WebLinksAddon())` (line 41), add:

```typescript
searchAddon = new SearchAddon();
terminal.loadAddon(searchAddon);
```

- [ ] **Step 2: Expose search methods via props callback**

The Terminal component needs to hand its search methods up to the parent. Add an `onReady` callback prop:

Update the Props interface:

```typescript
interface Props {
  sessionId: string;
  visible?: boolean;
  onReady?: (api: TerminalApi) => void;
}

interface TerminalApi {
  searchAddon: SearchAddon;
  focus: () => void;
}
```

Destructure the new prop:

```typescript
let { sessionId, visible = true, onReady }: Props = $props();
```

At the end of `onMount` (after `AttachSession`), call it:

```typescript
onReady?.({ searchAddon, focus: () => terminal.focus() });
```

- [ ] **Step 3: Export the TerminalApi type**

Add at the top of the `<script>` block, after imports, a re-export so App.svelte can use the type:

Actually, since Svelte components can't export types from script blocks easily, create a small types addition. Add `TerminalApi` to `frontend/src/lib/types.ts`:

```typescript
import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalApi {
  searchAddon: SearchAddon;
  focus: () => void;
}
```

Then in `Terminal.svelte`, import it:

```typescript
import type { TerminalApi } from "./types";
```

And remove the local `TerminalApi` interface definition (keep only the `Props` update).

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npm run check
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/Terminal.svelte frontend/src/lib/types.ts
git commit -m "feat(search): load SearchAddon, expose TerminalApi"
```

---

### Task 4: Create SearchBar component

**Files:**
- Create: `frontend/src/lib/SearchBar.svelte`

A floating search bar that appears at the top-right of the terminal area. It receives a `SearchAddon` instance and drives `findNext`/`findPrevious` on it.

- [ ] **Step 1: Create the component**

Create `frontend/src/lib/SearchBar.svelte`:

```svelte
<script lang="ts">
  import type { SearchAddon } from "@xterm/addon-search";
  import { getTheme } from "./config.svelte";

  interface Props {
    searchAddon: SearchAddon;
    onClose: () => void;
  }

  let { searchAddon, onClose }: Props = $props();
  let query = $state("");
  let caseSensitive = $state(false);
  let regex = $state(false);
  let wholeWord = $state(false);
  let resultIndex = $state(-1);
  let resultCount = $state(0);
  let inputEl: HTMLInputElement;

  let cleanup: { dispose: () => void } | undefined;

  $effect(() => {
    cleanup = searchAddon.onDidChangeResults((e) => {
      resultIndex = e.resultIndex;
      resultCount = e.resultCount;
    });
    return () => cleanup?.dispose();
  });

  $effect(() => {
    // Re-run search when options change
    if (query) {
      searchAddon.findNext(query, { caseSensitive, regex, wholeWord, incremental: true });
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        searchAddon.findPrevious(query, { caseSensitive, regex, wholeWord });
      } else {
        searchAddon.findNext(query, { caseSensitive, regex, wholeWord });
      }
    }
  }

  function close(): void {
    searchAddon.clearDecorations();
    onClose();
  }

  export function focusInput(): void {
    inputEl?.focus();
    inputEl?.select();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-bar" onkeydown={handleKeydown}>
  <input
    bind:this={inputEl}
    bind:value={query}
    type="text"
    placeholder="Search…"
    spellcheck="false"
    autocomplete="off"
  />
  <span class="result-count">
    {#if query && resultCount > 0}
      {resultIndex + 1}/{resultCount}
    {:else if query}
      0 results
    {/if}
  </span>
  <button
    class="option-toggle"
    class:active={caseSensitive}
    onclick={() => (caseSensitive = !caseSensitive)}
    title="Case sensitive"
  >Aa</button>
  <button
    class="option-toggle"
    class:active={wholeWord}
    onclick={() => (wholeWord = !wholeWord)}
    title="Whole word"
  >W</button>
  <button
    class="option-toggle"
    class:active={regex}
    onclick={() => (regex = !regex)}
    title="Regex"
  >.*</button>
  <button class="nav-btn" onclick={() => searchAddon.findPrevious(query, { caseSensitive, regex, wholeWord })} title="Previous (Shift+Enter)">&#x25B2;</button>
  <button class="nav-btn" onclick={() => searchAddon.findNext(query, { caseSensitive, regex, wholeWord })} title="Next (Enter)">&#x25BC;</button>
  <button class="close-btn" onclick={close} title="Close (Esc)">&times;</button>
</div>

<style>
  .search-bar {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  input {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    padding: 4px 8px;
    font-size: 13px;
    font-family: inherit;
    width: 200px;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .result-count {
    color: var(--text-muted);
    font-size: 12px;
    min-width: 50px;
    text-align: center;
  }

  .option-toggle {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    font-family: monospace;
  }

  .option-toggle:hover {
    background: var(--bg-tertiary);
  }

  .option-toggle.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .nav-btn,
  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .nav-btn:hover,
  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/SearchBar.svelte
git commit -m "feat(search): add SearchBar component"
```

---

### Task 5: Wire search into App.svelte

**Files:**
- Modify: `frontend/src/App.svelte`

Connect the keybinding action to toggling the search bar on the active terminal.

- [ ] **Step 1: Add state and terminal API tracking**

In `frontend/src/App.svelte`, add imports:

```typescript
import type { TerminalApi } from "./lib/types";
```

Add state variables:

```typescript
let searchVisible = $state(false);
let terminalApis = $state<Record<string, TerminalApi>>({});
```

- [ ] **Step 2: Register the keybinding action**

Add to the `actions` object:

```typescript
"terminal.search": () => {
  if (activeSessionId) searchVisible = !searchVisible;
},
```

- [ ] **Step 3: Wire Terminal onReady and SearchBar**

Import SearchBar:

```typescript
import SearchBar from "./lib/SearchBar.svelte";
```

Update the terminal rendering block. Replace the existing terminal-wrapper `{#each}` block:

```svelte
{#each sessions as session (session.id)}
  <div class="terminal-wrapper" class:active={session.id === activeSessionId}>
    <Terminal
      sessionId={session.id}
      visible={session.id === activeSessionId}
      onReady={(api) => (terminalApis[session.id] = api)}
    />
    {#if searchVisible && session.id === activeSessionId && terminalApis[session.id]}
      <SearchBar
        searchAddon={terminalApis[session.id].searchAddon}
        onClose={() => {
          searchVisible = false;
          terminalApis[session.id]?.focus();
        }}
      />
    {/if}
  </div>
{/each}
```

- [ ] **Step 4: Auto-focus search input when opened**

Add an `$effect` to focus the search bar when it becomes visible:

```typescript
$effect(() => {
  if (searchVisible && activeSessionId) {
    // SearchBar's focusInput is called via bind:this — but since SearchBar
    // mounts fresh each time searchVisible toggles, use a tick delay
    // to let it mount, then focus the input via DOM query.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(".search-bar input");
      input?.focus();
      input?.select();
    });
  }
});
```

- [ ] **Step 5: Close search when switching sessions**

Add an `$effect` that closes search when the active session changes:

```typescript
$effect(() => {
  // Reference activeSessionId to track it
  void activeSessionId;
  searchVisible = false;
});
```

Note: This effect runs on mount too, which is fine since `searchVisible` starts as `false`.

- [ ] **Step 6: Verify it compiles**

```bash
cd frontend && npm run check
```

Expected: No type errors.

- [ ] **Step 7: Test manually**

```bash
cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41
```

1. Create a session, run some commands that produce output
2. Press Ctrl+F — search bar should appear at top-right
3. Type a query — matches should highlight in the terminal
4. Press Enter to cycle forward, Shift+Enter to cycle backward
5. Toggle case sensitive / whole word / regex buttons
6. Press Escape — search bar closes, focus returns to terminal
7. Switch sessions — search bar should close

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat(search): wire SearchBar into App with keybinding"
```

---

### Task 6: Theme-aware search decorations

**Files:**
- Modify: `frontend/src/lib/themes.ts`
- Modify: `frontend/src/lib/SearchBar.svelte`

The SearchAddon highlights matches with configurable colors. Wire these to the theme system so they look right in all themes.

- [ ] **Step 1: Add search decoration colors to ThemeColors**

In `frontend/src/lib/themes.ts`, add to the `ThemeColors` interface:

```typescript
export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  selectionBackground: string;
  searchMatch: string;
  searchMatchActive: string;
}
```

Add colors to each theme:

**whattheflock:**
```typescript
searchMatch: "#ff2d7840",
searchMatchActive: "#ff2d78",
```

**dark:**
```typescript
searchMatch: "#7aa2f740",
searchMatchActive: "#7aa2f7",
```

**light:**
```typescript
searchMatch: "#d9236240",
searchMatchActive: "#d92362",
```

- [ ] **Step 2: Pass decoration colors in SearchBar**

In `frontend/src/lib/SearchBar.svelte`, import the theme getter:

```typescript
import { getTheme } from "./config.svelte";
```

Update the `$effect` that runs the search to include decorations:

```typescript
$effect(() => {
  if (query) {
    const theme = getTheme();
    searchAddon.findNext(query, {
      caseSensitive,
      regex,
      wholeWord,
      incremental: true,
      decorations: {
        matchBackground: theme.colors.searchMatch,
        activeMatchBackground: theme.colors.searchMatchActive,
        activeMatchColorOverviewRuler: theme.colors.searchMatchActive,
        matchOverviewRuler: theme.colors.searchMatch,
      },
    });
  }
});
```

Also update the `findNext` and `findPrevious` calls in `handleKeydown` and the nav buttons to include the same decorations. Extract a helper:

```typescript
function searchOptions(): { caseSensitive: boolean; regex: boolean; wholeWord: boolean; decorations: object } {
  const theme = getTheme();
  return {
    caseSensitive,
    regex,
    wholeWord,
    decorations: {
      matchBackground: theme.colors.searchMatch,
      activeMatchBackground: theme.colors.searchMatchActive,
      activeMatchColorOverviewRuler: theme.colors.searchMatchActive,
      matchOverviewRuler: theme.colors.searchMatch,
    },
  };
}
```

Then replace all `{ caseSensitive, regex, wholeWord }` with `searchOptions()` in the event handler and button onclick handlers.

- [ ] **Step 3: Verify it compiles**

```bash
cd frontend && npm run check
```

- [ ] **Step 4: Test manually**

Run the app, open search, type a query. Match highlights should use the theme's accent color (semi-transparent for inactive matches, solid for active match).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/themes.ts frontend/src/lib/SearchBar.svelte
git commit -m "feat(search): theme-aware match decorations"
```

---

### Task 7: Keybinding test for default keymap completeness

**Files:**
- Modify: `frontend/src/lib/keybindings.test.ts`

- [ ] **Step 1: Update the existing "has bindings for core actions" test**

The existing test checks for specific actions. Update it to also check `terminal.search`:

```typescript
it("has bindings for core actions", () => {
  const actions = Object.keys(DEFAULT_KEYMAP) as Action[];
  expect(actions).toContain("session.new");
  expect(actions).toContain("session.kill");
  expect(actions).toContain("session.next");
  expect(actions).toContain("session.prev");
  expect(actions).toContain("terminal.search");
});
```

Note: This overlaps with the test added in Task 2. If that test was added as a separate `it` block, remove it and consolidate here. If it was added to this block, this step is already done.

- [ ] **Step 2: Run all tests**

```bash
cd frontend && npx vitest run
```

Expected: All PASS.

- [ ] **Step 3: Also run the Go tests to make sure nothing is broken**

```bash
cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/...
```

Expected: All PASS.

- [ ] **Step 4: Commit (if any changes)**

```bash
git add frontend/src/lib/keybindings.test.ts
git commit -m "test(search): consolidate keybinding tests"
```
