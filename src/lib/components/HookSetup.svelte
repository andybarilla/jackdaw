<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { HookStatus, HookScope } from '$lib/types';

  let scope: HookScope = $state('user');
  let projectPath: string = $state('');
  let status: HookStatus | null = $state(null);
  let message: string = $state('');
  let loading: boolean = $state(false);
  let error: string = $state('');

  async function checkStatus() {
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      status = await invoke<HookStatus>('check_hooks_status', { scope, cwd });
      error = '';
    } catch (e) {
      error = String(e);
      status = null;
    }
  }

  async function handleInstall() {
    loading = true;
    error = '';
    message = '';
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      const result = await invoke<string>('install_hooks', { scope, cwd });
      message = result;
      await checkStatus();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function handleUninstall() {
    loading = true;
    error = '';
    message = '';
    try {
      const cwd = scope === 'project' ? projectPath || undefined : undefined;
      const result = await invoke<string>('uninstall_hooks', { scope, cwd });
      message = result;
      await checkStatus();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  // Check status on mount and when scope changes
  $effect(() => {
    scope;
    checkStatus();
  });

  // Debounce project path changes to avoid firing on every keystroke
  $effect(() => {
    projectPath;
    const timeout = setTimeout(() => checkStatus(), 500);
    return () => clearTimeout(timeout);
  });
</script>

<div class="hook-setup">
  <p class="title">Install Claude Code Hooks</p>
  <p class="subtitle">Automatically send session events to Jackdaw</p>

  <div class="scope-toggle">
    <label class:active={scope === 'user'}>
      <input type="radio" bind:group={scope} value="user" />
      User-level
    </label>
    <label class:active={scope === 'project'}>
      <input type="radio" bind:group={scope} value="project" />
      Project-level
    </label>
  </div>

  {#if scope === 'project'}
    <input
      type="text"
      class="path-input"
      bind:value={projectPath}
      placeholder="/path/to/project"
    />
  {/if}

  {#if status === 'installed'}
    <p class="status installed">Hooks installed</p>
  {:else if status === 'outdated'}
    <p class="status outdated">Hooks need updating</p>
  {:else if status === 'not_installed'}
    <p class="status not-installed">Hooks not installed</p>
  {/if}

  <div class="actions">
    {#if status === 'installed'}
      <button class="btn btn-secondary" onclick={handleUninstall} disabled={loading}>
        Uninstall
      </button>
    {:else}
      <button class="btn btn-primary" onclick={handleInstall} disabled={loading || (scope === 'project' && !projectPath)}>
        {loading ? 'Installing...' : status === 'outdated' ? 'Update Hooks' : 'Install Hooks'}
      </button>
    {/if}
  </div>

  {#if message}
    <p class="message success">{message}</p>
  {/if}
  {#if error}
    <p class="message error">{error}</p>
  {/if}
</div>

<style>
  .hook-setup {
    background: var(--card-bg);
    border: 1px solid var(--border);
    padding: 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
  }

  .scope-toggle {
    display: flex;
    gap: 4px;
    background: var(--bg);
    padding: 2px;
  }

  .scope-toggle label {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .scope-toggle label.active {
    background: var(--card-bg);
    color: var(--text-primary);
  }

  .scope-toggle input[type="radio"] {
    display: none;
  }

  .path-input {
    width: 100%;
    max-width: 300px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
  }

  .path-input::placeholder {
    color: var(--text-muted);
  }

  .status {
    font-size: 12px;
    font-weight: 500;
  }

  .status.installed { color: var(--success); }
  .status.outdated { color: var(--attention); }
  .status.not-installed { color: var(--text-muted); }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 16px;
    border: 1px solid var(--border);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--active);
    color: #fff;
    border-color: var(--active);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .message {
    font-size: 11px;
    max-width: 300px;
    word-break: break-word;
  }

  .message.success { color: var(--success); }
  .message.error { color: var(--error); }
</style>
