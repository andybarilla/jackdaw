# Custom Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project and global custom shell commands that appear as buttons on SessionCard with inline output display.

**Architecture:** New `commands.rs` module handles config parsing and command execution. A new `CommandBar.svelte` component renders buttons and stacking results. SessionCard loads commands on mount and renders CommandBar when commands exist. Config comes from `.jackdaw/commands.json` (project-level) and the Tauri Store (global).

**Tech Stack:** Rust (tokio::process, tauri-plugin-store), Svelte 5, TypeScript, Vitest

---

### Task 1: `CustomCommand` and `CommandResult` types + config parsing

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs:1-12` (add `mod commands;`)

- [ ] **Step 1: Create `commands.rs` with types and write failing tests**

Create `src-tauri/src/commands.rs`:

```rust
use serde::{Deserialize, Serialize};

fn default_timeout() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomCommand {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CommandsConfig {
    commands: Vec<CustomCommand>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

/// Parse commands from a JSON string. Returns empty vec on invalid input.
pub fn parse_commands(json: &str) -> Vec<CustomCommand> {
    serde_json::from_str::<CommandsConfig>(json)
        .map(|c| c.commands)
        .unwrap_or_default()
}

/// Read commands from a project's `.jackdaw/commands.json` file.
pub fn read_project_commands(cwd: &str) -> Vec<CustomCommand> {
    let path = std::path::Path::new(cwd).join(".jackdaw/commands.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => parse_commands(&contents),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_commands_all_fields() {
        let json = r#"{"commands":[{"name":"Test","command":"npm test","icon":"test","timeout":60}]}"#;
        let cmds = parse_commands(json);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].name, "Test");
        assert_eq!(cmds[0].command, "npm test");
        assert_eq!(cmds[0].icon, Some("test".into()));
        assert_eq!(cmds[0].timeout, 60);
    }

    #[test]
    fn parse_commands_required_fields_only() {
        let json = r#"{"commands":[{"name":"Build","command":"cargo build"}]}"#;
        let cmds = parse_commands(json);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].icon, None);
        assert_eq!(cmds[0].timeout, 30);
    }

    #[test]
    fn parse_commands_empty_array() {
        let json = r#"{"commands":[]}"#;
        let cmds = parse_commands(json);
        assert!(cmds.is_empty());
    }

    #[test]
    fn parse_commands_malformed_json() {
        let cmds = parse_commands("not json");
        assert!(cmds.is_empty());
    }

    #[test]
    fn parse_commands_wrong_structure() {
        let json = r#"{"items":[{"name":"Test"}]}"#;
        let cmds = parse_commands(json);
        assert!(cmds.is_empty());
    }

    #[test]
    fn read_project_commands_missing_file() {
        let cmds = read_project_commands("/tmp/nonexistent-dir-12345");
        assert!(cmds.is_empty());
    }
}
```

- [ ] **Step 2: Add module declaration to `lib.rs`**

Add after the existing `mod tray;` line (line 11 of `src-tauri/src/lib.rs`):

```rust
pub mod commands;
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test commands`
Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add CustomCommand types and config parsing"
```

---

### Task 2: `run_custom_command` execution logic

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `commands.rs`:

```rust
#[tokio::test]
async fn run_command_captures_stdout() {
    let result = run_command("/tmp", "echo hello", 5).await.unwrap();
    assert_eq!(result.stdout.trim(), "hello");
    assert_eq!(result.exit_code, Some(0));
    assert!(!result.timed_out);
}

#[tokio::test]
async fn run_command_captures_stderr() {
    let result = run_command("/tmp", "echo err >&2", 5).await.unwrap();
    assert_eq!(result.stderr.trim(), "err");
}

#[tokio::test]
async fn run_command_captures_nonzero_exit() {
    let result = run_command("/tmp", "exit 42", 5).await.unwrap();
    assert_eq!(result.exit_code, Some(42));
}

#[tokio::test]
async fn run_command_kills_after_timeout() {
    let result = run_command("/tmp", "sleep 60", 1).await.unwrap();
    assert!(result.timed_out);
}

#[tokio::test]
async fn run_command_truncates_large_output() {
    // Generate >10KB of output
    let result = run_command("/tmp", "yes | head -5000", 5).await.unwrap();
    assert!(result.stdout.len() <= MAX_OUTPUT_BYTES);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test commands`
Expected: compilation error — `run_command` and `MAX_OUTPUT_BYTES` don't exist.

- [ ] **Step 3: Implement `run_command`**

Add to `commands.rs`, after the `read_project_commands` function and before the `#[cfg(test)]` block:

```rust
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tokio::io::AsyncReadExt;

const MAX_OUTPUT_BYTES: usize = 10 * 1024;

fn truncate_output(bytes: Vec<u8>) -> String {
    let s = String::from_utf8_lossy(&bytes);
    if s.len() > MAX_OUTPUT_BYTES {
        s[..MAX_OUTPUT_BYTES].to_string()
    } else {
        s.into_owned()
    }
}

pub async fn run_command(cwd: &str, command: &str, timeout_secs: u64) -> Result<CommandResult, String> {
    let mut child = Command::new("sh")
        .args(["-c", command])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn: {e}"))?;

    let result = timeout(Duration::from_secs(timeout_secs), async {
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();

        if let Some(ref mut stdout) = child.stdout {
            let _ = stdout.read_to_end(&mut stdout_buf).await;
        }
        if let Some(ref mut stderr) = child.stderr {
            let _ = stderr.read_to_end(&mut stderr_buf).await;
        }

        let status = child.wait().await.map_err(|e| format!("wait failed: {e}"))?;
        Ok::<_, String>((stdout_buf, stderr_buf, status))
    })
    .await;

    match result {
        Ok(Ok((stdout_buf, stderr_buf, status))) => Ok(CommandResult {
            stdout: truncate_output(stdout_buf),
            stderr: truncate_output(stderr_buf),
            exit_code: status.code(),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.kill().await;
            Ok(CommandResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                timed_out: true,
            })
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test commands`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: add run_command execution with timeout and truncation"
```

---

### Task 3: Tauri commands `get_custom_commands` and `run_custom_command`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs:646-672` (invoke handler registration)

- [ ] **Step 1: Add Tauri command functions to `commands.rs`**

Add at the end of `commands.rs`, before the `#[cfg(test)]` block:

```rust
#[tauri::command]
pub async fn get_custom_commands(cwd: String, app: tauri::AppHandle) -> Result<Vec<CustomCommand>, String> {
    use tauri_plugin_store::StoreExt;

    let mut commands = read_project_commands(&cwd);

    if let Ok(store) = app.store("settings.json") {
        if let Some(value) = store.get("commands") {
            if let Ok(config) = serde_json::from_value::<CommandsConfig>(value) {
                commands.extend(config.commands);
            }
        }
    }

    Ok(commands)
}

#[tauri::command]
pub async fn run_custom_command(cwd: String, command: String, timeout_secs: u64) -> Result<CommandResult, String> {
    run_command(&cwd, &command, timeout_secs).await
}
```

- [ ] **Step 2: Register commands in `lib.rs` invoke handler**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list (after `force_quit,` on line 668):

```rust
commands::get_custom_commands,
commands::run_custom_command,
```

- [ ] **Step 3: Run full backend test suite**

Run: `cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: register get_custom_commands and run_custom_command Tauri commands"
```

---

### Task 4: Frontend types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add types to `types.ts`**

Add at the end of `src/lib/types.ts`:

```typescript
export interface CustomCommand {
  name: string;
  command: string;
  icon: string | null;
  timeout: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add CustomCommand and CommandResult types"
```

---

### Task 5: `CommandBar.svelte` component

**Files:**
- Create: `src/lib/components/CommandBar.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/CommandBar.svelte`:

```svelte
<script lang="ts">
  import type { CustomCommand, CommandResult } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';

  interface Props {
    commands: CustomCommand[];
    cwd: string;
  }

  let { commands, cwd }: Props = $props();

  interface CommandRun {
    command: CustomCommand;
    result: CommandResult | null;
    running: boolean;
  }

  let runs = $state<CommandRun[]>([]);
  let showOverflow = $state(false);

  let visibleCommands = $derived(commands.slice(0, 3));
  let overflowCommands = $derived(commands.slice(3));

  function isRunning(name: string): boolean {
    return runs.some((r) => r.command.name === name && r.running);
  }

  async function execute(cmd: CustomCommand): Promise<void> {
    if (isRunning(cmd.name)) return;

    const run: CommandRun = { command: cmd, result: null, running: true };
    runs = [run, ...runs];
    showOverflow = false;

    try {
      const result = await invoke<CommandResult>('run_custom_command', {
        cwd,
        command: cmd.command,
        timeoutSecs: cmd.timeout,
      });
      run.result = result;
    } catch (e) {
      run.result = {
        stdout: '',
        stderr: String(e),
        exit_code: null,
        timed_out: false,
      };
    }
    run.running = false;
    runs = runs;
  }

  function dismiss(index: number): void {
    runs = runs.filter((_, i) => i !== index);
  }

  function statusIcon(result: CommandResult): string {
    if (result.timed_out) return '\u23F1'; // stopwatch
    if (result.exit_code === 0) return '\u2713'; // checkmark
    return '\u2717'; // x mark
  }

  function statusClass(result: CommandResult): string {
    if (result.timed_out) return 'timeout';
    if (result.exit_code === 0) return 'success';
    return 'failure';
  }
</script>

<div class="command-bar">
  <div class="command-buttons">
    {#each visibleCommands as cmd (cmd.name)}
      <button
        class="cmd-btn"
        class:running={isRunning(cmd.name)}
        disabled={isRunning(cmd.name)}
        onclick={() => execute(cmd)}
      >
        {#if isRunning(cmd.name)}
          <span class="spinner"></span>
        {/if}
        {cmd.name}
      </button>
    {/each}
    {#if overflowCommands.length > 0}
      <div class="overflow-wrapper">
        <button class="cmd-btn overflow-btn" onclick={() => (showOverflow = !showOverflow)}>···</button>
        {#if showOverflow}
          <div class="overflow-menu">
            {#each overflowCommands as cmd (cmd.name)}
              <button
                class="overflow-item"
                disabled={isRunning(cmd.name)}
                onclick={() => execute(cmd)}
              >
                {cmd.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#each runs as run, i (run.command.name + '-' + i)}
    <div class="command-result">
      <div class="result-header">
        <div class="result-left">
          {#if run.running}
            <span class="spinner"></span>
          {:else if run.result}
            <span class="status-icon {statusClass(run.result)}">{statusIcon(run.result)}</span>
          {/if}
          <span class="result-name">{run.command.name}</span>
          {#if run.result && !run.running}
            <span class="result-exit">
              {run.result.timed_out ? 'timed out' : `exit ${run.result.exit_code}`}
            </span>
          {/if}
        </div>
        {#if !run.running}
          <button class="result-dismiss" onclick={() => dismiss(i)}>{'\u2715'}</button>
        {/if}
      </div>
      {#if run.result && (run.result.stdout || run.result.stderr)}
        <pre class="result-output">{run.result.stdout}{#if run.result.stderr}<span class="stderr">{run.result.stderr}</span>{/if}</pre>
      {/if}
    </div>
  {/each}
</div>

<style>
  .command-bar {
    padding: 0 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .command-buttons {
    display: flex;
    gap: 6px;
    padding: 4px 0;
  }

  .cmd-btn {
    background: var(--tool-bg);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cmd-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .cmd-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .cmd-btn.running {
    animation: pulse-border 1.5s ease-in-out infinite;
  }

  @keyframes pulse-border {
    0%, 100% { border-color: var(--border); }
    50% { border-color: var(--active); }
  }

  .overflow-wrapper {
    position: relative;
  }

  .overflow-btn {
    color: var(--text-muted);
    letter-spacing: 2px;
  }

  .overflow-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 2px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    z-index: 10;
    min-width: 120px;
    display: flex;
    flex-direction: column;
  }

  .overflow-item {
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 10px;
    padding: 6px 10px;
    cursor: pointer;
    text-align: left;
  }

  .overflow-item:last-child {
    border-bottom: none;
  }

  .overflow-item:hover:not(:disabled) {
    background: var(--tool-bg);
    color: var(--text-primary);
  }

  .spinner {
    display: inline-block;
    width: 8px;
    height: 8px;
    border: 1.5px solid var(--text-muted);
    border-top-color: var(--active);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .command-result {
    border: 1px solid var(--border);
    background: var(--tool-bg);
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
  }

  .result-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-icon {
    font-size: 11px;
  }

  .status-icon.success {
    color: var(--success);
  }

  .status-icon.failure {
    color: #f85149;
  }

  .status-icon.timeout {
    color: var(--attention);
  }

  .result-name {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .result-exit {
    font-size: 10px;
    color: var(--text-muted);
  }

  .result-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
    padding: 0 2px;
  }

  .result-dismiss:hover {
    color: var(--text-primary);
  }

  .result-output {
    font-family: monospace;
    font-size: 10px;
    color: var(--text-muted);
    background: var(--card-bg);
    border-top: 1px solid var(--border);
    padding: 6px 8px;
    margin: 0;
    max-height: 150px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .stderr {
    color: #f85149;
  }
</style>
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/CommandBar.svelte
git commit -m "feat: add CommandBar component"
```

---

### Task 6: Wire CommandBar into SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add command loading and CommandBar import**

In SessionCard.svelte's `<script>` block, add the import (with the other component imports, around line 7):

```typescript
import CommandBar from './CommandBar.svelte';
import type { CustomCommand } from '$lib/types';
```

Add command loading state after the `$effect` block (after line 68):

```typescript
let customCommands = $state<CustomCommand[]>([]);

$effect(() => {
  if (!historyMode) {
    invoke<CustomCommand[]>('get_custom_commands', { cwd: session.cwd }).then(
      (cmds) => (customCommands = cmds)
    );
  }
});
```

- [ ] **Step 2: Add CommandBar to template**

Insert after the tool row closing `{/if}` (after line 158, the `{/if}` for `isActive || isPending`) and before the metadata section:

```svelte
{#if customCommands.length > 0 && !historyMode}
  <CommandBar commands={customCommands} cwd={session.cwd} />
{/if}
```

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Run full test suite**

Run: `npm test -- --run && cd src-tauri && cargo test --lib`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: wire CommandBar into SessionCard"
```

---

### Task 7: Frontend tests for CommandBar

**Files:**
- Create: `src/lib/components/CommandBar.test.ts`

- [ ] **Step 1: Write tests**

Create `src/lib/components/CommandBar.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CommandBar from './CommandBar.svelte';
import type { CustomCommand } from '$lib/types';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() =>
    Promise.resolve({ stdout: 'ok\n', stderr: '', exit_code: 0, timed_out: false })
  ),
}));

function makeCommands(count: number): CustomCommand[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Cmd${i + 1}`,
    command: `echo ${i + 1}`,
    icon: null,
    timeout: 30,
  }));
}

describe('CommandBar', () => {
  it('renders up to 3 command buttons', () => {
    render(CommandBar, { props: { commands: makeCommands(3), cwd: '/tmp' } });
    expect(screen.getByText('Cmd1')).toBeTruthy();
    expect(screen.getByText('Cmd2')).toBeTruthy();
    expect(screen.getByText('Cmd3')).toBeTruthy();
  });

  it('shows overflow button when more than 3 commands', () => {
    render(CommandBar, { props: { commands: makeCommands(5), cwd: '/tmp' } });
    expect(screen.getByText('Cmd1')).toBeTruthy();
    expect(screen.getByText('Cmd2')).toBeTruthy();
    expect(screen.getByText('Cmd3')).toBeTruthy();
    expect(screen.getByText('···')).toBeTruthy();
    // Cmd4 and Cmd5 should not be visible until overflow is opened
    expect(screen.queryByText('Cmd4')).toBeNull();
  });

  it('renders no buttons when commands array is empty', () => {
    const { container } = render(CommandBar, { props: { commands: [], cwd: '/tmp' } });
    const buttons = container.querySelectorAll('.cmd-btn');
    expect(buttons.length).toBe(0);
  });
});
```

- [ ] **Step 2: Install @testing-library/svelte if needed**

Run: `npm ls @testing-library/svelte 2>/dev/null || npm install -D @testing-library/svelte`

- [ ] **Step 3: Run tests**

Run: `npm test -- --run src/lib/components/CommandBar.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/CommandBar.test.ts package.json package-lock.json
git commit -m "test: add CommandBar component tests"
```
