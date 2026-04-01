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
    if (result.timed_out) return '\u23F1';
    if (result.exit_code === 0) return '\u2713';
    return '\u2717';
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
