# Session Naming

## Problem

Sessions display the directory basename in the sidebar. Multiple sessions sharing a working directory are indistinguishable.

## Solution

Add a `Name` field to sessions. Auto-generate names from the directory basename with dedup numbering. Allow users to rename sessions inline in the sidebar.

## Backend

### Data model

Add `Name string` (`json:"name"`) to `SessionInfo` (manager.go) and `Manifest` (manifest.go).

### Auto-dedup naming

`Manager.Create()` generates the initial name from `filepath.Base(workDir)`. If that name is already taken by an existing session, append ` (N)` where N starts at 2 and increments until an unused name is found.

### RenameSession

New method on `Manager`: `Rename(id, name string) error`. Validates name is non-empty after trimming whitespace. Updates in-memory `SessionInfo`, rewrites the manifest file, calls the update callback (which emits `sessions-updated`).

No uniqueness constraint on custom names.

New Wails binding on `App`: `RenameSession(id, name string) error` — delegates to `Manager.Rename()`.

### Recovery

`Manager.Recover()` reads `Name` from the manifest. If the field is empty (legacy manifest), generates a name from `WorkDir` using the same dedup logic as `Create()`.

## Frontend

### Types

Add `name: string` to `SessionInfo` in `types.ts`.

### Sidebar display

Replace `dirName(session.work_dir)` with `session.name`. Remove the `dirName` helper.

### Edit trigger

- Double-click on the session name enters edit mode.
- A pencil icon appears on hover (CSS `opacity` transition) next to the session name. Clicking it also enters edit mode.

### Inline editing

Replace the name `<span>` with an `<input>` pre-filled with the current name, auto-focused with text selected. Track which session is being edited with an `editingId` rune (`$state<string | null>`). Only one session editable at a time.

- **Enter** or **blur**: commit. Call `RenameSession(id, newName)`. If input is empty/whitespace, revert.
- **Escape**: cancel, revert to original name.

## Testing

### Go unit tests (`internal/session/`)

- `TestManager_Create_AutoDedup` — multiple sessions with same WorkDir get names `myapp`, `myapp (2)`, `myapp (3)`.
- `TestManager_Rename` — rename updates in-memory info and manifest on disk.
- `TestManager_Rename_EmptyName` — empty/whitespace name returns error.
- `TestManager_Recover_WithName` — manifest with name field preserves it.
- `TestManager_Recover_WithoutName` — legacy manifest without name field generates one with dedup.

### Frontend

- `npm run check` for type correctness.
- Manual testing for inline edit UX (double-click, pencil icon, Enter/Escape/blur).
