# Workspaces Implementation Plan

Spec: `docs/specs/2026-04-09-workspaces-design.md`

## File Structure

### New files
- `internal/workspace/workspace.go` — Workspace type, ID generation

### Modified files
- `internal/config/config.go` — Add Workspaces, ActiveWorkspaceID fields
- `internal/manifest/manifest.go` — Add WorkspaceID field to Manifest
- `internal/session/manager.go` — Add WorkspaceID to SessionInfo/DashboardSession, MoveSessionToWorkspace method, workspace-aware Create/Recover
- `app.go` — New bound methods (workspace CRUD, move, set active), workspace-aware CreateSession
- `frontend/src/lib/types.ts` — Workspace interface, workspace_id on session types
- `frontend/src/lib/Sidebar.svelte` — Workspace switcher dropdown, "Move to" in overflow menu
- `frontend/src/App.svelte` — Load workspaces, track active, filter sessions, Ctrl+N shortcuts, wire new bound methods

## Tasks

### Task 1: Backend data model

Add workspace types and wire them through config, manifest, and session.

**Files:** `internal/workspace/workspace.go`, `internal/config/config.go`, `internal/manifest/manifest.go`, `internal/session/manager.go`

**Changes:**

1. Create `internal/workspace/workspace.go`:
   - `Workspace` struct: `ID string`, `Name string` (JSON-tagged)
   - `GenerateID() string` — use `fmt.Sprintf("%d", time.Now().UnixNano())` to match existing ID pattern
   - `DefaultWorkspace() Workspace` — returns `Workspace{ID: "default", Name: "Default"}`. Use a stable ID string rather than generating one, so all code paths agree on what "default" is.

2. Update `internal/config/config.go`:
   - Add to Config: `Workspaces []workspace.Workspace` (`json:"workspaces,omitempty"`), `ActiveWorkspaceID string` (`json:"active_workspace_id,omitempty"`)
   - `Defaults()` returns empty Workspaces (nil) and empty ActiveWorkspaceID. The app layer handles initialization on first load — config shouldn't import workspace package.
   - Actually, to avoid circular deps: define Workspace inline in config as `ConfigWorkspace` with same fields, or just use the workspace package. The workspace package has no deps, so config can import it. Use `workspace.Workspace` directly.

3. Update `internal/manifest/manifest.go`:
   - Add `WorkspaceID string` (`json:"workspace_id,omitempty"`) to Manifest struct

4. Update `internal/session/manager.go`:
   - Add `WorkspaceID string` (`json:"workspace_id,omitempty"`) to `SessionInfo` and `DashboardSession`
   - Add `WorkspaceID string` parameter to `Create()` — store in SessionInfo and Manifest
   - `Recover()`: read `WorkspaceID` from manifest into SessionInfo
   - New method `MoveSessionToWorkspace(sessionID, workspaceID string) error` — updates SessionInfo.WorkspaceID in memory and rewrites manifest on disk (same pattern as `Rename`)

**Acceptance criteria:**
- Workspace struct exists with ID/Name
- Config loads/saves workspaces and active_workspace_id
- Manifests persist workspace_id
- Sessions carry workspace_id through create and recover
- MoveSessionToWorkspace updates both memory and disk

### Task 2: App-layer workspace API

Add bound methods to app.go that the frontend will call.

**Files:** `app.go`

**Changes:**

1. Import `workspace` package

2. Add initialization in `Startup()`: after config load, if `cfg.Workspaces` is nil/empty, initialize with `[]workspace.Workspace{workspace.DefaultWorkspace()}` and set `ActiveWorkspaceID` to `"default"`, save config.

3. New bound methods:
   - `GetWorkspaces() []workspace.Workspace` — load config, return Workspaces
   - `CreateWorkspace(name string) (*workspace.Workspace, error)` — trim name, validate non-empty, generate ID, append to config.Workspaces, save, return new workspace
   - `RenameWorkspace(id string, name string) error` — find by ID, reject if "default" (Default workspace), trim name, validate non-empty, update, save
   - `DeleteWorkspace(id string, moveSessionsToDefault bool) error` — reject if "default", if moveSessionsToDefault: call manager.MoveSessionToWorkspace for each session in this workspace to "default"; else: call manager.Kill for each. Remove from config.Workspaces, if ActiveWorkspaceID was this one set to "default", save, emit `sessions-updated`
   - `SetActiveWorkspace(id string) error` — validate ID exists in config, update ActiveWorkspaceID, save, emit `workspace-changed` event with ID
   - `MoveSessionToWorkspace(sessionID, workspaceID string) error` — delegate to manager, emit `sessions-updated`

4. Update `CreateSession()`: load config, pass `cfg.ActiveWorkspaceID` to `manager.Create()` as the workspace ID

5. Update `Startup()` recovery: after recovering sessions, load config. For any recovered session with empty WorkspaceID, set it to "default" via manager.MoveSessionToWorkspace (migration path).

**Acceptance criteria:**
- First launch creates Default workspace in config
- All workspace CRUD methods work and persist to config.json
- Default workspace cannot be deleted or renamed
- CreateSession assigns active workspace ID
- Pre-existing sessions migrate to "default" on recovery
- workspace-changed event emitted on switch

### Task 3: Frontend workspace types and bindings

Add TypeScript types and wire the new Go methods.

**Files:** `frontend/src/lib/types.ts`

**Changes:**

1. Add `Workspace` interface: `{ id: string; name: string }`
2. Add `workspace_id?: string` to `SessionInfo` and `DashboardSession`

After this task, run `wails generate module` to regenerate JS bindings for the new App methods.

**Acceptance criteria:**
- Workspace type exported
- Session types include workspace_id
- Wails bindings regenerated and importable

### Task 4: Workspace switcher in Sidebar

Add the workspace dropdown above the session list, filter sessions by active workspace.

**Files:** `frontend/src/lib/Sidebar.svelte`, `frontend/src/App.svelte`

**Changes to App.svelte:**

1. Import new bound methods: `GetWorkspaces`, `CreateWorkspace`, `SetActiveWorkspace`, `DeleteWorkspace`, `RenameWorkspace`, `MoveSessionToWorkspace`
2. Add state: `workspaces: Workspace[]`, `activeWorkspaceId: string`
3. On mount: load workspaces via `GetWorkspaces()`, set activeWorkspaceId from config (add `GetActiveWorkspaceId()` to app.go, or just read from config — simpler: add a method `GetActiveWorkspaceID() string`)
4. Listen for `workspace-changed` event to update activeWorkspaceId
5. Pass `workspaces`, `activeWorkspaceId`, workspace action callbacks to Sidebar
6. Sidebar `onSelect` still works the same — sessions are all loaded, just filtered in display

**Changes to Sidebar.svelte:**

1. Add props: `workspaces: Workspace[]`, `activeWorkspaceId: string`, `onSwitchWorkspace: (id: string) => void`, `onCreateWorkspace: (name: string) => void`, `onRenameWorkspace: (id: string, name: string) => void`, `onDeleteWorkspace: (id: string, moveToDefault: boolean) => void`, `onMoveSession: (sessionId: string, workspaceId: string) => void`

2. Add workspace switcher above "New Session" button:
   - Shows active workspace name with a chevron (▾)
   - Click toggles a dropdown
   - Dropdown lists all workspaces; active one has a checkmark
   - Click on workspace calls onSwitchWorkspace
   - Footer item "+ New Workspace" — click shows inline text input, Enter creates
   - Right side of each non-default workspace item: small "..." menu with Rename and Delete

3. Filter `dashboardSessions` by `activeWorkspaceId`: `dashboardSessions.filter(s => s.workspace_id === activeWorkspaceId)` (or show all if workspace_id is missing, for migration safety)

4. Add "Move to..." submenu in the overflow menu (three-dot) on each session card:
   - Lists all workspaces except the session's current one
   - Click calls onMoveSession(sessionId, targetWorkspaceId)

5. Delete workspace: when clicked, if workspace has sessions, show a confirmation with two buttons: "Move sessions to Default" / "Delete sessions". If no sessions, delete immediately.

**Changes to App.svelte (wiring):**

1. Implement callback handlers that call the bound Go methods
2. After CreateWorkspace/DeleteWorkspace/RenameWorkspace, refresh workspaces list

**Acceptance criteria:**
- Workspace switcher visible at top of sidebar
- Clicking workspace switches active workspace and filters session list
- New workspace creation works from dropdown
- Sessions show only for active workspace
- "Move to" submenu appears in session overflow menu
- Workspace rename (double-click, same pattern as session rename) and delete work
- Delete confirmation shown when workspace has sessions

### Task 5: Keyboard shortcuts and polish

Add Ctrl+N workspace switching and the GetActiveWorkspaceID method.

**Files:** `app.go`, `frontend/src/App.svelte`

**Changes to app.go:**
1. Add `GetActiveWorkspaceID() (string, error)` — load config, return ActiveWorkspaceID

**Changes to App.svelte:**
1. In `handleGlobalKeydown`, before checking keybindings, check for Ctrl+1 through Ctrl+9:
   - `event.ctrlKey && event.key >= "1" && event.key <= "9"` — map to workspace index (0-based)
   - If workspace exists at that index, call SetActiveWorkspace
   - `event.preventDefault()` to avoid browser tab switching

**Acceptance criteria:**
- Ctrl+1 through Ctrl+9 switch workspaces by position
- GetActiveWorkspaceID returns persisted value

## Task Dependencies

```
Task 1 (backend model)
  → Task 2 (app API)
    → Task 3 (frontend types + binding regen)
      → Task 4 (sidebar UI)
      → Task 5 (keyboard shortcuts)
```

Tasks 4 and 5 can run in parallel after Task 3.

## Testing

- `go test ./internal/...` after Tasks 1-2
- `cd frontend && npm run check` after Tasks 3-5
- Manual test: create workspaces, switch, create sessions, verify filtering, move sessions, delete workspace with sessions, restart app and verify persistence, Ctrl+number switching
