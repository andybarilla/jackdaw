# Custom Commands / Quick Actions

Session-scoped shell commands that appear as buttons on SessionCard. Run tests, check git status, trigger builds — directly from the card, with inline output.

## Config

### Project-level: `.jackdaw/commands.json`

Discovered from the session's `cwd`. Only applies to sessions in that project.

### Global: Jackdaw settings store

Stored under a `"commands"` key in the Tauri Store `settings.json`. Applies to all sessions as fallback.

### Format (same for both)

```json
{
  "commands": [
    {
      "name": "Run Tests",
      "command": "npm test",
      "icon": "test",
      "timeout": 60
    },
    {
      "name": "Git Status",
      "command": "git status --short"
    }
  ]
}
```

- `name` (required): button label
- `command` (required): shell command string, run via `sh -c "..."` (Unix) or `cmd /C "..."` (Windows)
- `icon` (optional): predefined icon key. One of: `test`, `build`, `deploy`, `git`, `clean`, `restart`. Defaults to a generic action icon.
- `timeout` (optional): max seconds before kill. Defaults to 30.

### Merge behavior

Project commands listed first, then global commands. No deduplication — both sets render independently.

## Backend

### `get_custom_commands` Tauri command

```rust
#[tauri::command]
async fn get_custom_commands(cwd: String) -> Result<Vec<CustomCommand>, String>
```

1. Try to read `{cwd}/.jackdaw/commands.json`. Parse if exists, ignore if missing or malformed.
2. Read global commands from Tauri Store `settings.json` under key `"commands"`.
3. Return project commands + global commands as a flat list.

### `CustomCommand` struct

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomCommand {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64, // seconds
}

fn default_timeout() -> u64 { 30 }
```

### `run_custom_command` Tauri command

```rust
#[tauri::command]
async fn run_custom_command(
    cwd: String,
    command: String,
    timeout: u64,
) -> Result<CommandResult, String>
```

```rust
#[derive(Debug, Clone, Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}
```

1. Spawn `sh -c "{command}"` (Unix) or `cmd /C "{command}"` (Windows) with cwd.
2. Wait up to `timeout` seconds. If exceeded, kill the process and set `timed_out = true`.
3. Capture stdout and stderr separately. Truncate each to 10KB max.
4. Return `CommandResult`.

No session state mutation. No persistence. Stateless execution.

### File organization

New file: `src-tauri/src/commands.rs` — contains `CustomCommand`, `CommandResult`, `get_custom_commands`, `run_custom_command`, and the config-reading logic.

Register both commands in `lib.rs` invoke handler.

## Frontend

### Types

```typescript
interface CustomCommand {
  name: string;
  command: string;
  icon: string | null;
  timeout: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
}

interface CommandRun {
  command: CustomCommand;
  result: CommandResult | null; // null while running
  running: boolean;
}
```

### SessionCard changes

**Command bar:** A new row below the tool row, above metadata. Renders up to 3 command buttons. If more than 3 commands exist, the 4th slot is a `···` overflow button that shows the rest in a dropdown.

**Button states:**
- Default: subtle background (`--tool-bg`), border, clickable
- Running: pulsing border animation, disabled, shows spinner icon
- Completed: briefly flashes the button green (success) or red (failure), then returns to default

**Command results:** Stack below the command bar. Each result is a collapsible block showing:
- Status icon (checkmark for exit 0, X for non-zero, clock for timeout)
- Command name
- Exit code or "timed out"
- Dismiss X button
- Collapsible pre block with stdout (and stderr if non-empty, shown in a muted/warning color)

Results are component-local state — cleared on unmount or session dismissal.

**Command loading:** `get_custom_commands(session.cwd)` called once when the card mounts (or when `cwd` changes). Cached in component state. No reactivity to config file changes — user refreshes to pick up new commands.

### New component: `CommandBar.svelte`

Encapsulates the command buttons, running state, and result display. Props:

```typescript
interface Props {
  commands: CustomCommand[];
  cwd: string;
}
```

Manages its own `commandRuns: CommandRun[]` state internally. Invokes `run_custom_command` and appends results.

Rendered by SessionCard when `commands.length > 0`.

## Testing

### Rust unit tests (`commands.rs`)

- Parse valid `commands.json` with all fields
- Parse `commands.json` with only required fields (defaults applied)
- Handle missing file gracefully (empty list)
- Handle malformed JSON gracefully (empty list, no crash)
- `run_custom_command` executes simple command and captures stdout
- `run_custom_command` captures non-zero exit code
- `run_custom_command` kills after timeout
- `run_custom_command` truncates output at 10KB

### Frontend tests (Vitest)

- CommandBar renders correct number of buttons (up to 3 + overflow)
- CommandBar shows overflow menu when > 3 commands
- Button enters loading state when command is running
- Result block renders with correct status icon for exit 0 vs non-zero
- Result block is dismissible
- Multiple results stack
