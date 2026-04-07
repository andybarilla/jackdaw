# Multi-Session Layout v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add split-pane layout system so multiple terminals (managed sessions and plain terminals) can be visible simultaneously.

**Architecture:** Binary tree layout where each node is a leaf (pane) or a split (two children with a ratio). Frontend owns the tree state in App.svelte, renders it recursively via SplitPane.svelte. Go backend gets a lightweight `CreateTerminal`/`KillTerminal` path for plain terminals (no manifests, no recovery). Layout persisted in config as JSON.

**Tech Stack:** Go + Wails v2 (backend), Svelte 5 runes + xterm.js v5 (frontend), vitest (frontend tests)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `frontend/src/lib/layout.ts` | Pure layout tree types and manipulation functions |
| `frontend/src/lib/layout.test.ts` | Tests for layout tree functions |
| `frontend/src/lib/SplitPane.svelte` | Recursive tree renderer |
| `frontend/src/lib/PaneContainer.svelte` | Single pane: terminal, quick picker, or empty state |
| `frontend/src/lib/QuickPicker.svelte` | Launcher menu for empty panes |
| `frontend/src/lib/DragDivider.svelte` | Draggable split divider with ghost line |
| `internal/terminal/terminal.go` | Plain terminal PTY management |
| `internal/terminal/terminal_test.go` | Tests for plain terminal |

### Modified Files
| File | Changes |
|------|---------|
| `app.go` | Add `CreateTerminal`, `KillTerminal`, wire terminal events |
| `internal/config/config.go` | Add `Layout json.RawMessage` field |
| `internal/config/config_test.go` | Test layout round-trip |
| `frontend/src/App.svelte` | Replace single-session view with layout tree |
| `frontend/src/lib/Terminal.svelte` | Accept terminal ID in addition to session ID |
| `frontend/src/lib/Sidebar.svelte` | Update click behavior for pane assignment |
| `frontend/src/lib/keybindings.ts` | Add pane split/close/focus actions |
| `frontend/src/lib/types.ts` | Add TerminalInfo type |

---

### Task 1: Layout Tree Types and Pure Functions

**Files:**
- Create: `frontend/src/lib/layout.ts`
- Create: `frontend/src/lib/layout.test.ts`

- [ ] **Step 1: Write failing tests for layout types and splitLeaf**

```typescript
// frontend/src/lib/layout.test.ts
import { describe, it, expect } from "vitest";
import {
  type LayoutNode,
  type PaneContent,
  splitLeaf,
  closeLeaf,
  updateRatio,
  findLeafBySessionId,
  findLeafByTerminalId,
} from "./layout";

describe("splitLeaf", () => {
  it("splits a root leaf into two children", () => {
    const root: LayoutNode = { type: "leaf", content: null };
    const result = splitLeaf(root, [], "vertical");

    expect(result.type).toBe("split");
    if (result.type !== "split") return;
    expect(result.direction).toBe("vertical");
    expect(result.ratio).toBe(0.5);
    expect(result.children[0]).toEqual({ type: "leaf", content: null });
    expect(result.children[1]).toEqual({ type: "leaf", content: null });
  });

  it("preserves existing content in the first child", () => {
    const content: PaneContent = { type: "session", sessionId: "s1" };
    const root: LayoutNode = { type: "leaf", content };
    const result = splitLeaf(root, [], "horizontal");

    if (result.type !== "split") return;
    expect(result.children[0]).toEqual({ type: "leaf", content });
    expect(result.children[1]).toEqual({ type: "leaf", content: null });
  });

  it("splits a nested leaf by path", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: null },
        { type: "leaf", content: { type: "session", sessionId: "s1" } },
      ],
    };
    const result = splitLeaf(root, [1], "horizontal");

    if (result.type !== "split") return;
    expect(result.children[0]).toEqual({ type: "leaf", content: null });
    const right = result.children[1];
    if (right.type !== "split") return;
    expect(right.direction).toBe("horizontal");
    expect(right.children[0]).toEqual({
      type: "leaf",
      content: { type: "session", sessionId: "s1" },
    });
    expect(right.children[1]).toEqual({ type: "leaf", content: null });
  });
});

describe("closeLeaf", () => {
  it("replaces parent split with sibling when leaf is closed", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: { type: "session", sessionId: "s1" } },
        { type: "leaf", content: null },
      ],
    };
    const result = closeLeaf(root, [1]);

    expect(result).toEqual({
      type: "leaf",
      content: { type: "session", sessionId: "s1" },
    });
  });

  it("returns empty leaf when closing the only leaf", () => {
    const root: LayoutNode = { type: "leaf", content: { type: "session", sessionId: "s1" } };
    const result = closeLeaf(root, []);

    expect(result).toEqual({ type: "leaf", content: null });
  });

  it("collapses nested split correctly", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.6,
      children: [
        { type: "leaf", content: { type: "session", sessionId: "s1" } },
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "leaf", content: { type: "terminal", id: "t1", workDir: "/tmp" } },
            { type: "leaf", content: null },
          ],
        },
      ],
    };
    // Close the null leaf at [1, 1]
    const result = closeLeaf(root, [1, 1]);

    if (result.type !== "split") return;
    expect(result.direction).toBe("vertical");
    expect(result.children[1]).toEqual({
      type: "leaf",
      content: { type: "terminal", id: "t1", workDir: "/tmp" },
    });
  });
});

describe("updateRatio", () => {
  it("updates ratio at the given path", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: null },
        { type: "leaf", content: null },
      ],
    };
    const result = updateRatio(root, [], 0.7);

    if (result.type !== "split") return;
    expect(result.ratio).toBe(0.7);
  });

  it("clamps ratio to [0.1, 0.9]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: null },
        { type: "leaf", content: null },
      ],
    };
    const tooSmall = updateRatio(root, [], 0.02);
    if (tooSmall.type === "split") expect(tooSmall.ratio).toBe(0.1);

    const tooBig = updateRatio(root, [], 0.99);
    if (tooBig.type === "split") expect(tooBig.ratio).toBe(0.9);
  });
});

describe("findLeafBySessionId", () => {
  it("finds the path to a leaf with a given session ID", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: { type: "session", sessionId: "s1" } },
        { type: "leaf", content: { type: "session", sessionId: "s2" } },
      ],
    };
    expect(findLeafBySessionId(root, "s2")).toEqual([1]);
    expect(findLeafBySessionId(root, "s1")).toEqual([0]);
    expect(findLeafBySessionId(root, "s3")).toBeNull();
  });
});

describe("findLeafByTerminalId", () => {
  it("finds the path to a leaf with a given terminal ID", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", content: { type: "terminal", id: "t1", workDir: "/tmp" } },
        { type: "leaf", content: null },
      ],
    };
    expect(findLeafByTerminalId(root, "t1")).toEqual([0]);
    expect(findLeafByTerminalId(root, "t2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/layout.test.ts`
Expected: FAIL — module `./layout` not found

- [ ] **Step 3: Implement layout.ts**

```typescript
// frontend/src/lib/layout.ts

export type PaneContent =
  | { type: "session"; sessionId: string }
  | { type: "terminal"; id: string; workDir: string }
  | null;

export type LayoutNode =
  | { type: "leaf"; content: PaneContent }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export function emptyLeaf(): LayoutNode {
  return { type: "leaf", content: null };
}

export function splitLeaf(
  node: LayoutNode,
  path: number[],
  direction: "horizontal" | "vertical",
): LayoutNode {
  if (path.length === 0) {
    return {
      type: "split",
      direction,
      ratio: 0.5,
      children: [node, emptyLeaf()],
    };
  }

  if (node.type !== "split") return node;

  const [head, ...rest] = path;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = splitLeaf(node.children[head], rest, direction);
  return { ...node, children: newChildren };
}

export function closeLeaf(node: LayoutNode, path: number[]): LayoutNode {
  if (path.length === 0) {
    return emptyLeaf();
  }

  if (node.type !== "split") return node;

  if (path.length === 1) {
    const siblingIndex = path[0] === 0 ? 1 : 0;
    return node.children[siblingIndex];
  }

  const [head, ...rest] = path;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = closeLeaf(node.children[head], rest);
  return { ...node, children: newChildren };
}

export function updateRatio(
  node: LayoutNode,
  path: number[],
  ratio: number,
): LayoutNode {
  const clamped = Math.min(0.9, Math.max(0.1, ratio));

  if (path.length === 0) {
    if (node.type !== "split") return node;
    return { ...node, ratio: clamped };
  }

  if (node.type !== "split") return node;

  const [head, ...rest] = path;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = updateRatio(node.children[head], rest, ratio);
  return { ...node, children: newChildren };
}

export function getLeafContent(
  node: LayoutNode,
  path: number[],
): PaneContent | undefined {
  if (path.length === 0) {
    return node.type === "leaf" ? node.content : undefined;
  }
  if (node.type !== "split") return undefined;
  return getLeafContent(node.children[path[0]], path.slice(1));
}

export function setLeafContent(
  node: LayoutNode,
  path: number[],
  content: PaneContent,
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") return node;
    return { type: "leaf", content };
  }
  if (node.type !== "split") return node;
  const [head, ...rest] = path;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[head] = setLeafContent(node.children[head], rest, content);
  return { ...node, children: newChildren };
}

export function findLeafBySessionId(
  node: LayoutNode,
  sessionId: string,
  path: number[] = [],
): number[] | null {
  if (node.type === "leaf") {
    if (node.content?.type === "session" && node.content.sessionId === sessionId) {
      return path;
    }
    return null;
  }
  for (let i = 0; i < 2; i++) {
    const result = findLeafBySessionId(node.children[i], sessionId, [...path, i]);
    if (result) return result;
  }
  return null;
}

export function findLeafByTerminalId(
  node: LayoutNode,
  terminalId: string,
  path: number[] = [],
): number[] | null {
  if (node.type === "leaf") {
    if (node.content?.type === "terminal" && node.content.id === terminalId) {
      return path;
    }
    return null;
  }
  for (let i = 0; i < 2; i++) {
    const result = findLeafByTerminalId(node.children[i], terminalId, [...path, i]);
    if (result) return result;
  }
  return null;
}

export function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    if (node.content?.type === "session") return [node.content.sessionId];
    return [];
  }
  return [
    ...collectSessionIds(node.children[0]),
    ...collectSessionIds(node.children[1]),
  ];
}

export function collectTerminalIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    if (node.content?.type === "terminal") return [node.content.id];
    return [];
  }
  return [
    ...collectTerminalIds(node.children[0]),
    ...collectTerminalIds(node.children[1]),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/layout.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/layout.ts frontend/src/lib/layout.test.ts
git commit -m "feat: add layout tree types and pure manipulation functions"
```

---

### Task 2: Config Layout Persistence (Go)

**Files:**
- Modify: `internal/config/config.go:10-13`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Write failing test for layout field round-trip**

Add to `internal/config/config_test.go`:

```go
func TestSaveAndLoadWithLayout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	layout := json.RawMessage(`{"type":"leaf","content":null}`)
	cfg := &Config{
		Theme:       "dark",
		Keybindings: map[string]string{},
		Layout:      layout,
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if string(loaded.Layout) != `{"type":"leaf","content":null}` {
		t.Errorf("layout = %s, want %s", loaded.Layout, layout)
	}
}

func TestLoadDefaultsHaveNilLayout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Layout != nil {
		t.Errorf("expected nil layout for defaults, got %s", cfg.Layout)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/config/ -run TestSaveAndLoadWithLayout`
Expected: FAIL — `Config` has no `Layout` field

- [ ] **Step 3: Add Layout field to Config struct**

In `internal/config/config.go`, add the import and field:

```go
import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	Theme       string            `json:"theme"`
	Keybindings map[string]string `json:"keybindings"`
	Layout      json.RawMessage   `json:"layout,omitempty"`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/config/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat: add Layout field to config for layout persistence"
```

---

### Task 3: Plain Terminal Backend

**Files:**
- Create: `internal/terminal/terminal.go`
- Create: `internal/terminal/terminal_test.go`

- [ ] **Step 1: Write failing test for terminal creation and lifecycle**

```go
// internal/terminal/terminal_test.go
package terminal

import (
	"testing"
	"time"
)

func TestManagerCreateAndList(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if info.ID == "" {
		t.Error("expected non-empty ID")
	}
	if info.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want /tmp", info.WorkDir)
	}
	if info.PID == 0 {
		t.Error("expected non-zero PID")
	}
}

func TestManagerKill(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := m.Kill(info.ID); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	// Give process time to exit
	time.Sleep(100 * time.Millisecond)

	if err := m.Kill(info.ID); err == nil {
		t.Error("expected error killing already-killed terminal")
	}
}

func TestManagerKillNonexistent(t *testing.T) {
	m := NewManager()
	if err := m.Kill("nonexistent"); err == nil {
		t.Error("expected error for nonexistent terminal")
	}
}

func TestManagerWriteAndResize(t *testing.T) {
	m := NewManager()
	defer m.CloseAll()

	info, err := m.Create("/tmp")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Write should not error
	if err := m.Write(info.ID, []byte("echo hello\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	// Resize should not error
	if err := m.Resize(info.ID, 80, 24); err != nil {
		t.Fatalf("Resize: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/terminal/`
Expected: FAIL — package not found

- [ ] **Step 3: Implement terminal.go**

```go
// internal/terminal/terminal.go
package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

type TerminalInfo struct {
	ID      string `json:"id"`
	WorkDir string `json:"work_dir"`
	PID     int    `json:"pid"`
}

type terminal struct {
	id      string
	workDir string
	cmd     *exec.Cmd
	ptmx    *os.File
	mu      sync.Mutex
}

type Manager struct {
	terminals map[string]*terminal
	mu        sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		terminals: make(map[string]*terminal),
	}
}

func (m *Manager) Create(workDir string) (*TerminalInfo, error) {
	id := fmt.Sprintf("term-%d", time.Now().UnixNano())

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	cmd := exec.Command(shell)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("start pty: %w", err)
	}

	t := &terminal{
		id:      id,
		workDir: workDir,
		cmd:     cmd,
		ptmx:    ptmx,
	}

	m.mu.Lock()
	m.terminals[id] = t
	m.mu.Unlock()

	info := &TerminalInfo{
		ID:      id,
		WorkDir: workDir,
		PID:     cmd.Process.Pid,
	}

	return info, nil
}

func (m *Manager) Kill(id string) error {
	m.mu.Lock()
	t, ok := m.terminals[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("terminal %q not found", id)
	}
	delete(m.terminals, id)
	m.mu.Unlock()

	t.mu.Lock()
	defer t.mu.Unlock()

	t.ptmx.Close()
	t.cmd.Process.Signal(os.Interrupt)
	return nil
}

func (m *Manager) Write(id string, data []byte) error {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	_, err := t.ptmx.Write(data)
	return err
}

func (m *Manager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	return pty.Setsize(t.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (m *Manager) StartReadLoop(id string, onOutput func([]byte)) {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return
	}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := t.ptmx.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				onOutput(data)
			}
			if err != nil {
				return
			}
		}
	}()
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.terminals))
	for id := range m.terminals {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		m.Kill(id)
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/terminal/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/terminal/terminal.go internal/terminal/terminal_test.go
git commit -m "feat: add plain terminal manager with PTY support"
```

---

### Task 4: Wire Plain Terminals into Wails (app.go)

**Files:**
- Modify: `app.go:14-18` (App struct), `app.go:20-31` (NewApp), `app.go:34-70` (Startup)
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add TerminalInfo type to frontend types**

In `frontend/src/lib/types.ts`, add:

```typescript
export interface TerminalInfo {
  id: string;
  work_dir: string;
  pid: number;
}
```

- [ ] **Step 2: Add terminal manager to App struct and wire Wails bindings**

In `app.go`, add the terminal manager field and methods:

```go
import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/andybarilla/jackdaw/internal/config"
	"github.com/andybarilla/jackdaw/internal/session"
	"github.com/andybarilla/jackdaw/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	manager     *session.Manager
	termManager *terminal.Manager
	configPath  string
}

func NewApp() *App {
	home := mustUserHome()
	jackdawDir := filepath.Join(home, ".jackdaw")
	manifestDir := filepath.Join(jackdawDir, "manifests")
	socketDir := filepath.Join(jackdawDir, "sockets")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)

	return &App{
		manager:     session.NewManager(manifestDir, socketDir),
		termManager: terminal.NewManager(),
		configPath:  filepath.Join(jackdawDir, "config.json"),
	}
}
```

Add the `Startup` terminal event handlers inside the existing `Startup` method, after the session event handlers:

```go
	runtime.EventsOn(ctx, "terminal-input", func(data ...interface{}) {
		if len(data) < 2 {
			return
		}
		id, _ := data[0].(string)
		input, _ := data[1].(string)
		// Try session first, then plain terminal
		if err := a.manager.WriteToSession(id, []byte(input)); err != nil {
			a.termManager.Write(id, []byte(input))
		}
	})

	runtime.EventsOn(ctx, "terminal-resize", func(data ...interface{}) {
		if len(data) < 3 {
			return
		}
		id, _ := data[0].(string)
		cols, _ := data[1].(float64)
		rows, _ := data[2].(float64)
		// Try session first, then plain terminal
		if err := a.manager.ResizeSession(id, uint16(cols), uint16(rows)); err != nil {
			a.termManager.Resize(id, uint16(cols), uint16(rows))
		}
	})
```

Note: This replaces the existing `terminal-input` and `terminal-resize` handlers which only route to sessions. The new handlers try sessions first, then fall back to plain terminals.

Add the `CreateTerminal` and `KillTerminal` methods:

```go
func (a *App) CreateTerminal(workDir string) (*terminal.TerminalInfo, error) {
	workDir = expandHome(workDir)
	info, err := a.termManager.Create(workDir)
	if err != nil {
		return nil, err
	}

	a.termManager.StartReadLoop(info.ID, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+info.ID, string(data))
	})

	return info, nil
}

func (a *App) KillTerminal(id string) error {
	return a.termManager.Kill(id)
}
```

Add cleanup in `Shutdown`:

```go
func (a *App) Shutdown(ctx context.Context) {
	a.termManager.CloseAll()
}
```

- [ ] **Step 3: Regenerate Wails JS bindings**

Run: `wails generate module`

- [ ] **Step 4: Verify the build compiles**

Run: `cd frontend && npm run check`

- [ ] **Step 5: Commit**

```bash
git add app.go frontend/src/lib/types.ts frontend/wailsjs/
git commit -m "feat: wire plain terminal create/kill into Wails bindings"
```

---

### Task 5: DragDivider Component

**Files:**
- Create: `frontend/src/lib/DragDivider.svelte`

- [ ] **Step 1: Create DragDivider.svelte**

```svelte
<!-- frontend/src/lib/DragDivider.svelte -->
<script lang="ts">
  interface Props {
    direction: "horizontal" | "vertical";
    onRatioChange: (ratio: number) => void;
  }

  let { direction, onRatioChange }: Props = $props();
  let dragging = $state(false);
  let ghostOffset = $state<number | null>(null);
  let dividerEl: HTMLDivElement;

  function handlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    dragging = true;
    dividerEl.setPointerCapture(event.pointerId);

    const parent = dividerEl.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    function handlePointerMove(e: PointerEvent): void {
      if (direction === "vertical") {
        ghostOffset = e.clientX - rect.left;
      } else {
        ghostOffset = e.clientY - rect.top;
      }
    }

    function handlePointerUp(e: PointerEvent): void {
      dividerEl.releasePointerCapture(e.pointerId);
      dragging = false;

      if (ghostOffset !== null) {
        const total = direction === "vertical" ? rect.width : rect.height;
        if (total > 0) {
          onRatioChange(ghostOffset / total);
        }
      }
      ghostOffset = null;

      dividerEl.removeEventListener("pointermove", handlePointerMove);
      dividerEl.removeEventListener("pointerup", handlePointerUp);
    }

    dividerEl.addEventListener("pointermove", handlePointerMove);
    dividerEl.addEventListener("pointerup", handlePointerUp);
  }

  function handleDblClick(): void {
    onRatioChange(0.5);
  }
</script>

<div
  class="divider"
  class:vertical={direction === "vertical"}
  class:horizontal={direction === "horizontal"}
  class:dragging
  bind:this={dividerEl}
  onpointerdown={handlePointerDown}
  ondblclick={handleDblClick}
  role="separator"
  aria-orientation={direction}
>
  {#if dragging && ghostOffset !== null}
    <div
      class="ghost"
      style={direction === "vertical"
        ? `left: ${ghostOffset}px; top: 0; bottom: 0; width: 2px;`
        : `top: ${ghostOffset}px; left: 0; right: 0; height: 2px;`}
    ></div>
  {/if}
</div>

<style>
  .divider {
    flex-shrink: 0;
    position: relative;
    z-index: 2;
  }

  .divider.vertical {
    width: 4px;
    cursor: col-resize;
  }

  .divider.horizontal {
    height: 4px;
    cursor: row-resize;
  }

  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  .ghost {
    position: fixed;
    background: var(--accent);
    opacity: 0.6;
    pointer-events: none;
    z-index: 100;
  }
</style>
```

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/DragDivider.svelte
git commit -m "feat: add DragDivider component with ghost line resize"
```

---

### Task 6: QuickPicker Component

**Files:**
- Create: `frontend/src/lib/QuickPicker.svelte`

- [ ] **Step 1: Create QuickPicker.svelte**

```svelte
<!-- frontend/src/lib/QuickPicker.svelte -->
<script lang="ts">
  type PaneChoice = "terminal" | "session";

  interface Props {
    onSelect: (choice: PaneChoice) => void;
  }

  let { onSelect }: Props = $props();
</script>

<div class="quick-picker">
  <div class="picker-label">Open in this pane</div>
  <div class="picker-options">
    <button class="picker-btn terminal" onclick={() => onSelect("terminal")}>
      Terminal
    </button>
    <button class="picker-btn session" onclick={() => onSelect("session")}>
      Claude
    </button>
  </div>
</div>

<style>
  .quick-picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
  }

  .picker-label {
    color: var(--text-muted);
    font-size: 13px;
  }

  .picker-options {
    display: flex;
    gap: 8px;
  }

  .picker-btn {
    padding: 8px 20px;
    border-radius: 6px;
    border: 1px solid;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
  }

  .picker-btn.terminal {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .picker-btn.terminal:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .picker-btn.session {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 40%, transparent);
  }

  .picker-btn.session:hover {
    background: color-mix(in srgb, var(--success) 10%, transparent);
  }
</style>
```

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/QuickPicker.svelte
git commit -m "feat: add QuickPicker component for empty pane launcher"
```

---

### Task 7: PaneContainer Component

**Files:**
- Create: `frontend/src/lib/PaneContainer.svelte`

- [ ] **Step 1: Create PaneContainer.svelte**

```svelte
<!-- frontend/src/lib/PaneContainer.svelte -->
<script lang="ts">
  import type { PaneContent } from "./layout";
  import type { TerminalApi } from "./types";
  import Terminal from "./Terminal.svelte";
  import SearchBar from "./SearchBar.svelte";
  import QuickPicker from "./QuickPicker.svelte";

  interface Props {
    content: PaneContent;
    focused: boolean;
    searchVisible: boolean;
    terminalApi: TerminalApi | null;
    onFocus: () => void;
    onQuickPick: (choice: "terminal" | "session") => void;
    onTerminalReady: (api: TerminalApi) => void;
  }

  let {
    content,
    focused,
    searchVisible,
    terminalApi,
    onFocus,
    onQuickPick,
    onTerminalReady,
  }: Props = $props();

  let contentId = $derived(
    content === null
      ? null
      : content.type === "session"
        ? content.sessionId
        : content.id,
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pane-container" class:focused onclick={onFocus}>
  {#if content === null}
    <QuickPicker onSelect={onQuickPick} />
  {:else if contentId}
    <Terminal
      sessionId={contentId}
      visible={true}
      onReady={onTerminalReady}
    />
    {#if searchVisible && terminalApi}
      <SearchBar
        searchAddon={terminalApi.searchAddon}
        onClose={() => {
          terminalApi?.focus();
        }}
      />
    {/if}
  {/if}
</div>

<style>
  .pane-container {
    width: 100%;
    height: 100%;
    position: relative;
    border: 1px solid transparent;
    box-sizing: border-box;
    overflow: hidden;
  }

  .pane-container.focused {
    border-color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/PaneContainer.svelte
git commit -m "feat: add PaneContainer component wrapping terminal/picker"
```

---

### Task 8: SplitPane Component

**Files:**
- Create: `frontend/src/lib/SplitPane.svelte`

- [ ] **Step 1: Create SplitPane.svelte**

```svelte
<!-- frontend/src/lib/SplitPane.svelte -->
<script lang="ts">
  import type { LayoutNode, PaneContent } from "./layout";
  import type { TerminalApi } from "./types";
  import PaneContainer from "./PaneContainer.svelte";
  import DragDivider from "./DragDivider.svelte";

  interface Props {
    node: LayoutNode;
    path: number[];
    focusedPath: number[];
    searchVisible: boolean;
    terminalApis: Record<string, TerminalApi>;
    onFocus: (path: number[]) => void;
    onRatioChange: (path: number[], ratio: number) => void;
    onQuickPick: (path: number[], choice: "terminal" | "session") => void;
    onTerminalReady: (id: string, api: TerminalApi) => void;
  }

  let {
    node,
    path,
    focusedPath,
    searchVisible,
    terminalApis,
    onFocus,
    onRatioChange,
    onQuickPick,
    onTerminalReady,
  }: Props = $props();

  function isFocused(leafPath: number[]): boolean {
    if (leafPath.length !== focusedPath.length) return false;
    return leafPath.every((v, i) => v === focusedPath[i]);
  }

  function getContentId(content: PaneContent): string | null {
    if (content === null) return null;
    return content.type === "session" ? content.sessionId : content.id;
  }
</script>

{#if node.type === "leaf"}
  {@const contentId = getContentId(node.content)}
  <PaneContainer
    content={node.content}
    focused={isFocused(path)}
    searchVisible={searchVisible && isFocused(path)}
    terminalApi={contentId ? terminalApis[contentId] ?? null : null}
    onFocus={() => onFocus(path)}
    onQuickPick={(choice) => onQuickPick(path, choice)}
    onTerminalReady={(api) => {
      if (contentId) onTerminalReady(contentId, api);
    }}
  />
{:else}
  <div
    class="split-container"
    class:vertical={node.direction === "vertical"}
    class:horizontal={node.direction === "horizontal"}
  >
    <div
      class="split-child"
      style={node.direction === "vertical"
        ? `width: ${node.ratio * 100}%`
        : `height: ${node.ratio * 100}%`}
    >
      <svelte:self
        node={node.children[0]}
        path={[...path, 0]}
        {focusedPath}
        {searchVisible}
        {terminalApis}
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
      />
    </div>

    <DragDivider
      direction={node.direction}
      onRatioChange={(ratio) => onRatioChange(path, ratio)}
    />

    <div
      class="split-child"
      style={node.direction === "vertical"
        ? `width: ${(1 - node.ratio) * 100}%`
        : `height: ${(1 - node.ratio) * 100}%`}
    >
      <svelte:self
        node={node.children[1]}
        path={[...path, 1]}
        {focusedPath}
        {searchVisible}
        {terminalApis}
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
      />
    </div>
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
  }

  .split-container.vertical {
    flex-direction: row;
  }

  .split-container.horizontal {
    flex-direction: column;
  }

  .split-child {
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }
</style>
```

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/SplitPane.svelte
git commit -m "feat: add recursive SplitPane component for layout tree"
```

---

### Task 9: Update Keybindings

**Files:**
- Modify: `frontend/src/lib/keybindings.ts:1-25`

- [ ] **Step 1: Add pane actions to keybindings**

Update `keybindings.ts`:

```typescript
export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "app.toggleSidebar"
  | "terminal.search"
  | "pane.splitVertical"
  | "pane.splitHorizontal"
  | "pane.close"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.focusLeft"
  | "pane.focusRight";

// ... ParsedBinding and Keymap types unchanged ...

export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+K",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
  "terminal.search": "Ctrl+f",
  "pane.splitVertical": "Ctrl+Shift+|",
  "pane.splitHorizontal": "Ctrl+Shift+_",
  "pane.close": "Ctrl+Shift+W",
  "pane.focusUp": "Ctrl+Shift+ArrowUp",
  "pane.focusDown": "Ctrl+Shift+ArrowDown",
  "pane.focusLeft": "Ctrl+Shift+ArrowLeft",
  "pane.focusRight": "Ctrl+Shift+ArrowRight",
};
```

Note: `Ctrl+Shift+|` produces `|` as the key (Shift is inherent in `|`). `Ctrl+Shift+-` produces `_` as the key (Shift+- = `_`). The `matchKeybinding` function already handles this since it compares `event.key`.

Also note: `session.kill` changed from `Ctrl+Shift+W` to `Ctrl+Shift+K` since `Ctrl+Shift+W` is now `pane.close`.

- [ ] **Step 2: Update keybindings test if it references the old bindings**

Run: `cd frontend && npx vitest run src/lib/keybindings.test.ts`
Expected: Check if tests reference `session.kill: Ctrl+Shift+W` — if so, update them to `Ctrl+Shift+K`.

- [ ] **Step 3: Verify all frontend tests pass**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/keybindings.ts frontend/src/lib/keybindings.test.ts
git commit -m "feat: add pane split/close/focus keybindings"
```

---

### Task 10: Rewrite App.svelte with Layout Tree

**Files:**
- Modify: `frontend/src/App.svelte` (full rewrite)

This is the largest task — it replaces the single-session view with the layout tree.

- [ ] **Step 1: Rewrite App.svelte**

```svelte
<!-- frontend/src/App.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import {
    CreateSession,
    ListSessions,
    KillSession,
    RenameSession,
    CreateTerminal,
    KillTerminal,
    GetConfig,
    SetConfig,
  } from "../wailsjs/go/main/App";
  import type { SessionInfo, TerminalApi } from "./lib/types";
  import type { LayoutNode, PaneContent } from "./lib/layout";
  import {
    emptyLeaf,
    splitLeaf,
    closeLeaf,
    updateRatio,
    setLeafContent,
    getLeafContent,
    findLeafBySessionId,
    findLeafByTerminalId,
    collectSessionIds,
    collectTerminalIds,
  } from "./lib/layout";
  import Sidebar from "./lib/Sidebar.svelte";
  import SplitPane from "./lib/SplitPane.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";
  import { getKeymap } from "./lib/config.svelte";
  import { matchKeybinding } from "./lib/keybindings";

  let sessions = $state<SessionInfo[]>([]);
  let layoutTree = $state<LayoutNode>(emptyLeaf());
  let focusedPath = $state<number[]>([]);
  let showNewDialog = $state(false);
  let sidebarVisible = $state(true);
  let searchVisible = $state(false);
  let terminalApis = $state<Record<string, TerminalApi>>({});
  let cleanups: Array<() => void> = [];

  const actions: Record<string, () => void> = {
    "session.new": () => (showNewDialog = true),
    "session.kill": () => {
      const content = getLeafContent(layoutTree, focusedPath);
      if (content?.type === "session") handleKill(content.sessionId);
    },
    "session.next": () => selectAdjacentSession(1),
    "session.prev": () => selectAdjacentSession(-1),
    "app.toggleSidebar": () => (sidebarVisible = !sidebarVisible),
    "terminal.search": () => {
      const content = getLeafContent(layoutTree, focusedPath);
      if (content !== null && content !== undefined) {
        searchVisible = !searchVisible;
      }
    },
    "pane.splitVertical": () => {
      layoutTree = splitLeaf(layoutTree, focusedPath, "vertical");
    },
    "pane.splitHorizontal": () => {
      layoutTree = splitLeaf(layoutTree, focusedPath, "horizontal");
    },
    "pane.close": () => handleClosePane(),
    "pane.focusUp": () => moveFocus("up"),
    "pane.focusDown": () => moveFocus("down"),
    "pane.focusLeft": () => moveFocus("left"),
    "pane.focusRight": () => moveFocus("right"),
  };

  function selectAdjacentSession(delta: number): void {
    if (sessions.length === 0) return;
    const content = getLeafContent(layoutTree, focusedPath);
    const currentId = content?.type === "session" ? content.sessionId : null;
    const currentIndex = currentId
      ? sessions.findIndex((s) => s.id === currentId)
      : -1;
    const nextIndex =
      (currentIndex + delta + sessions.length) % sessions.length;
    const nextSession = sessions[nextIndex];

    // Find or assign the session
    const existingPath = findLeafBySessionId(layoutTree, nextSession.id);
    if (existingPath) {
      focusedPath = existingPath;
    }
  }

  function moveFocus(direction: "up" | "down" | "left" | "right"): void {
    // Collect all leaf paths and their bounding rects, then find the nearest
    // in the given direction. For now, use a simple tree-based approach:
    // navigate to sibling or parent's sibling.
    const allPaths = collectLeafPaths(layoutTree, []);
    if (allPaths.length <= 1) return;

    const currentIdx = allPaths.findIndex(
      (p) => p.length === focusedPath.length && p.every((v, i) => v === focusedPath[i]),
    );
    if (currentIdx === -1) return;

    // Simple: cycle through leaves in order for left/up (prev) and right/down (next)
    const delta = direction === "left" || direction === "up" ? -1 : 1;
    const nextIdx = (currentIdx + delta + allPaths.length) % allPaths.length;
    focusedPath = allPaths[nextIdx];
  }

  function collectLeafPaths(node: LayoutNode, path: number[]): number[][] {
    if (node.type === "leaf") return [path];
    return [
      ...collectLeafPaths(node.children[0], [...path, 0]),
      ...collectLeafPaths(node.children[1], [...path, 1]),
    ];
  }

  async function handleClosePane(): Promise<void> {
    const content = getLeafContent(layoutTree, focusedPath);

    // Kill process in the pane
    if (content?.type === "session") {
      await KillSession(content.sessionId);
    } else if (content?.type === "terminal") {
      await KillTerminal(content.id);
    }

    // Remove terminal API
    if (content !== null && content !== undefined) {
      const id = content.type === "session" ? content.sessionId : content.id;
      delete terminalApis[id];
    }

    layoutTree = closeLeaf(layoutTree, focusedPath);

    // Adjust focused path to be valid
    const allPaths = collectLeafPaths(layoutTree, []);
    if (allPaths.length > 0) {
      focusedPath = allPaths[0];
    } else {
      focusedPath = [];
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const action = matchKeybinding(event, getKeymap());
    if (action && actions[action]) {
      event.preventDefault();
      actions[action]();
    }
  }

  onMount(async () => {
    sessions = ((await ListSessions()) || []) as SessionInfo[];

    // Load persisted layout
    try {
      const cfg = await GetConfig();
      if (cfg.layout) {
        const parsed = JSON.parse(cfg.layout) as LayoutNode;
        if (parsed && parsed.type) {
          layoutTree = parsed;
          // Clean up sessions that no longer exist
          const existingIds = new Set(sessions.map((s) => s.id));
          const layoutSessionIds = collectSessionIds(layoutTree);
          for (const id of layoutSessionIds) {
            if (!existingIds.has(id)) {
              const path = findLeafBySessionId(layoutTree, id);
              if (path) {
                layoutTree = setLeafContent(layoutTree, path, null);
              }
            }
          }
          // Clean up terminal refs (terminals don't survive restart)
          const termIds = collectTerminalIds(layoutTree);
          for (const id of termIds) {
            const path = findLeafByTerminalId(layoutTree, id);
            if (path) {
              layoutTree = setLeafContent(layoutTree, path, null);
            }
          }
        }
      }
    } catch {
      // Ignore layout load errors, use default
    }

    const cancel = EventsOn("sessions-updated", (updated: unknown) => {
      sessions = (updated || []) as SessionInfo[];
    });
    cleanups.push(cancel);
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
  });

  // Persist layout on change
  let persistTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    // Track layoutTree by serializing
    const serialized = JSON.stringify(layoutTree);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      try {
        const cfg = await GetConfig();
        cfg.layout = serialized;
        await SetConfig(cfg);
      } catch {
        // Ignore persist errors
      }
    }, 500);
  });

  async function handleNewSession(workDir: string): Promise<void> {
    showNewDialog = false;
    const info = await CreateSession(workDir);

    // If focused pane is empty, assign there
    const content = getLeafContent(layoutTree, focusedPath);
    if (content === null) {
      layoutTree = setLeafContent(layoutTree, focusedPath, {
        type: "session",
        sessionId: info.id,
      });
    }

    requestAnimationFrame(() => terminalApis[info.id]?.focus());
  }

  async function handleKill(id: string): Promise<void> {
    await KillSession(id);
    // Clear from layout
    const path = findLeafBySessionId(layoutTree, id);
    if (path) {
      layoutTree = setLeafContent(layoutTree, path, null);
    }
    delete terminalApis[id];
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await RenameSession(id, name);
  }

  function handleSidebarSelect(id: string): void {
    // If session is already in a pane, focus it
    const existingPath = findLeafBySessionId(layoutTree, id);
    if (existingPath) {
      focusedPath = existingPath;
      requestAnimationFrame(() => terminalApis[id]?.focus());
      return;
    }

    // If focused pane is empty, assign session there
    const content = getLeafContent(layoutTree, focusedPath);
    if (content === null) {
      layoutTree = setLeafContent(layoutTree, focusedPath, {
        type: "session",
        sessionId: id,
      });
      requestAnimationFrame(() => terminalApis[id]?.focus());
    }
  }

  async function handleQuickPick(
    path: number[],
    choice: "terminal" | "session",
  ): Promise<void> {
    if (choice === "session") {
      showNewDialog = true;
      focusedPath = path;
    } else {
      // Inherit working directory from sibling pane if available
      let workDir = "~";
      if (focusedPath.length > 0) {
        const siblingIdx = focusedPath[focusedPath.length - 1] === 0 ? 1 : 0;
        const siblingPath = [...focusedPath.slice(0, -1), siblingIdx];
        const siblingContent = getLeafContent(layoutTree, siblingPath);
        if (siblingContent?.type === "session") {
          const session = sessions.find((s) => s.id === siblingContent.sessionId);
          if (session) workDir = session.work_dir;
        } else if (siblingContent?.type === "terminal") {
          workDir = siblingContent.workDir;
        }
      }
      const info = await CreateTerminal(workDir);
      layoutTree = setLeafContent(layoutTree, path, {
        type: "terminal",
        id: info.id,
        workDir: info.work_dir,
      });
      focusedPath = path;
    }
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
      activeSessionId={null}
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
      {focusedPath}
      {searchVisible}
      {terminalApis}
      onFocus={(path) => {
        focusedPath = path;
        const content = getLeafContent(layoutTree, path);
        if (content !== null && content !== undefined) {
          const id = content.type === "session" ? content.sessionId : content.id;
          requestAnimationFrame(() => terminalApis[id]?.focus());
        }
      }}
      onRatioChange={(path, ratio) => {
        layoutTree = updateRatio(layoutTree, path, ratio);
      }}
      onQuickPick={handleQuickPick}
      onTerminalReady={(id, api) => {
        terminalApis[id] = api;
      }}
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

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors (may need minor type fixes)

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat: replace single-session view with split-pane layout tree"
```

---

### Task 11: Update Sidebar Click Behavior

**Files:**
- Modify: `frontend/src/lib/Sidebar.svelte:1-15`

- [ ] **Step 1: Update Sidebar props**

The Sidebar no longer needs `activeSessionId` to highlight the "active" session since focus is now pane-based. However, we can still highlight sessions that are visible in any pane. For now, remove the active highlighting — sessions in panes will be indicated by clicking and focusing.

No code changes needed — the `activeSessionId={null}` passed from App.svelte already handles this. The sidebar will show no session as "active" which is correct since the concept is now pane-focused.

- [ ] **Step 2: Verify the sidebar renders correctly with `null` activeSessionId**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: sidebar click behavior verified with layout system"
```

Actually, skip the empty commit. This task is complete without changes since `activeSessionId={null}` is already passed in Task 10.

---

### Task 12: Terminal.svelte — Support Plain Terminal IDs

**Files:**
- Modify: `frontend/src/lib/Terminal.svelte:9`

- [ ] **Step 1: Update Terminal to handle plain terminal IDs**

The Terminal component already uses `sessionId` as a generic identifier for event routing (`terminal-input`, `terminal-output-{id}`, `terminal-resize`). Since the Go backend now routes these events to both session manager and terminal manager (Task 4), the Terminal component works as-is for plain terminals — no code change needed.

However, the `AttachSession` call on line 95 will fail for plain terminals. We need to make it conditional or handle the error gracefully. Update Terminal.svelte:

Replace the `AttachSession(sessionId)` call:

```typescript
      try {
        AttachSession(sessionId);
      } catch {
        // Plain terminals don't need AttachSession — ignore
      }
```

- [ ] **Step 2: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/Terminal.svelte
git commit -m "fix: gracefully handle AttachSession for plain terminals"
```

---

### Task 13: Integration Test — Full App Build and Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Run all Go tests**

Run: `go test ./internal/...`
Expected: All tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Type check frontend**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 4: Build the full app**

Run: `GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: Build succeeds

- [ ] **Step 5: Manual smoke test checklist**

Launch the built app and verify:
- App starts with a single empty pane showing the quick picker
- Click "Terminal" → plain terminal opens in the pane
- `Ctrl+Shift+|` → splits vertically, new empty pane on right with quick picker
- Click "Claude" in new pane → New Session dialog appears, create session
- Session appears in sidebar
- Click sidebar session → focuses the pane containing it
- Drag divider between panes → ghost line appears, resize on release
- Double-click divider → resets to 50/50
- `Ctrl+Shift+-` → splits horizontally
- `Ctrl+Shift+Arrow` → navigates between panes
- `Ctrl+Shift+W` → closes focused pane, sibling expands
- Close last pane → becomes empty pane (never zero)
- Kill session from sidebar → pane becomes empty

- [ ] **Step 6: Commit any fixes found during smoke test**

```bash
git add -A
git commit -m "fix: smoke test fixes for multi-session layout"
```

---

## Task Dependency Summary

```
Task 1 (layout.ts)           — independent
Task 2 (config layout)       — independent
Task 3 (terminal backend)    — independent
Task 4 (app.go wiring)       — depends on Task 3
Task 5 (DragDivider)         — independent
Task 6 (QuickPicker)         — independent
Task 7 (PaneContainer)       — depends on Tasks 5, 6
Task 8 (SplitPane)           — depends on Task 7
Task 9 (keybindings)         — independent
Task 10 (App.svelte rewrite) — depends on Tasks 1, 4, 8, 9
Task 11 (Sidebar update)     — depends on Task 10
Task 12 (Terminal.svelte)    — depends on Task 4
Task 13 (integration test)   — depends on all
```

Parallelizable groups:
- **Group A** (independent): Tasks 1, 2, 3, 5, 6, 9
- **Group B** (after Group A): Tasks 4, 7, 8
- **Group C** (after Group B): Tasks 10, 12
- **Group D** (after Group C): Tasks 11, 13
