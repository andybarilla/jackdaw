# Multi-session Layout Design

Split panes with a binary tree layout so multiple terminals are visible simultaneously.

## Data Model

The layout is a binary tree:

```typescript
type LayoutNode =
  | { type: "leaf"; sessionId: string | null }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number; // 0–1, e.g. 0.5 = even split
      children: [LayoutNode, LayoutNode];
    };
```

- A `leaf` with `sessionId: null` is an empty pane (placeholder state before auto-close).
- The root starts as `{ type: "leaf", sessionId: null }`.
- **Split:** Replace a leaf with a split node. The original session stays in one child; the new session goes in the other.
- **Close:** Replace the parent split with the surviving sibling. If the root leaf is closed, reset to a single empty leaf.

## Components

### New Components

**`SplitPane.svelte`** — Recursive component rendering a `LayoutNode`. Splits render two children with a `DragDivider` between them. Leaves render a `PaneContainer`.

**`PaneContainer.svelte`** — Single pane slot containing:
- Tab bar (28px, `--bg-secondary` background) with session name, status dot, close button
- Terminal instance (or empty-state placeholder if `sessionId` is null)
- Drop zone highlighting for drag-and-drop from sidebar
- Focused/unfocused border (accent color when focused)

**`DragDivider.svelte`** — Resize handle between split children. 3–4px bar, expands on hover, highlights with accent color. Updates parent split's `ratio` on drag. Minimum pane size: 80px. Double-click resets to 0.5.

### Modified Components

**`App.svelte`** — Replace the `{#each sessions}` terminal loop with `<SplitPane node={layoutTree} />`. The `activeSessionId` concept becomes "focused pane" (whichever leaf last received focus). Layout tree is reactive state, persisted on change.

**`Terminal.svelte`** — No structural changes. Mounted/unmounted by `PaneContainer` based on leaf `sessionId`. Existing `FitAddon` + `ResizeObserver` handles dynamic sizing.

**`Sidebar.svelte`** — Add drag support on session items. Clicking a session assigns it to the focused pane.

## Interactions

### Splitting

- `Ctrl+Shift+D` → split focused pane right (horizontal). New keymap action: `pane.splitRight`.
- `Ctrl+Shift+E` → split focused pane down (vertical). New keymap action: `pane.splitDown`.
- New pane starts as empty leaf (`sessionId: null`).

### Assigning Sessions to Panes

- **Sidebar click:** Assigns session to the focused pane (replaces current session).
- **Drag from sidebar:** Drop onto a pane center to assign, or onto a pane edge to split-and-assign (left/right edges → horizontal split, top/bottom edges → vertical split).
- **New session created:** Goes into focused pane if empty, otherwise splits focused pane right.

### Focus

- Click inside a pane to focus it. Focused pane gets accent-color border.
- `Ctrl+Shift+Arrow` moves focus between panes spatially (traverses tree). New keymap actions: `pane.focusUp`, `pane.focusDown`, `pane.focusLeft`, `pane.focusRight`.
- Sidebar highlights the session in the focused pane.

### Resizing

- Drag dividers to resize. Minimum pane size: 80px.
- Double-click divider to reset to 50/50.

### Closing Panes

- **Session exits:** Pane shows frozen last output with subtle overlay for 5 seconds. Toast appears: "Pane closed · Undo (5s)". After timeout, pane collapses — parent split replaced by surviving sibling.
- **Manual close:** `Ctrl+Shift+W` closes focused pane. Same undo toast. New keymap action: `pane.close`.
- **Last pane closed:** Resets to single empty leaf.

## Tab Bar

Each `PaneContainer` has a tab bar header:
- 28px height, `--bg-secondary` background
- Shows: status dot, session name, close button (x)
- Empty pane shows "Empty" in muted text
- Double-click session name triggers inline rename (same as sidebar)
- Close button triggers pane close with undo toast
- Currently one tab per pane. The tab bar is designed to support multiple tabs per pane in the future.

## Persistence

Layout tree serialized to JSON in app config alongside theme/keybindings:

```json
{
  "theme": "whattheflock",
  "keybindings": {},
  "layout": {
    "type": "split",
    "direction": "horizontal",
    "ratio": 0.5,
    "children": [
      { "type": "leaf", "sessionId": "abc-123" },
      { "type": "leaf", "sessionId": "def-456" }
    ]
  }
}
```

Saved on every layout mutation (split, close, resize, session assignment).

### Startup Restoration

1. Load layout tree from config.
2. Load recovered sessions from the manager.
3. Walk tree — keep leaves whose `sessionId` exists in recovered sessions. Set others to `null`.
4. Prune: collapse splits with two null leaves into single null leaf. Repeat until stable.
5. If entire tree is a single null leaf, show empty state ("Launch a new session").

No saved layout (fresh install): default to `{ type: "leaf", sessionId: null }`.

## New Keybindings

| Action | Default | Description |
|---|---|---|
| `pane.splitRight` | `Ctrl+Shift+D` | Split focused pane horizontally |
| `pane.splitDown` | `Ctrl+Shift+E` | Split focused pane vertically |
| `pane.close` | `Ctrl+Shift+W` | Close focused pane |
| `pane.focusUp` | `Ctrl+Shift+Up` | Move focus up |
| `pane.focusDown` | `Ctrl+Shift+Down` | Move focus down |
| `pane.focusLeft` | `Ctrl+Shift+Left` | Move focus left |
| `pane.focusRight` | `Ctrl+Shift+Right` | Move focus right |

All configurable through the existing keymap system.
