# Multi-Agent Orchestration View

Tree visualization of parent→subagent relationships. The sidebar indents child sessions under their parent, and a "Tree" tab on the parent's detail area shows a horizontal tree with interactive nodes.

## Data Model

### `parent_session_id` on Session

Add `parent_session_id: Option<String>` to `Session` in `state.rs`. Serialized to the frontend as `parent_session_id: string | null`. Not persisted to the database — relationships are ephemeral and don't survive restart.

### Setting the parent (hybrid approach)

**Explicit (Jackdaw-spawned terminals):** When `spawn_terminal` creates a child session, the caller knows the parent. The `spawn_terminal` command already takes a `session_id` parameter for the parent. Set `parent_session_id` on the spawned session.

**Heuristic (external subagents):** When a `SubagentStart` event arrives for session X (incrementing `active_subagents`), record `(X.session_id, timestamp)` in a pending list on `AppState`. When a new `SessionStart` event arrives, check if any pending subagent start from the same `cwd` occurred within the last 2 seconds. If so, set the new session's `parent_session_id` to the pending entry's session_id and remove it from the list.

### Pending subagent starts

Add to `AppState`:

```rust
pub pending_subagent_starts: Mutex<Vec<(String, String, DateTime<Utc>)>>,
// (parent_session_id, cwd, timestamp)
```

On `SubagentStart`: push `(session_id, cwd, now)`.
On `SessionStart` for a new session: check pending list for matching `cwd` within 2 seconds, set `parent_session_id`, remove entry.
Periodically or on each event: prune entries older than 5 seconds.

### Frontend type

Add to `Session` in `types.ts`:

```typescript
parent_session_id: string | null;
```

## Sidebar: Indented Children

### Grouping changes

Modify `grouping.ts`'s `buildRenderList` to add a parent-child pass:

1. Identify child sessions (those with `parent_session_id` matching an active session).
2. Exclude children from normal cwd grouping.
3. Attach children to their parent in render order.
4. Children sorted by `started_at` ascending under their parent.

If a parent is dismissed or ends, children become top-level (orphaned gracefully — `parent_session_id` still set but no matching session found, so they render normally).

### Rendering

Child sessions render indented (~20px left margin) under their parent in the sidebar list. A thin vertical connector line (CSS `border-left`) runs from the parent to its children. Children use the existing `compact` card mode.

No deeper nesting — design optimized for 1 level deep. If a child itself has subagents, its `active_subagents` badge shows the count but children-of-children render at the same indent level (flat under the grandparent).

## Tree Detail Tab

### Tab behavior

When a session has `active_subagents > 0` or has children (derived from the session list), a "Tree" tab appears in the detail area tab bar alongside "Detail" and "Terminal". Clicking it shows the tree view. The tab disappears when the session has no children and `active_subagents === 0`.

### Layout

Horizontal tree: parent node on the left, child nodes branching to the right. Connected by CSS lines (border-based, no canvas/SVG).

### Tree nodes

Each node is a small card showing:
- **Session name**: `display_name` or project name from `cwd`
- **State badge**: RUNNING (pink), APPROVAL (yellow), INPUT (gray), with matching border color
- **Current tool + summary**: tool name and truncated summary, same as SessionCard's tool row
- **Action buttons**: Dismiss, Open Terminal. Same callbacks as SessionCard.

### Interactivity

- **Click a node** → selects that session in the sidebar, switches to its Detail tab
- **Dismiss button** → dismisses that specific session (same as SessionCard dismiss)
- **Terminal button** → opens/focuses shell terminal for that session (same as SessionCard)

### New component: `AgentTree.svelte`

Props:

```typescript
interface Props {
  parentSession: Session;
  childSessions: Session[];
  onDismiss: (sessionId: string) => void;
  onSelect: (sessionId: string) => void;
  onOpenShell: (sessionId: string) => void;
}
```

Renders the horizontal tree layout. Each node is a `TreeNode.svelte` sub-component.

### New component: `TreeNode.svelte`

Props:

```typescript
interface Props {
  session: Session;
  onDismiss: (sessionId: string) => void;
  onSelect: (sessionId: string) => void;
  onOpenShell: (sessionId: string) => void;
}
```

Renders a single node card with state-colored border, tool display, and action buttons.

## Dashboard Integration

The Dashboard already manages tab state per session (`Record<string, 'detail' | 'terminal'>`). Extend the tab type to include `'tree'`:

```typescript
type SessionTab = 'detail' | 'terminal' | 'tree';
```

Derive `childSessions` for the selected session:

```typescript
let childSessions = $derived(
  sessionStore.sessions.filter(s => s.parent_session_id === selectedSession?.session_id)
);
```

Show the Tree tab button when `childSessions.length > 0` or `selectedSession.active_subagents > 0`.

## Testing

### Rust unit tests

- `parent_session_id` defaults to `None` on `Session::new()`
- `parent_session_id` serializes as `null` when None, string when Some
- Pending subagent start matching: correct parent assigned when cwd matches within 2s window
- Pending subagent start pruning: entries older than 5s removed
- No match when cwd differs
- No match when timestamp outside 2s window

### Frontend tests (Vitest)

- Grouping: child sessions excluded from cwd groups, attached to parent
- Grouping: orphaned children (parent dismissed) render as top-level
- TreeNode renders session name, state badge, current tool
- TreeNode renders action buttons (dismiss, terminal)
- AgentTree renders parent and children with connectors
- Dashboard shows Tree tab when session has children
- Dashboard hides Tree tab when session has no children and no active subagents
