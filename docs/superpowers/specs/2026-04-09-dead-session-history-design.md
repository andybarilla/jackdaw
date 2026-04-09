# Dead Session History & Removal

## Goal

When a session dies (exited or killed), keep it visible with read-only terminal history instead of immediately removing the tab. Users can review output, then explicitly remove or restart the session.

## Backend

### Manager.Kill changes
Remove the `os.Remove(mf.HistoryPath)` call (lines 327-329 of manager.go) so history files survive kill. Keep manifest cleanup.

### Manager.Remove(id string)
New method for final cleanup when user dismisses a dead session:
- Delete history file at `historyDir/id.log`
- Delete manifest at `manifestDir/id.json`
- Remove from `sessionInfo` map
- Remove from `sessions` map
- Call `notifyUpdate()`

### App.RemoveSession(id string)
Bound method that cleans up notification/hook state and calls `Manager.Remove(id)`.

## Frontend

### Terminal.svelte
Add `readonly` prop (default false). When true:
- Replay history via `GetSessionHistory` (existing behavior)
- Do NOT call `AttachSession`
- Do NOT subscribe to `terminal-output-{id}` events
- Do NOT emit `terminal-input` on data
- Set xterm `disableStdin: true`

### DeadSessionBanner.svelte
Overlay banner on dead session terminals showing status ("Session exited (code N)" or "Session stopped") with Remove and Restart buttons.
- Remove: calls `RemoveSession`, removes tab
- Restart: creates new session with same workDir, replaces tab

### PaneContainer.svelte
When rendering a session where status is exited/stopped, pass `readonly={true}` to Terminal and render DeadSessionBanner overlay.

### App.svelte
- `sessions-updated` handler: stop auto-removing exited session tabs
- `handleKill`: stop removing the tab after kill
- Add `handleRemoveSession(id)`: calls `RemoveSession`, removes tab from layout
- Add `handleRestartSession(id)`: creates new session with same workDir, replaces old tab

## Data Flow

1. Session dies/killed -> stays in sessionInfo with exited/stopped status
2. Frontend receives sessions-updated -> keeps tab, re-renders with readonly terminal + banner
3. User clicks Remove -> RemoveSession cleans up everything
4. User clicks Restart -> new session created, old one removed, tab replaced
