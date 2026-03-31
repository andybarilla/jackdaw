<script lang="ts">
  import { onMount } from 'svelte';
  import { Store } from '@tauri-apps/plugin-store';
  import { invoke } from '@tauri-apps/api/core';
  import { getVersion } from '@tauri-apps/api/app';
  import { updaterStore } from '$lib/stores/updater.svelte';

  interface NotificationPrefs {
    on_approval_needed: boolean;
    on_session_end: boolean;
    on_stop: boolean;
  }

  let prefs = $state<NotificationPrefs>({
    on_approval_needed: true,
    on_session_end: true,
    on_stop: true,
  });

  let store: Awaited<ReturnType<typeof Store.load>> | null = $state(null);
  let notificationCommand = $state('');
  let autoUpdateEnabled = $state(true);
  let appVersion = $state<string | null>(null);
  let checking = $state(false);

  onMount(async () => {
    store = await Store.load('settings.json');
    const saved = await store.get<NotificationPrefs>('notifications');
    if (saved) {
      prefs = saved;
    }
    const savedCommand = await store.get<string>('notification_command');
    if (savedCommand) {
      notificationCommand = savedCommand;
    }
    const savedAutoUpdate = await store.get<boolean>('auto_update_enabled');
    if (savedAutoUpdate !== undefined) {
      autoUpdateEnabled = savedAutoUpdate;
    }
    if (savedAutoUpdate === false) {
      await invoke('set_auto_update', { enabled: false });
    }
    appVersion = await getVersion();
  });

  async function toggle(key: keyof NotificationPrefs) {
    prefs[key] = !prefs[key];
    if (store) {
      await store.set('notifications', prefs);
      await store.save();
    }
  }

  async function saveCommand() {
    if (store) {
      await store.set('notification_command', notificationCommand);
      await store.save();
    }
  }

  async function toggleAutoUpdate() {
    autoUpdateEnabled = !autoUpdateEnabled;
    if (store) {
      await store.set('auto_update_enabled', autoUpdateEnabled);
      await store.save();
    }
    await invoke('set_auto_update', { enabled: autoUpdateEnabled });
  }

  async function checkForUpdates() {
    checking = true;
    try {
      await invoke('check_for_update');
    } catch (e) {
      console.error('Update check failed:', e);
    } finally {
      checking = false;
    }
  }
</script>

<div class="settings">
  <h3 class="settings-title">Notifications</h3>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_approval_needed} onchange={() => toggle('on_approval_needed')} />
    <span>Notify when approval needed</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_stop} onchange={() => toggle('on_stop')} />
    <span>Notify when waiting for input</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_session_end} onchange={() => toggle('on_session_end')} />
    <span>Notify when session ends</span>
  </label>
  <div class="command-row">
    <label class="command-label" for="notification-command">Run command on notification</label>
    <input
      id="notification-command"
      type="text"
      class="command-input"
      placeholder="e.g. ~/.config/jackdaw/on-notify.sh"
      bind:value={notificationCommand}
      onblur={saveCommand}
    />
  </div>
  <h3 class="settings-title">Updates</h3>
  <label class="toggle-row">
    <input type="checkbox" checked={autoUpdateEnabled} onchange={toggleAutoUpdate} />
    <span>Check for updates automatically</span>
  </label>
  <div class="update-actions">
    <button class="check-btn" onclick={checkForUpdates} disabled={checking}>
      {checking ? 'Checking...' : 'Check for Updates'}
    </button>
    {#if updaterStore.isUpdateAvailable}
      <span class="update-available">v{updaterStore.availableVersion} available</span>
    {/if}
  </div>
  {#if appVersion}
    <div class="version-info">Current version: v{appVersion}</div>
  {/if}
</div>

<style>
  .settings {
    padding: 16px;
  }

  .settings-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px 0;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .toggle-row input[type="checkbox"] {
    accent-color: var(--active);
  }

  .command-row {
    padding: 8px 0 12px 0;
  }

  .command-label {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .command-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    font-family: monospace;
  }

  .command-input::placeholder {
    color: var(--text-muted);
  }

  .command-input:focus {
    outline: none;
    border-color: var(--active);
  }

  .update-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
  }

  .check-btn {
    background: var(--card-bg);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .check-btn:hover {
    border-color: var(--text-muted);
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .update-available {
    font-size: 12px;
    color: var(--active);
  }

  .version-info {
    font-size: 11px;
    color: var(--text-muted);
    padding: 4px 0;
  }
</style>
