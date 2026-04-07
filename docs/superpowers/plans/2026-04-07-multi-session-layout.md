# Multi-session Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add split-pane layout with a binary tree model so multiple terminals are visible simultaneously.

**Architecture:** Binary tree of layout nodes (split or leaf). Recursive Svelte components render the tree. Layout persists in the app config JSON alongside theme/keybindings.

**Tech Stack:** Svelte 5 (runes), TypeScript, Go (config persistence), xterm.js v5

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/lib/layout.ts` | Create | `LayoutNode` type, tree manipulation functions |
| `frontend/src/lib/layout.test.ts` | Create | Unit tests for layout tree logic |
| `frontend/src/lib/SplitPane.svelte` | Create | Recursive layout renderer |
| `frontend/src/lib/PaneContainer.svelte` | Create | Single pane: tab bar + terminal + empty state |
| `frontend/src/lib/DragDivider.svelte` | Create | Resize handle between split children |
| `frontend/src/lib/TabBar.svelte` | Create | Pane header with session info and close button |
| `frontend/src/lib/Toast.svelte` | Create | Undo toast for pane close |
| `frontend/src/lib/keybindings.ts` | Modify | Add pane actions to `Action` union and `DEFAULT_KEYMAP` |
| `frontend/src/lib/types.ts` | Modify | Add `LayoutNode` re-export if needed |
| `frontend/src/App.svelte` | Modify | Replace terminal loop with `SplitPane`, layout state, persistence |
| `frontend/src/lib/Sidebar.svelte` | Modify | Add drag support, change click to assign-to-focused-pane |
| `internal/config/config.go` | Modify | Add `Layout` field to `Config` struct |
| `internal/config/config_test.go` | Modify | Test layout persistence |

---

### Task 1: Layout Tree Data Model and Pure Functions

**Files:**
- Create: `frontend/src/lib/layout.ts`
- Create: `frontend/src/lib/layout.test.ts`

- [ ] **Step 1: Set up test infrastructure**

Check that vitest or a test runner is available. If not, install it:

```bash
cd frontend && npx vitest --version
```

If vitest is not installed:
```bash
cd frontend && npm install -D vitest
```

Add to `frontend/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Write failing tests for layout types and splitLeaf**

Create `frontend/src/lib/layout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  type LayoutNode,
  type LeafNode,
  type SplitNode,
  splitLeaf,
  closeLeaf,
  findLeaf,
  pruneEmptyBranches,
  DEFAULT_LAYOUT,
} from "./layout";

describe("DEFAULT_LAYOUT", () => {
  it("is a single empty leaf", () => {
    expect(DEFAULT_LAYOUT).toEqual({ type: "leaf", sessionId: null });
  });
});

describe("splitLeaf", () => {
  it("replaces a leaf with a split containing the original and a new empty leaf", () => {
    const leaf: LayoutNode = { type: "leaf", sessionId: "abc" };
    const result = splitLeaf(leaf, [], "horizontal");
    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.direction).toBe("horizontal");
    expect(split.ratio).toBe(0.5);
    expect(split.children[0]).toEqual({ type: "leaf", sessionId: "abc" });
    expect(split.children[1]).toEqual({ type: "leaf", sessionId: null });
  });

  it("splits a nested leaf by path", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: "b" },
      ],
    };
    const result = splitLeaf(tree, [1], "vertical");
    expect(result.type).toBe("split");
    const root = result as SplitNode;
    expect(root.children[0]).toEqual({ type: "leaf", sessionId: "a" });
    const nested = root.children[1] as SplitNode;
    expect(nested.type).toBe("split");
    expect(nested.direction).toBe("vertical");
    expect(nested.children[0]).toEqual({ type: "leaf", sessionId: "b" });
    expect(nested.children[1]).toEqual({ type: "leaf", sessionId: null });
  });

  it("returns tree unchanged if path is invalid", () => {
    const tree: LayoutNode = { type: "leaf", sessionId: "a" };
    const result = splitLeaf(tree, [0], "horizontal");
    expect(result).toEqual(tree);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: FAIL — module `./layout` not found.

- [ ] **Step 4: Implement layout types and splitLeaf**

Create `frontend/src/lib/layout.ts`:

```typescript
export interface LeafNode {
  type: "leaf";
  sessionId: string | null;
}

export interface SplitNode {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = LeafNode | SplitNode;

export const DEFAULT_LAYOUT: LayoutNode = { type: "leaf", sessionId: null };

export function splitLeaf(
  node: LayoutNode,
  path: number[],
  direction: "horizontal" | "vertical",
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") return node;
    return {
      type: "split",
      direction,
      ratio: 0.5,
      children: [{ ...node }, { type: "leaf", sessionId: null }],
    };
  }

  if (node.type !== "split") return node;
  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) return node;

  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = splitLeaf(node.children[head], rest, direction);
  return { ...node, children: newChildren };
}
```

- [ ] **Step 5: Run tests to verify splitLeaf passes**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: 4 tests pass (DEFAULT_LAYOUT + 3 splitLeaf).

- [ ] **Step 6: Write failing tests for closeLeaf**

Append to `frontend/src/lib/layout.test.ts`:

```typescript
describe("closeLeaf", () => {
  it("returns DEFAULT_LAYOUT when closing the root leaf", () => {
    const tree: LayoutNode = { type: "leaf", sessionId: "a" };
    const result = closeLeaf(tree, []);
    expect(result).toEqual(DEFAULT_LAYOUT);
  });

  it("replaces parent split with the surviving sibling", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: "b" },
      ],
    };
    const result = closeLeaf(tree, [1]);
    expect(result).toEqual({ type: "leaf", sessionId: "a" });
  });

  it("handles deeply nested close", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", sessionId: "b" },
            { type: "leaf", sessionId: "c" },
          ],
        },
      ],
    };
    const result = closeLeaf(tree, [1, 0]);
    const root = result as SplitNode;
    expect(root.type).toBe("split");
    expect(root.children[0]).toEqual({ type: "leaf", sessionId: "a" });
    expect(root.children[1]).toEqual({ type: "leaf", sessionId: "c" });
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: FAIL — `closeLeaf` is not exported.

- [ ] **Step 8: Implement closeLeaf**

Add to `frontend/src/lib/layout.ts`:

```typescript
export function closeLeaf(node: LayoutNode, path: number[]): LayoutNode {
  if (path.length === 0) {
    return { ...DEFAULT_LAYOUT };
  }

  if (node.type !== "split") return node;

  if (path.length === 1) {
    const index = path[0];
    if (index !== 0 && index !== 1) return node;
    const survivor = node.children[index === 0 ? 1 : 0];
    return survivor;
  }

  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) return node;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = closeLeaf(node.children[head], rest);
  return { ...node, children: newChildren };
}
```

- [ ] **Step 9: Run tests to verify closeLeaf passes**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: All tests pass.

- [ ] **Step 10: Write failing tests for findLeaf and pruneEmptyBranches**

Append to `frontend/src/lib/layout.test.ts`:

```typescript
describe("findLeaf", () => {
  it("finds a leaf by sessionId and returns its path", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: "b" },
      ],
    };
    expect(findLeaf(tree, "b")).toEqual([1]);
  });

  it("returns null if sessionId not found", () => {
    const tree: LayoutNode = { type: "leaf", sessionId: "a" };
    expect(findLeaf(tree, "z")).toBeNull();
  });

  it("finds deeply nested leaf", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", sessionId: "b" },
            { type: "leaf", sessionId: "c" },
          ],
        },
      ],
    };
    expect(findLeaf(tree, "c")).toEqual([1, 1]);
  });
});

describe("pruneEmptyBranches", () => {
  it("collapses a split with two null leaves into a single null leaf", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: null },
        { type: "leaf", sessionId: null },
      ],
    };
    expect(pruneEmptyBranches(tree)).toEqual({ type: "leaf", sessionId: null });
  });

  it("keeps splits with at least one non-null leaf", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: null },
      ],
    };
    expect(pruneEmptyBranches(tree)).toEqual(tree);
  });

  it("prunes recursively", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", sessionId: null },
            { type: "leaf", sessionId: null },
          ],
        },
      ],
    };
    const result = pruneEmptyBranches(tree);
    const split = result as SplitNode;
    expect(split.children[0]).toEqual({ type: "leaf", sessionId: "a" });
    expect(split.children[1]).toEqual({ type: "leaf", sessionId: null });
  });
});
```

- [ ] **Step 11: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: FAIL — `findLeaf` and `pruneEmptyBranches` not exported.

- [ ] **Step 12: Implement findLeaf and pruneEmptyBranches**

Add to `frontend/src/lib/layout.ts`:

```typescript
export function findLeaf(node: LayoutNode, sessionId: string): number[] | null {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? [] : null;
  }
  for (let i = 0; i < 2; i++) {
    const result = findLeaf(node.children[i as 0 | 1], sessionId);
    if (result !== null) return [i, ...result];
  }
  return null;
}

function isAllNull(node: LayoutNode): boolean {
  if (node.type === "leaf") return node.sessionId === null;
  return isAllNull(node.children[0]) && isAllNull(node.children[1]);
}

export function pruneEmptyBranches(node: LayoutNode): LayoutNode {
  if (node.type === "leaf") return node;

  const left = pruneEmptyBranches(node.children[0]);
  const right = pruneEmptyBranches(node.children[1]);

  if (isAllNull(left) && isAllNull(right)) {
    return { type: "leaf", sessionId: null };
  }

  return { ...node, children: [left, right] };
}
```

- [ ] **Step 13: Run tests to verify all pass**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: All tests pass.

- [ ] **Step 14: Write failing test for assignSession**

Append to `frontend/src/lib/layout.test.ts`:

```typescript
import { assignSession } from "./layout";

describe("assignSession", () => {
  it("sets sessionId on a leaf at the given path", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: null },
      ],
    };
    const result = assignSession(tree, [1], "b");
    const split = result as SplitNode;
    expect(split.children[1]).toEqual({ type: "leaf", sessionId: "b" });
  });

  it("replaces existing sessionId", () => {
    const tree: LayoutNode = { type: "leaf", sessionId: "old" };
    const result = assignSession(tree, [], "new");
    expect(result).toEqual({ type: "leaf", sessionId: "new" });
  });
});
```

- [ ] **Step 15: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: FAIL — `assignSession` not exported.

- [ ] **Step 16: Implement assignSession**

Add to `frontend/src/lib/layout.ts`:

```typescript
export function assignSession(
  node: LayoutNode,
  path: number[],
  sessionId: string | null,
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") return node;
    return { ...node, sessionId };
  }

  if (node.type !== "split") return node;
  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) return node;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = assignSession(node.children[head], rest, sessionId);
  return { ...node, children: newChildren };
}
```

- [ ] **Step 17: Run tests to verify all pass**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: All tests pass.

- [ ] **Step 18: Write failing test for updateRatio**

Append to `frontend/src/lib/layout.test.ts`:

```typescript
import { updateRatio } from "./layout";

describe("updateRatio", () => {
  it("updates ratio on a split at the given path", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", sessionId: "a" },
        { type: "leaf", sessionId: "b" },
      ],
    };
    const result = updateRatio(tree, [], 0.7);
    expect((result as SplitNode).ratio).toBe(0.7);
  });
});
```

- [ ] **Step 19: Implement updateRatio**

Add to `frontend/src/lib/layout.ts`:

```typescript
export function updateRatio(
  node: LayoutNode,
  path: number[],
  ratio: number,
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "split") return node;
    return { ...node, ratio };
  }

  if (node.type !== "split") return node;
  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) return node;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = updateRatio(node.children[head], rest, ratio);
  return { ...node, children: newChildren };
}
```

- [ ] **Step 20: Run all layout tests**

```bash
cd frontend && npx vitest run src/lib/layout.test.ts
```

Expected: All tests pass.

- [ ] **Step 21: Commit**

```bash
git add frontend/src/lib/layout.ts frontend/src/lib/layout.test.ts frontend/package.json
git commit -m "feat: add layout tree data model with pure manipulation functions"
```

---

### Task 2: Add Layout Field to Go Config

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Write failing test for layout persistence**

Add to `internal/config/config_test.go`:

```go
func TestLayoutFieldPersists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := &Config{
		Theme:       "dark",
		Keybindings: map[string]string{},
		Layout:      json.RawMessage(`{"type":"split","direction":"horizontal","ratio":0.5,"children":[{"type":"leaf","sessionId":"abc"},{"type":"leaf","sessionId":null}]}`),
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if loaded.Layout == nil {
		t.Fatal("expected layout to be non-nil")
	}
	if string(loaded.Layout) != string(cfg.Layout) {
		t.Errorf("layout mismatch: got %s", string(loaded.Layout))
	}
}

func TestDefaultsHaveNilLayout(t *testing.T) {
	cfg := Defaults()
	if cfg.Layout != nil {
		t.Error("expected nil layout in defaults")
	}
}
```

Add `"encoding/json"` to the imports at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
go test ./internal/config/...
```

Expected: FAIL — `Config` has no `Layout` field.

- [ ] **Step 3: Add Layout field to Config**

Modify `internal/config/config.go` — add to the `Config` struct:

```go
type Config struct {
	Theme       string            `json:"theme"`
	Keybindings map[string]string `json:"keybindings"`
	Layout      json.RawMessage   `json:"layout,omitempty"`
}
```

Add `"encoding/json"` to the imports.

- [ ] **Step 4: Run tests to verify they pass**

```bash
go test ./internal/config/...
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat: add layout field to app config for persistence"
```

---

### Task 3: Keybinding Actions for Panes

**Files:**
- Modify: `frontend/src/lib/keybindings.ts`

- [ ] **Step 1: Add pane actions to Action type and DEFAULT_KEYMAP**

Update the `Action` type in `frontend/src/lib/keybindings.ts`:

```typescript
export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "app.toggleSidebar"
  | "terminal.search"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.close"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.focusLeft"
  | "pane.focusRight";
```

Update `DEFAULT_KEYMAP`:

```typescript
export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+K",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
  "terminal.search": "Ctrl+f",
  "pane.splitRight": "Ctrl+Shift+D",
  "pane.splitDown": "Ctrl+Shift+E",
  "pane.close": "Ctrl+Shift+W",
  "pane.focusUp": "Ctrl+Shift+ArrowUp",
  "pane.focusDown": "Ctrl+Shift+ArrowDown",
  "pane.focusLeft": "Ctrl+Shift+ArrowLeft",
  "pane.focusRight": "Ctrl+Shift+ArrowRight",
};
```

Note: `session.kill` moves from `Ctrl+Shift+W` to `Ctrl+Shift+K` since `Ctrl+Shift+W` is now `pane.close`.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No type errors. (The `Action` type is informational; `Keymap` is `Record<string, string>` so no compilation issues.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/keybindings.ts
git commit -m "feat: add pane split/close/focus keybinding actions"
```

---

### Task 4: DragDivider Component

**Files:**
- Create: `frontend/src/lib/DragDivider.svelte`

- [ ] **Step 1: Create DragDivider component**

Create `frontend/src/lib/DragDivider.svelte`:

```svelte
<script lang="ts">
  interface Props {
    direction: "horizontal" | "vertical";
    onDrag: (delta: number) => void;
    onReset: () => void;
  }

  let { direction, onDrag, onReset }: Props = $props();
  let dragging = $state(false);

  function handlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    dragging = true;

    let lastX = event.clientX;
    let lastY = event.clientY;

    function handlePointerMove(e: PointerEvent): void {
      const delta = direction === "horizontal"
        ? e.clientX - lastX
        : e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      onDrag(delta);
    }

    function handlePointerUp(): void {
      dragging = false;
      target.removeEventListener("pointermove", handlePointerMove);
      target.removeEventListener("pointerup", handlePointerUp);
    }

    target.addEventListener("pointermove", handlePointerMove);
    target.addEventListener("pointerup", handlePointerUp);
  }

  function handleDblClick(): void {
    onReset();
  }
</script>

<div
  class="divider"
  class:horizontal={direction === "horizontal"}
  class:vertical={direction === "vertical"}
  class:dragging
  onpointerdown={handlePointerDown}
  ondblclick={handleDblClick}
  role="separator"
  aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
></div>

<style>
  .divider {
    flex-shrink: 0;
    background: var(--border);
    transition: background 0.15s;
    z-index: 1;
  }

  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  .divider.horizontal {
    width: 4px;
    cursor: col-resize;
  }

  .divider.vertical {
    height: 4px;
    cursor: row-resize;
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/DragDivider.svelte
git commit -m "feat: add DragDivider resize handle component"
```

---

### Task 5: Toast Component

**Files:**
- Create: `frontend/src/lib/Toast.svelte`

- [ ] **Step 1: Create Toast component**

Create `frontend/src/lib/Toast.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    message: string;
    duration?: number;
    onUndo: () => void;
    onExpire: () => void;
  }

  let { message, duration = 5000, onUndo, onExpire }: Props = $props();
  let remaining = $state(duration);

  onMount(() => {
    const interval = setInterval(() => {
      remaining -= 100;
      if (remaining <= 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 100);
    return () => clearInterval(interval);
  });
</script>

<div class="toast">
  <span>{message}</span>
  <button class="undo-btn" onclick={onUndo}>Undo</button>
  <span class="timer">({Math.ceil(remaining / 1000)}s)</span>
</div>

<style>
  .toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
  }

  .undo-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 13px;
    text-decoration: underline;
    padding: 0;
  }

  .undo-btn:hover {
    color: var(--text-primary);
  }

  .timer {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/Toast.svelte
git commit -m "feat: add Toast component for undo notifications"
```

---

### Task 6: TabBar Component

**Files:**
- Create: `frontend/src/lib/TabBar.svelte`

- [ ] **Step 1: Create TabBar component**

Create `frontend/src/lib/TabBar.svelte`:

```svelte
<script lang="ts">
  import type { SessionInfo } from "./types";

  interface Props {
    session: SessionInfo | null;
    focused: boolean;
    onClose: () => void;
    onRename: (name: string) => void;
  }

  let { session, focused, onClose, onRename }: Props = $props();
  let editing = $state(false);
  let editValue = $state("");

  function startEditing(event: Event): void {
    event.stopPropagation();
    if (!session) return;
    editing = true;
    editValue = session.name;
  }

  function commitRename(): void {
    if (editValue.trim() && session) {
      onRename(editValue.trim());
    }
    editing = false;
  }

  function handleEditKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") commitRename();
    else if (event.key === "Escape") editing = false;
  }

  function statusColor(status: SessionInfo["status"]): string {
    switch (status) {
      case "running": return "var(--success)";
      case "exited": return "var(--warning)";
      case "stopped": return "var(--error)";
    }
  }
</script>

<div class="tab-bar" class:focused>
  {#if session}
    <div class="tab active">
      <span class="status-dot" style="background: {statusColor(session.status)}"></span>
      {#if editing}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename-input"
          bind:value={editValue}
          onblur={commitRename}
          onkeydown={handleEditKeydown}
          onclick={(e: MouseEvent) => e.stopPropagation()}
          autofocus
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="tab-name" ondblclick={startEditing}>{session.name}</span>
      {/if}
    </div>
  {:else}
    <div class="tab empty">
      <span class="tab-name muted">Empty</span>
    </div>
  {/if}
  <div class="spacer"></div>
  <button class="close-btn" onclick={onClose} title="Close pane">&times;</button>
</div>

<style>
  .tab-bar {
    height: 28px;
    min-height: 28px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 6px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
  }

  .tab.active {
    color: var(--text-primary);
  }

  .tab.empty .muted {
    color: var(--text-muted);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .rename-input {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    width: 120px;
  }

  .spacer {
    flex: 1;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 15px;
    padding: 0 4px;
    line-height: 1;
    border-radius: 3px;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--error);
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/TabBar.svelte
git commit -m "feat: add TabBar component for pane headers"
```

---

### Task 7: PaneContainer Component

**Files:**
- Create: `frontend/src/lib/PaneContainer.svelte`

- [ ] **Step 1: Create PaneContainer component**

Create `frontend/src/lib/PaneContainer.svelte`:

```svelte
<script lang="ts">
  import type { SessionInfo, TerminalApi } from "./types";
  import TabBar from "./TabBar.svelte";
  import Terminal from "./Terminal.svelte";
  import SearchBar from "./SearchBar.svelte";
  import Toast from "./Toast.svelte";

  interface Props {
    sessionId: string | null;
    sessions: SessionInfo[];
    focused: boolean;
    searchVisible: boolean;
    pendingClose: boolean;
    onFocus: () => void;
    onClose: () => void;
    onUndoClose: () => void;
    onCloseExpired: () => void;
    onRename: (id: string, name: string) => void;
    onDrop: (sessionId: string) => void;
  }

  let {
    sessionId,
    sessions,
    focused,
    searchVisible,
    pendingClose,
    onFocus,
    onClose,
    onUndoClose,
    onCloseExpired,
    onRename,
    onDrop,
  }: Props = $props();

  let terminalApi = $state<TerminalApi | null>(null);
  let dragOver = $state(false);

  let session = $derived(
    sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null,
  );

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOver = true;
  }

  function handleDragLeave(): void {
    dragOver = false;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
    const droppedId = event.dataTransfer?.getData("text/plain");
    if (droppedId) onDrop(droppedId);
  }

  function handleCloseSearch(): void {
    terminalApi?.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="pane-container"
  class:focused
  class:drag-over={dragOver}
  onclick={onFocus}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <TabBar
    {session}
    {focused}
    onClose={onClose}
    onRename={(name) => { if (sessionId) onRename(sessionId, name); }}
  />

  <div class="pane-body">
    {#if sessionId}
      <Terminal
        {sessionId}
        visible={true}
        onReady={(api) => (terminalApi = api)}
      />
      {#if searchVisible && terminalApi}
        <SearchBar
          searchAddon={terminalApi.searchAddon}
          onClose={handleCloseSearch}
        />
      {/if}
    {:else}
      <div class="empty-state">
        <p>Drop a session here</p>
        <p class="hint">or click one in the sidebar</p>
      </div>
    {/if}

    {#if pendingClose}
      <Toast
        message="Pane closed"
        onUndo={onUndoClose}
        onExpire={onCloseExpired}
      />
    {/if}
  </div>
</div>

<style>
  .pane-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: 1px solid transparent;
  }

  .pane-container.focused {
    border-color: var(--accent);
  }

  .pane-container.drag-over {
    border-color: var(--accent);
    background: rgba(var(--accent), 0.05);
  }

  .pane-body {
    flex: 1;
    position: relative;
    min-height: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    color: var(--text-muted);
    font-size: 14px;
  }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.7;
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/PaneContainer.svelte
git commit -m "feat: add PaneContainer with tab bar, terminal, and drop zone"
```

---

### Task 8: SplitPane Recursive Component

**Files:**
- Create: `frontend/src/lib/SplitPane.svelte`

- [ ] **Step 1: Create SplitPane component**

Create `frontend/src/lib/SplitPane.svelte`:

```svelte
<script lang="ts">
  import type { LayoutNode, SplitNode } from "./layout";
  import type { SessionInfo } from "./types";
  import DragDivider from "./DragDivider.svelte";
  import PaneContainer from "./PaneContainer.svelte";

  interface Props {
    node: LayoutNode;
    path: number[];
    sessions: SessionInfo[];
    focusedPath: number[];
    searchVisible: boolean;
    pendingClosePath: number[] | null;
    onFocus: (path: number[]) => void;
    onClose: (path: number[]) => void;
    onUndoClose: () => void;
    onCloseExpired: () => void;
    onResize: (path: number[], delta: number, containerSize: number) => void;
    onResetRatio: (path: number[]) => void;
    onRename: (id: string, name: string) => void;
    onDrop: (path: number[], sessionId: string) => void;
  }

  let {
    node,
    path,
    sessions,
    focusedPath,
    searchVisible,
    pendingClosePath,
    onFocus,
    onClose,
    onUndoClose,
    onCloseExpired,
    onResize,
    onResetRatio,
    onRename,
    onDrop,
  }: Props = $props();

  let containerEl: HTMLDivElement;

  function pathsEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function handleDrag(delta: number): void {
    if (!containerEl) return;
    const split = node as SplitNode;
    const size = split.direction === "horizontal"
      ? containerEl.clientWidth
      : containerEl.clientHeight;
    onResize(path, delta, size);
  }
</script>

{#if node.type === "leaf"}
  <PaneContainer
    sessionId={node.sessionId}
    {sessions}
    focused={pathsEqual(path, focusedPath)}
    searchVisible={searchVisible && pathsEqual(path, focusedPath)}
    pendingClose={pendingClosePath !== null && pathsEqual(path, pendingClosePath)}
    onFocus={() => onFocus(path)}
    onClose={() => onClose(path)}
    {onUndoClose}
    {onCloseExpired}
    {onRename}
    onDrop={(sessionId) => onDrop(path, sessionId)}
  />
{:else}
  {@const split = node as SplitNode}
  <div
    class="split-container"
    class:horizontal={split.direction === "horizontal"}
    class:vertical={split.direction === "vertical"}
    bind:this={containerEl}
  >
    <div class="split-child" style="flex: {split.ratio};">
      <svelte:self
        node={split.children[0]}
        path={[...path, 0]}
        {sessions}
        {focusedPath}
        {searchVisible}
        {pendingClosePath}
        {onFocus}
        {onClose}
        {onUndoClose}
        {onCloseExpired}
        {onResize}
        {onResetRatio}
        {onRename}
        {onDrop}
      />
    </div>

    <DragDivider
      direction={split.direction}
      onDrag={handleDrag}
      onReset={() => onResetRatio(path)}
    />

    <div class="split-child" style="flex: {1 - split.ratio};">
      <svelte:self
        node={split.children[1]}
        path={[...path, 1]}
        {sessions}
        {focusedPath}
        {searchVisible}
        {pendingClosePath}
        {onFocus}
        {onClose}
        {onUndoClose}
        {onCloseExpired}
        {onResize}
        {onResetRatio}
        {onRename}
        {onDrop}
      />
    </div>
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .split-container.horizontal {
    flex-direction: row;
  }

  .split-container.vertical {
    flex-direction: column;
  }

  .split-child {
    min-width: 80px;
    min-height: 80px;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/SplitPane.svelte
git commit -m "feat: add SplitPane recursive layout component"
```

---

### Task 9: Wire Layout Into App.svelte

**Files:**
- Modify: `frontend/src/App.svelte`

This is the integration task — replaces the current single-terminal view with the split layout system.

- [ ] **Step 1: Rewrite App.svelte to use layout tree**

Replace the contents of `frontend/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import {
    CreateSession,
    ListSessions,
    KillSession,
    RenameSession,
    GetConfig,
    SetConfig,
  } from "../wailsjs/go/main/App";
  import type { SessionInfo } from "./lib/types";
  import Sidebar from "./lib/Sidebar.svelte";
  import SplitPane from "./lib/SplitPane.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";
  import { getKeymap } from "./lib/config.svelte";
  import { matchKeybinding } from "./lib/keybindings";
  import {
    type LayoutNode,
    DEFAULT_LAYOUT,
    splitLeaf,
    closeLeaf,
    assignSession,
    updateRatio,
    findLeaf,
    pruneEmptyBranches,
  } from "./lib/layout";

  let sessions = $state<SessionInfo[]>([]);
  let showNewDialog = $state(false);
  let sidebarVisible = $state(true);
  let searchVisible = $state(false);
  let layoutTree = $state<LayoutNode>({ ...DEFAULT_LAYOUT });
  let focusedPath = $state<number[]>([]);
  let pendingClosePath = $state<number[] | null>(null);
  let pendingCloseSnapshot = $state<{ tree: LayoutNode; path: number[] } | null>(null);
  let cleanups: Array<() => void> = [];

  // Derive the focused leaf's sessionId for sidebar highlighting and actions
  let focusedSessionId = $derived.by(() => {
    let node: LayoutNode = layoutTree;
    for (const index of focusedPath) {
      if (node.type !== "split") return null;
      node = node.children[index as 0 | 1];
    }
    return node.type === "leaf" ? node.sessionId : null;
  });

  const actions: Record<string, () => void> = {
    "session.new": () => (showNewDialog = true),
    "session.kill": () => {
      if (focusedSessionId) handleKill(focusedSessionId);
    },
    "session.next": () => selectAdjacentSession(1),
    "session.prev": () => selectAdjacentSession(-1),
    "app.toggleSidebar": () => (sidebarVisible = !sidebarVisible),
    "terminal.search": () => {
      if (focusedSessionId) searchVisible = !searchVisible;
    },
    "pane.splitRight": () => handleSplit("horizontal"),
    "pane.splitDown": () => handleSplit("vertical"),
    "pane.close": () => handlePaneClose(focusedPath),
    "pane.focusUp": () => moveFocus("up"),
    "pane.focusDown": () => moveFocus("down"),
    "pane.focusLeft": () => moveFocus("left"),
    "pane.focusRight": () => moveFocus("right"),
  };

  function selectAdjacentSession(delta: number): void {
    if (sessions.length === 0) return;
    const currentIndex = sessions.findIndex((s) => s.id === focusedSessionId);
    const nextIndex =
      (currentIndex + delta + sessions.length) % sessions.length;
    const nextSession = sessions[nextIndex];
    const path = findLeaf(layoutTree, nextSession.id);
    if (path) focusedPath = path;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const action = matchKeybinding(event, getKeymap());
    if (action && actions[action]) {
      event.preventDefault();
      actions[action]();
    }
  }

  function handleSplit(direction: "horizontal" | "vertical"): void {
    layoutTree = splitLeaf(layoutTree, focusedPath, direction);
    persistLayout();
  }

  function handlePaneClose(path: number[]): void {
    pendingCloseSnapshot = { tree: layoutTree, path: [...path] };
    pendingClosePath = [...path];
  }

  function handleUndoClose(): void {
    if (pendingCloseSnapshot) {
      layoutTree = pendingCloseSnapshot.tree;
      focusedPath = pendingCloseSnapshot.path;
      pendingCloseSnapshot = null;
      pendingClosePath = null;
    }
  }

  function handleCloseExpired(): void {
    if (pendingClosePath) {
      layoutTree = closeLeaf(layoutTree, pendingClosePath);
      // Move focus to the first leaf
      focusedPath = findFirstLeafPath(layoutTree);
      persistLayout();
    }
    pendingCloseSnapshot = null;
    pendingClosePath = null;
  }

  function findFirstLeafPath(node: LayoutNode): number[] {
    if (node.type === "leaf") return [];
    return [0, ...findFirstLeafPath(node.children[0])];
  }

  function handleResize(path: number[], delta: number, containerSize: number): void {
    if (containerSize === 0) return;
    let node: LayoutNode = layoutTree;
    for (const index of path) {
      if (node.type !== "split") return;
      node = node.children[index as 0 | 1];
    }
    if (node.type !== "split") return;
    const ratioDelta = delta / containerSize;
    const newRatio = Math.max(0.1, Math.min(0.9, node.ratio + ratioDelta));
    layoutTree = updateRatio(layoutTree, path, newRatio);
    persistLayout();
  }

  function handleResetRatio(path: number[]): void {
    layoutTree = updateRatio(layoutTree, path, 0.5);
    persistLayout();
  }

  function handleDrop(path: number[], sessionId: string): void {
    layoutTree = assignSession(layoutTree, path, sessionId);
    focusedPath = [...path];
    persistLayout();
  }

  function handleSidebarSelect(id: string): void {
    // If session is already visible, focus its pane
    const existingPath = findLeaf(layoutTree, id);
    if (existingPath) {
      focusedPath = existingPath;
      return;
    }
    // Otherwise assign to focused pane
    layoutTree = assignSession(layoutTree, focusedPath, id);
    persistLayout();
  }

  function moveFocus(direction: "up" | "down" | "left" | "right"): void {
    // Simple implementation: collect all leaf paths, find spatially adjacent
    const leaves: number[][] = [];
    function collectLeaves(node: LayoutNode, path: number[]): void {
      if (node.type === "leaf") {
        leaves.push(path);
        return;
      }
      collectLeaves(node.children[0], [...path, 0]);
      collectLeaves(node.children[1], [...path, 1]);
    }
    collectLeaves(layoutTree, []);

    if (leaves.length <= 1) return;

    const currentIdx = leaves.findIndex(
      (p) => p.length === focusedPath.length && p.every((v, i) => v === focusedPath[i]),
    );
    if (currentIdx === -1) return;

    // For now, cycle through leaves in tree order
    // left/up = previous, right/down = next
    const delta = direction === "left" || direction === "up" ? -1 : 1;
    const nextIdx = (currentIdx + delta + leaves.length) % leaves.length;
    focusedPath = leaves[nextIdx];
  }

  async function persistLayout(): Promise<void> {
    const cfg = await GetConfig();
    (cfg as Record<string, unknown>).layout = layoutTree;
    await SetConfig(cfg);
  }

  async function loadLayout(): Promise<void> {
    const cfg = await GetConfig();
    const saved = (cfg as Record<string, unknown>).layout as LayoutNode | undefined;
    if (saved && saved.type) {
      layoutTree = saved;
      // Prune sessions that no longer exist
      const sessionIds = new Set(sessions.map((s) => s.id));
      function clearMissing(node: LayoutNode): LayoutNode {
        if (node.type === "leaf") {
          if (node.sessionId && !sessionIds.has(node.sessionId)) {
            return { type: "leaf", sessionId: null };
          }
          return node;
        }
        return {
          ...node,
          children: [clearMissing(node.children[0]), clearMissing(node.children[1])],
        };
      }
      layoutTree = pruneEmptyBranches(clearMissing(layoutTree));
    }
    focusedPath = findFirstLeafPath(layoutTree);
  }

  onMount(async () => {
    sessions = ((await ListSessions()) || []) as SessionInfo[];

    const cancel = EventsOn("sessions-updated", (updated: unknown) => {
      sessions = (updated || []) as SessionInfo[];
    });
    cleanups.push(cancel);

    await loadLayout();
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
  });

  async function handleNewSession(workDir: string) {
    showNewDialog = false;
    const info = await CreateSession(workDir);

    // Assign to focused pane if empty, otherwise split right
    let node: LayoutNode = layoutTree;
    for (const index of focusedPath) {
      if (node.type !== "split") break;
      node = node.children[index as 0 | 1];
    }

    if (node.type === "leaf" && node.sessionId === null) {
      layoutTree = assignSession(layoutTree, focusedPath, info.id);
    } else {
      layoutTree = splitLeaf(layoutTree, focusedPath, "horizontal");
      // New pane is at focusedPath + [1]
      const newPanePath = [...focusedPath, 1];
      layoutTree = assignSession(layoutTree, newPanePath, info.id);
      focusedPath = newPanePath;
    }
    persistLayout();
  }

  async function handleKill(id: string) {
    await KillSession(id);
  }

  async function handleRename(id: string, name: string) {
    await RenameSession(id, name);
  }

  $effect(() => {
    void focusedPath;
    searchVisible = false;
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  {#if sidebarVisible}
    <Sidebar
      {sessions}
      activeSessionId={focusedSessionId}
      onSelect={handleSidebarSelect}
      onNew={() => (showNewDialog = true)}
      onKill={handleKill}
      onRename={handleRename}
    />
  {/if}

  <div class="content">
    <SplitPane
      node={layoutTree}
      path={[]}
      {sessions}
      {focusedPath}
      {searchVisible}
      {pendingClosePath}
      onFocus={(path) => (focusedPath = path)}
      onClose={handlePaneClose}
      onUndoClose={handleUndoClose}
      onCloseExpired={handleCloseExpired}
      onResize={handleResize}
      onResetRatio={handleResetRatio}
      onRename={handleRename}
      onDrop={handleDrop}
    />
  </div>

  {#if showNewDialog}
    <NewSessionDialog
      onSubmit={handleNewSession}
      onCancel={() => (showNewDialog = false)}
    />
  {/if}
</main>

<style>
  main {
    display: flex;
    height: 100%;
  }

  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
</style>
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 3: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat: integrate split layout tree into App.svelte"
```

---

### Task 10: Add Drag Support to Sidebar

**Files:**
- Modify: `frontend/src/lib/Sidebar.svelte`

- [ ] **Step 1: Add draggable attribute and drag handlers to session items**

In `frontend/src/lib/Sidebar.svelte`, update the session item div to be draggable. Replace the `<div class="session-item" ...>` block:

Add a `handleDragStart` function in the `<script>` block:

```typescript
function handleDragStart(event: DragEvent, session: SessionInfo): void {
  if (event.dataTransfer) {
    event.dataTransfer.setData("text/plain", session.id);
    event.dataTransfer.effectAllowed = "move";
  }
}
```

Add `draggable="true"` and the `ondragstart` handler to each session item div:

```svelte
<div
  class="session-item"
  class:active={session.id === activeSessionId}
  onclick={() => onSelect(session.id)}
  onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") onSelect(session.id); }}
  draggable="true"
  ondragstart={(e: DragEvent) => handleDragStart(e, session)}
  role="button"
  tabindex="0"
>
```

- [ ] **Step 2: Add the drag hint at the bottom of the sidebar**

Add before the closing `</aside>` tag:

```svelte
<div class="drag-hint">Drag sessions to split panes</div>
```

Add the CSS:

```css
.drag-hint {
  font-size: 10px;
  color: var(--text-muted);
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  opacity: 0.7;
}
```

- [ ] **Step 3: Run frontend type check**

```bash
cd frontend && npm run check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/Sidebar.svelte
git commit -m "feat: add drag support to sidebar session items"
```

---

### Task 11: Manual Testing and Polish

- [ ] **Step 1: Start dev mode**

```bash
GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41
```

- [ ] **Step 2: Test basic flow**

1. Launch app — should show empty pane with "Drop a session here"
2. Create a new session — should appear in the pane
3. Press `Ctrl+Shift+D` — should split right, new empty pane appears
4. Create another session — should fill the empty pane
5. Click between panes — focus border should move
6. Drag divider — panes should resize
7. Double-click divider — should reset to 50/50
8. Press `Ctrl+Shift+W` — should show undo toast, then collapse

- [ ] **Step 3: Test persistence**

1. Create a split layout with two sessions
2. Close and reopen the app
3. Layout should be restored with sessions in correct panes

- [ ] **Step 4: Test drag from sidebar**

1. Drag a session from sidebar onto an empty pane — should assign
2. Drag a session from sidebar onto an occupied pane — should replace

- [ ] **Step 5: Fix any issues found during testing**

Address any visual glitches, sizing issues, or interaction bugs found during manual testing.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish split layout after manual testing"
```

---

### Task 12: Update Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Move Multi-session Layout to Completed**

Move the Multi-session Layout entry from "Up Next" to "Completed":

```markdown
## Completed

- **Session re-attachment** — Relay subprocess per session holds the PTY and listens on a Unix socket; app reconnects on restart with scrollback replay
- **Theming & keybindings** — Dark/light themes, customizable keyboard shortcuts, config persistence
- **Session naming** — Inline rename in sidebar, persisted in manifests
- **Terminal search** — xterm.js SearchAddon with Ctrl+F keybinding
- **Multi-session layout** — Split panes with binary tree model, drag-and-drop, per-pane tab bars, layout persistence
```

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark multi-session layout complete"
```
