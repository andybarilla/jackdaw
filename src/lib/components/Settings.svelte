<script lang="ts">
  import { onMount } from 'svelte';
  import { Store } from '@tauri-apps/plugin-store';
  import { invoke } from '@tauri-apps/api/core';
  import { getVersion } from '@tauri-apps/api/app';
  import { updaterStore } from '$lib/stores/updater.svelte';
  import type { AlertPrefs, AlertTier, MonitoringProfile } from '$lib/types';
  import ProfileEditor from './ProfileEditor.svelte';
  import ShortcutSettings from './ShortcutSettings.svelte';
  import { loadBindings, saveBindings, type ShortcutBinding } from '$lib/shortcuts';
  import { sessionStore } from '$lib/stores/sessions.svelte';

  let alertPrefs = $state<AlertPrefs>({
    on_approval_needed: 'high',
    on_session_end: 'low',
    on_stop: 'medium',
  });

  let alertVolume = $state(80);

  let store: Awaited<ReturnType<typeof Store.load>> | null = $state(null);
  let notificationCommand = $state('');
  let autoUpdateEnabled = $state(true);
  let appVersion = $state<string | null>(null);
  let checking = $state(false);

  interface HttpApiConfig {
    enabled: boolean;
    port: number;
    bind_address: string;
  }

  let httpApi = $state<HttpApiConfig>({
    enabled: false,
    port: 7456,
    bind_address: '127.0.0.1',
  });
  let httpApiToken = $state('');
  let httpApiChanged = $state(false);
  let profiles = $state<MonitoringProfile[]>([]);

  onMount(async () => {
    store = await Store.load('settings.json');
    const saved = await store.get<AlertPrefs>('notifications');
    if (saved) {
      const raw = saved as unknown as Record<string, unknown>;
      if (typeof raw.on_approval_needed === 'boolean') {
        alertPrefs = {
          on_approval_needed: raw.on_approval_needed ? 'high' : 'off',
          on_stop: (raw as Record<string, unknown>).on_stop ? 'medium' : 'off',
          on_session_end: (raw as Record<string, unknown>).on_session_end ? 'low' : 'off',
        };
        await store.set('notifications', alertPrefs);
        await store.save();
      } else {
        alertPrefs = saved;
      }
    }
    const savedVolume = await store.get<number>('alert_volume');
    if (savedVolume !== undefined && savedVolume !== null) {
      alertVolume = savedVolume;
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
    const savedHttpApi = await store.get<HttpApiConfig>('http_api');
    if (savedHttpApi) {
      httpApi = savedHttpApi;
    }
    if (httpApi.enabled) {
      try {
        httpApiToken = await invoke<string>('get_api_token');
      } catch {
        httpApiToken = '';
      }
    }
    profiles = await invoke<MonitoringProfile[]>('get_profiles');
    await loadBindings(store);
  });

  async function saveAlertPrefs() {
    if (store) {
      await store.set('notifications', alertPrefs);
      await store.save();
    }
  }

  async function saveVolume() {
    if (store) {
      await store.set('alert_volume', alertVolume);
      await store.save();
      sessionStore.setVolume(alertVolume);
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

  async function saveHttpApi() {
    if (store) {
      await store.set('http_api', httpApi);
      await store.save();
      httpApiChanged = true;
    }
  }

  async function addProfile() {
    const newProfile: MonitoringProfile = {
      id: crypto.randomUUID(),
      name: 'New Profile',
      directories: [],
      alerts: { ...alertPrefs },
      alert_volume: alertVolume,
      notification_command: notificationCommand,
    };
    profiles = [...profiles, newProfile];
    await invoke('save_profiles', { profiles });
  }

  async function saveProfile(updated: MonitoringProfile) {
    profiles = profiles.map((p) => (p.id === updated.id ? updated : p));
    await invoke('save_profiles', { profiles });
  }

  async function deleteProfile(id: string) {
    profiles = profiles.filter((p) => p.id !== id);
    await invoke('save_profiles', { profiles });
  }

  async function saveShortcuts(bindings: ShortcutBinding[]) {
    if (store) {
      await saveBindings(store, bindings);
    }
  }

  async function toggleHttpApi() {
    httpApi.enabled = !httpApi.enabled;
    await saveHttpApi();
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
  <h3 class="settings-title">Monitoring Profiles</h3>
  <p class="settings-hint">Per-project alert overrides. Unmatched sessions use the global settings below.</p>
  {#each profiles as profile (profile.id)}
    <ProfileEditor {profile} onSave={saveProfile} onDelete={deleteProfile} />
  {/each}
  <button class="add-profile-btn" onclick={addProfile}>+ Add Profile</button>
  <h3 class="settings-title">Keyboard Shortcuts</h3>
  <ShortcutSettings onSave={saveShortcuts} />
  <h3 class="settings-title">Alerts</h3>
  <div class="alert-row">
    <span class="alert-label">Approval Needed</span>
    <select class="alert-select" bind:value={alertPrefs.on_approval_needed} onchange={saveAlertPrefs}>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
      <option value="off">Off</option>
    </select>
  </div>
  <div class="alert-row">
    <span class="alert-label">Waiting for Input</span>
    <select class="alert-select" bind:value={alertPrefs.on_stop} onchange={saveAlertPrefs}>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
      <option value="off">Off</option>
    </select>
  </div>
  <div class="alert-row">
    <span class="alert-label">Session Ended</span>
    <select class="alert-select" bind:value={alertPrefs.on_session_end} onchange={saveAlertPrefs}>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
      <option value="off">Off</option>
    </select>
  </div>
  <div class="alert-row">
    <span class="alert-label">Sound theme</span>
    <select class="alert-select">
      <option value="default">Default</option>
    </select>
  </div>
  <div class="alert-row">
    <span class="alert-label">Volume</span>
    <div class="volume-row">
      <input
        type="range"
        min="0"
        max="100"
        bind:value={alertVolume}
        onchange={saveVolume}
        class="volume-slider"
      />
      <span class="volume-value">{alertVolume}%</span>
    </div>
  </div>
  <div class="command-row">
    <label class="command-label" for="notification-command">Run command on alert</label>
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
  <h3 class="settings-title">HTTP API</h3>
  <label class="toggle-row">
    <input type="checkbox" checked={httpApi.enabled} onchange={toggleHttpApi} />
    <span>Enable HTTP API</span>
  </label>
  {#if httpApi.enabled}
    <div class="command-row">
      <label class="command-label" for="http-port">Port</label>
      <input
        id="http-port"
        type="number"
        class="command-input"
        bind:value={httpApi.port}
        onblur={saveHttpApi}
        min="1024"
        max="65535"
      />
    </div>
    <div class="command-row">
      <label class="command-label" for="http-bind">Bind address</label>
      <input
        id="http-bind"
        type="text"
        class="command-input"
        bind:value={httpApi.bind_address}
        onblur={saveHttpApi}
        placeholder="127.0.0.1"
      />
      {#if httpApi.bind_address === '0.0.0.0'}
        <div class="warning">Accessible from the network. Ensure you trust your network.</div>
      {/if}
    </div>
    <div class="command-row">
      <label class="command-label" for="api-token">API token</label>
      {#if httpApiToken}
        <div class="token-row">
          <input
            id="api-token"
            type="text"
            class="command-input token-input"
            value={httpApiToken}
            readonly
          />
          <button class="copy-btn" onclick={() => navigator.clipboard.writeText(httpApiToken)}>Copy</button>
        </div>
      {:else}
        <div class="token-display">Token will be generated on first start</div>
      {/if}
    </div>
  {/if}
  {#if httpApiChanged}
    <div class="warning">Restart Jackdaw for changes to take effect.</div>
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

  .warning {
    font-size: 11px;
    color: var(--state-approval);
    padding: 4px 0;
  }

  .token-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .token-input {
    flex: 1;
    font-size: 11px;
  }

  .copy-btn {
    background: var(--card-bg);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .copy-btn:hover {
    border-color: var(--text-muted);
  }

  .alert-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
  }

  .alert-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .alert-select {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }

  .alert-select:focus {
    outline: none;
    border-color: var(--active);
  }

  .volume-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .volume-slider {
    width: 120px;
    accent-color: var(--active);
  }

  .volume-value {
    font-size: 11px;
    color: var(--text-muted);
    min-width: 32px;
    text-align: right;
  }

  .settings-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .add-profile-btn {
    background: none;
    border: 1px dashed var(--border);
    color: var(--active);
    border-radius: 4px;
    padding: 8px;
    width: 100%;
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 16px;
  }

  .add-profile-btn:hover {
    border-color: var(--active);
  }

  .token-display {
    font-size: 12px;
    font-family: monospace;
    color: var(--text-secondary);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
  }
</style>
