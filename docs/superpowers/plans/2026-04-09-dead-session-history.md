# Plan: Dead Session History & Removal

Spec: `docs/superpowers/specs/2026-04-09-dead-session-history-design.md`

## Task 1: Backend — Preserve history on kill, add Remove method

**Files:**
- `internal/session/manager.go`
- `app.go`

**Changes:**

1. `Manager.Kill()`: Remove the `os.Remove(mf.HistoryPath)` block (lines 327-329). History file must survive kill so the frontend can replay it.

2. Add `Manager.Remove(id string)`:
   ```go
   func (m *Manager) Remove(id string) {
       m.mu.Lock()
       delete(m.sessions, id)
       delete(m.sessionInfo, id)
       delete(m.statusTrackers, id)
       m.mu.Unlock()

       historyPath := filepath.Join(m.historyDir, id+".log")
       os.Remove(historyPath)

       manifestPath := filepath.Join(m.manifestDir, id+".json")
       manifest.Remove(manifestPath)

       m.notifyUpdate()
   }
   ```

3. `app.go` — Add `App.RemoveSession(id string)`:
   ```go
   func (a *App) RemoveSession(id string) {
       delete(a.patternMatchers, id)
       delete(a.errorDetectors, id)
       if a.hookListener != nil {
           a.hookListener.UnregisterSession(id)
       }
       a.manager.Remove(id)
   }
   ```

## Task 2: Frontend — Readonly terminal mode

**Files:**
- `frontend/src/lib/Terminal.svelte`

**Changes:**

1. Add `readonly` prop (default false) to Props interface.
2. When `readonly` is true in the `$effect` block that runs on first open:
   - Still replay history via `GetSessionHistory`
   - Skip `AttachSession` call
   - Skip subscribing to `terminal-output-{sessionId}` events
   - Skip `term.onData` input handler
   - Skip emitting `terminal-resize` events
3. Pass `disableStdin: true` to Terminal constructor when readonly.

## Task 3: Frontend — DeadSessionBanner component

**Files:**
- `frontend/src/lib/DeadSessionBanner.svelte` (new)

**Changes:**

Create a banner overlay component with:
- Props: `status` (string), `exitCode` (number), `onRemove` (callback), `onRestart` (callback)
- Shows "Session exited (code N)" or "Session stopped" based on status
- Remove and Restart buttons
- Positioned at bottom of terminal pane, styled consistently with app theme

## Task 4: Frontend — Wire up PaneContainer and App.svelte

**Files:**
- `frontend/src/lib/PaneContainer.svelte`
- `frontend/src/App.svelte`

**Changes:**

### PaneContainer.svelte
1. Accept new props: `onRemoveSession`, `onRestartSession`
2. When rendering a session tab where the session status is "exited" or "stopped":
   - Pass `readonly={true}` to Terminal
   - Render DeadSessionBanner overlay with appropriate callbacks
3. Need access to `sessions` array (already available) to look up status.

### App.svelte
1. Import `RemoveSession` from wailsjs bindings.
2. `sessions-updated` handler: Remove the block that auto-removes exited session tabs (lines 389-417). Keep the worktree cleanup dialog logic for worktree sessions, but don't remove the tab or delete terminalApi.
3. `handleKill`: Remove the lines that delete terminalApi and remove the tab (lines 476-480). Kill just kills — the tab stays with readonly terminal.
4. Add `handleRemoveSession(id)`: calls `RemoveSession(id)`, removes tab from layout, cleans up terminalApi.
5. Add `handleRestartSession(id)`: looks up session workDir, calls `RemoveSession(id)`, creates new session with same workDir, replaces tab in layout.
6. Pass `onRemoveSession` and `onRestartSession` through SplitPane to PaneContainer.

### SplitPane.svelte
1. Thread `onRemoveSession` and `onRestartSession` props through to PaneContainer.

## File Structure

```
internal/session/manager.go     (modified)
app.go                          (modified)
frontend/src/lib/Terminal.svelte       (modified)
frontend/src/lib/DeadSessionBanner.svelte (new)
frontend/src/lib/PaneContainer.svelte  (modified)
frontend/src/lib/SplitPane.svelte      (modified)
frontend/src/App.svelte                (modified)
```

## Testing

- `go test ./internal/...` must pass
- `cd frontend && npm run check` must pass
- `cd frontend && npm run build` must pass
