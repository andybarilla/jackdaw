# Workspaces

## Purpose

Group sessions into named workspaces so the sidebar only shows sessions relevant to the current context. Switching workspaces changes which sessions are visible and which workspace new sessions are assigned to.

## Data Model

### Workspace Definition

```
WorkspaceID: string (UUID or nanoid)
Name: string
Order: int (for display ordering and Ctrl+N shortcuts)
```

A "Default" workspace is auto-created on first launch. It cannot be deleted. All pre-existing sessions (those with no workspace ID in their manifest) are assigned to "Default" during migration.

### Session-to-Workspace Association

Each session belongs to exactly one workspace. The workspace ID is stored in:

- **Runtime:** `SessionInfo.WorkspaceID string` field
- **Persistence:** `Manifest.WorkspaceID string` field in `~/.jackdaw/manifests/<id>.json`

Sessions created while a workspace is active are automatically assigned to that workspace.

### Config Storage

`~/.jackdaw/config.json` gains a new top-level field:

```json
{
  "workspaces": [
    { "id": "abc123", "name": "Default" },
    { "id": "def456", "name": "Project X" }
  ],
  "active_workspace_id": "abc123"
}
```

Array order determines display order and Ctrl+N shortcut mapping. The `active_workspace_id` persists across restarts.

## Backend Changes

### Config (`internal/config/config.go`)

Add to `Config` struct:

- `Workspaces []Workspace` — ordered list of workspace definitions
- `ActiveWorkspaceID string` — currently selected workspace

Add `Workspace` struct with `ID`, `Name` fields.

`Defaults()` returns a single "Default" workspace with a stable generated ID and sets it as active.

### Manifest (`internal/manifest/manifest.go`)

Add `WorkspaceID string` to `Manifest` struct.

### Session Manager (`internal/session/manager.go`)

Add `WorkspaceID string` to `SessionInfo` and `DashboardSession`.

`Create()` accepts a workspace ID parameter, stores it in the manifest and session info.

`Recover()` reads the workspace ID from each manifest.

New method: `MoveSessionToWorkspace(sessionID, workspaceID string) error` — updates the in-memory `SessionInfo` and rewrites the manifest.

### App (`app.go`)

New bound methods:

- `GetWorkspaces() []Workspace` — returns the ordered workspace list from config
- `CreateWorkspace(name string) (*Workspace, error)` — generates ID, appends to config, saves
- `RenameWorkspace(id string, name string) error`
- `DeleteWorkspace(id string, moveSessionsToDefault bool) error` — if `moveSessionsToDefault` is true, reassign sessions; otherwise delete them. Cannot delete the Default workspace.
- `ReorderWorkspaces(ids []string) error` — sets new order
- `SetActiveWorkspace(id string) error` — persists to config, emits `workspace-changed` event
- `MoveSessionToWorkspace(sessionID, workspaceID string) error`

`CreateSession()` gains awareness of the active workspace: reads `ActiveWorkspaceID` from config and passes it to `Manager.Create()`.

New event: `workspace-changed` (Go to Frontend) — emitted when active workspace changes, carries the workspace ID.

## Frontend Changes

### Types (`frontend/src/lib/types.ts`)

```typescript
export interface Workspace {
  id: string;
  name: string;
}
```

Add `workspace_id?: string` to `SessionInfo` and `DashboardSession`.

### Sidebar (`frontend/src/lib/Sidebar.svelte`)

Add a workspace switcher above the "New Session" button:

- Displays active workspace name with a chevron
- Click opens a dropdown listing all workspaces
- Each item shows workspace name; click switches to it
- Dropdown footer has "+ New Workspace" option
- Active workspace has a checkmark or highlight

The session list filters to only show sessions matching the active workspace ID.

Add "Move to..." submenu to the existing overflow menu (three-dot button) on each session card. Submenu lists all workspaces except the session's current one. Selecting one calls `MoveSessionToWorkspace`.

### Workspace Management

Workspace rename: double-click the workspace name in the dropdown, inline edit (same pattern as session rename).

Workspace delete: option in the dropdown (not shown for Default). Opens a confirmation dialog: "Move N sessions to Default, or delete them too?" with two buttons.

### App.svelte

- Load workspaces on mount via `GetWorkspaces()`
- Track `activeWorkspaceId` state
- Listen for `workspace-changed` event
- Pass active workspace ID and workspace list to Sidebar
- Filter `sessions` by `workspace_id` before passing to Sidebar (backend still sends all sessions; filtering is frontend-only so workspace switches are instant)

### Keyboard Shortcuts

`Ctrl+1` through `Ctrl+9` switch to workspace by position (1-indexed into the ordered workspace array). These are hardcoded, not configurable via the keybinding system, since Ctrl+number doesn't conflict with any terminal sequences (terminals use Escape sequences, not Ctrl+number).

### Layout Persistence

The existing layout tree persists per-app, not per-workspace. When switching workspaces, the layout is not changed — tabs for sessions from the previous workspace remain open. The sidebar filtering is the primary workspace boundary. This avoids complexity and keeps the split-pane layout stable.

## Migration

On first launch after this feature ships:

1. Config has no `workspaces` field — create Default workspace with generated ID, set as active
2. All existing manifests have no `workspace_id` — assign Default workspace ID to each during `Recover()`
3. No data loss, no breaking changes to manifest format (field is `omitempty`)

## Constraints

- Minimum one workspace (Default) at all times
- Default workspace cannot be deleted or renamed
- Session belongs to exactly one workspace
- Workspace names must be non-empty after trimming
- Duplicate workspace names are allowed (ID is the key)
- Maximum ~20 workspaces (UI constraint from Ctrl+1-9 shortcuts and dropdown usability)

## Out of Scope

- Per-workspace layout trees
- Workspace-specific settings or themes
- Drag-and-drop reordering of workspaces (use `ReorderWorkspaces` API, but no UI for it in v1)
- Workspace color/icon customization
- Cross-workspace session visibility or search
