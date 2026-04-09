# Command Palette Implementation Plan

Spec: approved design from conversation (no spec file — user-approved inline).

## Task 1: Go Config — ShellCommand struct

**Files:** `internal/config/config.go`

Add `ShellCommand` struct and `ShellCommands` field to `Config`:

```go
type ShellCommand struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	WorkDir string `json:"work_dir,omitempty"`
}
```

Add to Config struct:
```go
ShellCommands []ShellCommand `json:"shell_commands,omitempty"`
```

No changes to `Defaults()` — empty slice is fine as zero value.

**Verification:** `go test ./internal/config/...`

## Task 2: Frontend types and config state

**Files:** `frontend/src/lib/types.ts`, `frontend/src/lib/config.svelte.ts`

In `types.ts`, add:
```ts
export interface ShellCommand {
  name: string;
  command: string;
  work_dir?: string;
}
```

In `config.svelte.ts`:
- Add `let shellCommands = $state<ShellCommand[]>([])` 
- Add `getShellCommands()` getter
- Add `setShellCommands(v: ShellCommand[])` async setter (same pattern as others)
- Load from config in `loadConfig()`: `shellCommands = cfg.shell_commands || []`

**Verification:** `cd frontend && npm run check`

## Task 3: Keybinding action

**Files:** `frontend/src/lib/keybindings.ts`

- Add `"commandPalette.open"` to the `Action` union type
- Add default binding: `"commandPalette.open": "Ctrl+Shift+P"`

**Verification:** `cd frontend && npm run check`

## Task 4: Terminal send method

**Files:** `frontend/src/lib/types.ts`, `frontend/src/lib/Terminal.svelte`

In `types.ts`, add `send: (data: string) => void` to `TerminalApi`.

In `Terminal.svelte`, the `wsConn` already has a `send` method. Update the `onReady` call to include it:
```ts
onReady?.({ searchAddon, focus: () => term.focus(), send: (data: string) => wsConn?.send(data) });
```

**Verification:** `cd frontend && npm run check`

## Task 5: CommandPalette component

**Files:** `frontend/src/lib/CommandPalette.svelte` (new)

Props:
- `actions: Record<string, () => void>` — built-in action handlers from App.svelte
- `keymap: Keymap` — current keymap for displaying binding hints
- `shellCommands: ShellCommand[]` — user-defined commands
- `activeSessionWorkDir: string` — for workDir scope filtering
- `onExecuteShellCommand: (command: string) => void` — callback
- `onClose: () => void`

Behavior:
- Modal overlay with backdrop (z-index above toasts, ~1100)
- Backdrop click or Escape closes
- Autofocused search input at top
- Below input: scrollable list of matching commands
- Filtering: case-insensitive substring match on command name
- Built-in actions shown first with their keybinding hints from keymap
- Separator line, then shell commands
- Shell commands filtered by workDir scope: show if `work_dir` is empty (global) or if `activeSessionWorkDir` starts with `work_dir`
- Arrow Up/Down navigation with wrapping, Enter executes selected
- Selected item gets highlight style
- "No matching commands" when filter has no results

Human-readable labels for built-in actions (hardcoded map):
```ts
const ACTION_LABELS: Record<string, string> = {
  "session.new": "New Session",
  "session.kill": "Kill Session",
  "session.next": "Next Session",
  "session.prev": "Previous Session",
  "session.viewDiff": "View Diff",
  "app.toggleSidebar": "Toggle Sidebar",
  "terminal.search": "Find in Terminal",
  "pane.splitVertical": "Split Vertical",
  "pane.splitHorizontal": "Split Horizontal",
  "pane.close": "Close Pane",
  "pane.focusUp": "Focus Pane Up",
  "pane.focusDown": "Focus Pane Down",
  "pane.focusLeft": "Focus Pane Left",
  "pane.focusRight": "Focus Pane Right",
  "pane.unsplit": "Unsplit Pane",
  "tab.next": "Next Tab",
  "tab.prev": "Previous Tab",
  "app.openSettings": "Open Settings",
  "commandPalette.open": "Command Palette",
};
```

Category labels: "Action" for built-ins, "Shell" for user commands.

Styling: dark theme using existing CSS vars (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`). ~500px wide, max 50vh height.

**Verification:** `cd frontend && npm run check && npm run build`

## Task 6: Wire up in App.svelte

**Files:** `frontend/src/App.svelte`

- Import `CommandPalette` and `getShellCommands` from config
- Add `let showCommandPalette = $state(false)` 
- Add `"commandPalette.open"` to the actions map: toggles `showCommandPalette`
- Add `onExecuteShellCommand` handler: looks up focused pane's session/terminal, gets its terminalApi, calls `api.send(command + "\r")`. If no active terminal, fire a toast via `addNotification`.
- Compute `activeSessionWorkDir` from focused pane content + sessions array
- Render `<CommandPalette>` conditionally when `showCommandPalette` is true, passing actions map, keymap, shell commands, workDir, callbacks

**Verification:** `cd frontend && npm run check && npm run build`

## Task order

Tasks 1-4 are independent and can be done in any order. Task 5 depends on 2-3. Task 6 depends on all previous tasks.
