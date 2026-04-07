# Multi-Session Layout v2 — Design Spec

## Overview

Split-pane layout system for Jackdaw. Panes are arranged in a binary tree — each pane can split horizontally or vertically, enabling any arrangement. Panes hold either a managed session (Claude, future Codex/Opencode) or a plain terminal.

Primary use case: a Claude session alongside a companion terminal in the same working directory for running commands, checking output, tailing logs.

## Data Model

```typescript
type PaneContent =
  | { type: "session"; sessionId: string }
  | { type: "terminal"; id: string; workDir: string }
  | null

type LayoutNode =
  | { type: "leaf"; content: PaneContent }
  | { type: "split"; direction: "horizontal" | "vertical"; ratio: number; children: [LayoutNode, LayoutNode] }
```

- `session` — managed by SessionManager, appears in sidebar, persisted via manifests
- `terminal` — lightweight shell process, pane-scoped, no sidebar presence, no persistence
- `null` — empty pane, shows quick picker

App starts with `{ type: "leaf", content: null }`.

## Pane Types

### Managed Sessions

Created via sidebar "New Session" button or quick picker "Claude" option. Full lifecycle: manifest, recovery, sidebar entry, status indicators. Work exactly as today.

### Plain Terminals

Created via quick picker "Terminal" option. Spawns a shell in the working directory. No manifest, no recovery, no sidebar entry. Killing the pane kills the process.

### Quick Picker

Shown when `content: null`. Two buttons: "Terminal" and "Claude". Appears on:
- Fresh app start (single empty pane)
- New pane after split
- Future: extensible for Codex, Opencode, etc.

Working directory for new terminals/sessions: inherited from the sibling pane's working directory if available, otherwise the app's default working directory.

## Keybindings

| Action | Binding |
|--------|---------|
| Split vertical (new pane right) | `Ctrl+Shift+\|` |
| Split horizontal (new pane below) | `Ctrl+Shift+-` |
| Close pane | `Ctrl+Shift+W` |
| Move focus | `Ctrl+Shift+Arrow` |

## Split Operations

- Splitting the focused pane wraps it in a split node. The current pane keeps its content; the new child gets `content: null`.
- Initial ratio is 0.5.
- Focus stays on the original pane after split.

## Focus

- One pane is always focused, tracked by tree path (`number[]`).
- Focused pane has a visible border accent.
- `Ctrl+Shift+Arrow` navigates spatially (finds nearest pane in that direction), not by tree structure.
- Clicking a pane focuses it.

## Close Behavior

- `Ctrl+Shift+W` closes the focused pane.
- If the pane has a running process (session or terminal), the process is killed.
- The sibling pane expands to fill the space (parent split node replaced by surviving child).
- If only one pane remains and it's closed, it becomes an empty pane (never zero panes).

## Resize

- Drag divider between panes to adjust split ratio.
- Ghost divider shown during drag; ratio applied on mouse release (no live terminal reflow).
- Double-click divider to reset ratio to 0.5.
- Divider is 4px wide/tall, expands hit target on hover.

## Sidebar Integration

The sidebar shows only managed sessions, not plain terminals.

- **Click session in sidebar:**
  - Already in a pane → focus that pane
  - Focused pane is empty → assign session to it
  - Focused pane has content → no action
- **New Session button:** Creates session. If focused pane is empty, assigns there. Otherwise session is created but unassigned.
- **Kill session from sidebar:** Kills process, clears from any pane (pane becomes empty).

## Go-Side Changes

### New: Plain Terminal Support

```go
// New Wails-bound methods
CreateTerminal(workDir string) (TerminalInfo, error)
KillTerminal(id string) error
```

Spawns a shell with a PTY using the same mechanics as `session.Session` but without manifest, recovery, or SessionManager tracking. Events: `terminal-output-{id}`, `terminal-input`, `terminal-resize`.

### Config: Layout Persistence

Add `Layout json.RawMessage` field to the Config struct. The layout tree is serialized as JSON and persisted alongside theme and keybindings via existing `GetConfig()`/`SetConfig()` methods.

### Unchanged

SessionManager, manifests, and recovery are untouched.

## Frontend Components

| Component | Responsibility |
|-----------|---------------|
| `App.svelte` | Owns layout tree state, keybinding handlers, focus tracking, layout persistence |
| `SplitPane.svelte` | Recursive renderer — leaf → `PaneContainer`, split → two children + `DragDivider` |
| `PaneContainer.svelte` | Single pane wrapper, renders `QuickPicker` / `Terminal` based on content, focus border |
| `QuickPicker.svelte` | "Terminal" / "Claude" launcher menu for empty panes |
| `DragDivider.svelte` | Draggable separator with ghost line, double-click reset |
| `Terminal.svelte` | Existing xterm.js wrapper, unchanged |
| `Sidebar.svelte` | Minor: click behavior updated for pane assignment |
| `layout.ts` | Pure functions: `splitLeaf`, `closeLeaf`, `updateRatio`, `findLeaf`, `pruneEmptyBranches` |

## Out of Scope

- **Layout recovery on restart** — deferred to Session History roadmap item
- **Drag-and-drop from sidebar to panes** — future enhancement
- **Tab bar per pane** — not needed without multi-tab; revisit if pane content types grow
- **Configurable default on split** — future preference setting to skip quick picker
- **Customizable keybindings** — future, Jackdaw already has keybinding config infrastructure
