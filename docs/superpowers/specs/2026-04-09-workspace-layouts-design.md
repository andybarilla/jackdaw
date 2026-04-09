# Per-Workspace Pane Layouts

## Problem

All workspaces share a single pane layout. Switching workspaces shows irrelevant sessions from other workspaces in the layout, and the user loses their carefully arranged pane setup when switching.

## Solution

Store a separate `LayoutNode` per workspace. On workspace switch, save the current layout tree to the old workspace and load the layout tree for the new workspace.

## Architecture

### Config Changes (Go)

Add `WorkspaceLayouts map[string]json.RawMessage` to `Config` struct. The existing `Layout json.RawMessage` field stays for one-time migration on first load.

```go
type Config struct {
    // ... existing fields ...
    Layout           json.RawMessage            `json:"layout,omitempty"`           // deprecated, migrated on startup
    WorkspaceLayouts map[string]json.RawMessage  `json:"workspace_layouts,omitempty"`
}
```

No new Go methods needed. The frontend reads/writes `workspace_layouts` via the existing `GetConfig`/`SetConfig` bindings.

### Frontend Changes (App.svelte)

**Startup migration:**
1. Load config
2. If `workspace_layouts` is absent/empty but `layout` exists, migrate: `workspace_layouts[activeWorkspaceId] = layout`, clear `layout`
3. Load `workspace_layouts[activeWorkspaceId]` as `layoutTree` (or `emptyLeaf()` if none)
4. Apply existing stale-session cleanup to the loaded layout

**Workspace switch (`handleSwitchWorkspace`):**
1. Save current `layoutTree` to `workspace_layouts[activeWorkspaceId]` in config
2. Call `SetActiveWorkspace(id)` (existing)
3. Load `workspace_layouts[id]` from config as new `layoutTree` (or `emptyLeaf()`)
4. Clean stale sessions from the loaded layout (same logic as startup)
5. Respawn terminal tabs (same logic as startup)
6. Reset `focusedPath` to first leaf

**Layout persistence (`$effect`):**
The existing debounced save effect saves `layoutTree` to config. Change it to save into `workspace_layouts[activeWorkspaceId]` instead of the top-level `layout` key.

### Data Flow

```
workspace switch (old → new)
  ├─ save layoutTree → config.workspace_layouts[oldId]
  ├─ SetActiveWorkspace(newId)
  ├─ load config.workspace_layouts[newId] → layoutTree
  ├─ clean stale sessions / respawn terminals
  └─ reset focusedPath
```

### What Stays Global

- `sidebar_width` — same across all workspaces
- `sidebarVisible` — ephemeral UI state, not persisted per-workspace

## Constraints

- No new Go API methods — use existing `GetConfig`/`SetConfig`
- No new files — changes only to `config.go` and `App.svelte`
- Migration is idempotent — running it twice has no effect
- Deleting a workspace does not need to clean up its layout entry (orphaned entries are harmless)

## Testing

- Go: unit test that `WorkspaceLayouts` round-trips through `Load`/`Save`
- Manual: verify layout persists per workspace across switches and app restarts
- Manual: verify old global `layout` migrates correctly on first startup
