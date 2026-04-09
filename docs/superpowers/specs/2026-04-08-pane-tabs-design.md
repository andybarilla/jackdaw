# Pane Tabs

## Problem

Each pane can hold only one piece of content. To view multiple sessions side-by-side you must split panes, consuming screen real estate. There's no way to stack multiple sessions in one pane and switch between them.

## Design

Add tabs to panes. A pane becomes a container for multiple content items, with a tab bar for switching between them.

### Data Model

The leaf node changes from holding a single `content` to holding a list:

```typescript
// Before
type LayoutNode = { type: "leaf"; content: PaneContent }

// After
type LayoutNode = { type: "leaf"; contents: PaneContent[]; activeIndex: number }
```

- Empty pane: `contents: [], activeIndex: 0`
- Single item: `contents: [item], activeIndex: 0` -- no tab bar rendered
- Multiple items: tab bar shown above content

`PaneContent` type is unchanged. `null` is no longer a valid array element -- an empty pane is represented by an empty array.

### Tab Bar

- Appears only when `contents.length >= 2`
- ~28px height, compact to preserve terminal space
- Each tab shows the session name (from `SessionInfo.name`), truncated with ellipsis
- Plain terminals show "Terminal" as the tab label
- Diff tabs show "Diff: {session name}"
- Active tab has an accent-colored bottom border
- X button appears on hover to close the tab

### Tab Close Behavior

Closing a tab (X button) **detaches** it from the pane -- it does NOT kill the session. The session remains in the sidebar and can be re-opened.

Exception: plain terminal tabs (type `"terminal"`) have no sidebar presence, so closing them kills the terminal process.

Closing the last tab returns the pane to the empty/quick-picker state.

`Ctrl+Shift+W` (pane.close) kills the **active tab's** process and removes that tab. If it was the last tab, the pane collapses from the layout tree. If other tabs remain, the pane stays with the next tab activated.

### Tab Reordering

Drag-and-drop within a pane to reorder tabs. No cross-pane dragging.

### Keyboard Shortcuts

- `Alt+Shift+]`: next tab in focused pane (`tab.next`)
- `Alt+Shift+[`: previous tab in focused pane (`tab.prev`)

(Ctrl+Tab is intercepted by WebKit/WebView before JavaScript, so we use Alt+Shift instead.)

### Sidebar Click Behavior

1. Session already open in any pane tab? Focus that pane and switch `activeIndex` to that tab.
2. Otherwise, add as a new tab in the focused pane (appended to `contents`, becomes active).

### Sidebar Kill Button

Kills the session process and removes its tab from whichever pane contains it. Same removal logic as session exit.

### Session/Terminal Exit

When a session exits or a terminal exits, its tab is removed from whichever pane contains it. If it was the last tab, the pane becomes empty (shows quick-picker).

### session.next / session.prev

These already cycle through sessions in the sidebar. When the target session is in a background tab, focus the pane AND switch `activeIndex` to that tab.

### session.viewDiff

If the session is in any tab (active or background), add the diff as a new tab in the same pane (don't split). If the session is not in any pane, put the diff in the focused pane as a new tab.

### unsplitPane

`unsplitPane` collects detached content from the sibling subtree. With tabs, `collectLeaves` returns all `PaneContent` items from all tabs in all leaves. Detached items are silently dropped (same as current behavior -- the sessions remain in the sidebar).

### Layout Helper Changes

All `layout.ts` functions that operate on `content` must be updated for the `contents[]` model:

- `emptyLeaf()` returns `{ type: "leaf", contents: [], activeIndex: 0 }`
- `getLeafContent()` returns `contents[activeIndex]` or `null` if empty
- `findLeafBySessionId()` returns `{ path: Path; tabIndex: number } | null` -- searches all tabs in all leaves
- `findLeafByTerminalId()` same return type change
- `findLeafByDiffSessionId()` same return type change
- New: `addTab(node, path, content)` -- appends to `contents[]`, sets `activeIndex` to new tab
- New: `removeTab(node, path, tabIndex)` -- removes tab, adjusts `activeIndex`
- New: `setActiveTab(node, path, tabIndex)` -- sets `activeIndex`
- `setLeafContent()` retained for replacing a specific tab or setting single content
- `collectSessionIds()` collects from all tabs in all leaves
- `collectTerminalIds()` same
- `collectDiffSessionIds()` same
- `collectLeaves()` returns all `PaneContent` items from all tabs

### PaneContainer Changes

`PaneContainer.svelte` receives the full `contents[]` array and `activeIndex` instead of a single `content`. It renders:

1. Tab bar (if `contents.length >= 2`) with tab labels, close buttons, drag handles
2. The active content below the tab bar

New props: `contents`, `activeIndex`, `onTabClose`, `onTabReorder`, `onTabSelect`.

### Layout Migration

On startup, detect old-format leaves (presence of `content` key instead of `contents`). Convert:
- `{ type: "leaf", content: null }` -> `{ type: "leaf", contents: [], activeIndex: 0 }`
- `{ type: "leaf", content: X }` -> `{ type: "leaf", contents: [X], activeIndex: 0 }`

This runs once during `onMount` layout loading, before any other cleanup.

### Persisted Layout

The layout is already persisted to config. The new `contents[]` / `activeIndex` structure will serialize naturally since it's still a plain object. On startup, the existing cleanup logic must iterate all tabs in each leaf (not just a single content).

## Files Modified

- `frontend/src/lib/layout.ts` -- data model change, updated helpers, migration function
- `frontend/src/lib/PaneContainer.svelte` -- tab bar rendering, tab interactions
- `frontend/src/lib/TabBar.svelte` -- new component for the tab strip
- `frontend/src/lib/SplitPane.svelte` -- pass `contents[]` instead of `content`
- `frontend/src/App.svelte` -- sidebar click adds tab, session exit removes tab, keyboard shortcuts, startup cleanup, handleKill, session.next/prev, viewDiff
- `frontend/src/lib/keybindings.ts` -- add `tab.next`, `tab.prev` actions

## Testing

- Unit tests for `layout.ts`: verify `addTab`, `removeTab`, `setActiveTab`, find-by-id searches across multiple tabs, migration from old format
- Manual: open multiple sessions as tabs, verify tab switching, close, reorder, keyboard shortcuts, session exit cleanup, layout persistence across restart
