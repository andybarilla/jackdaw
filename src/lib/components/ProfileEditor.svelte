<script lang="ts">
  import type { MonitoringProfile } from '$lib/types';

  let { profile, onSave, onDelete }: {
    profile: MonitoringProfile;
    onSave: (profile: MonitoringProfile) => void;
    onDelete: (id: string) => void;
  } = $props();

  let name = $state(profile.name);
  let directories = $state<string[]>([...profile.directories]);
  let alerts = $state({ ...profile.alerts });
  let alertVolume = $state(profile.alert_volume);
  let notificationCommand = $state(profile.notification_command);
  let confirmingDelete = $state(false);

  function save() {
    onSave({
      id: profile.id,
      name,
      directories: directories.filter((d) => d.trim() !== ''),
      alerts: { ...alerts },
      alert_volume: alertVolume,
      notification_command: notificationCommand,
    });
  }

  function addDirectory() {
    directories = [...directories, ''];
  }

  function removeDirectory(index: number) {
    directories = directories.filter((_, i) => i !== index);
    save();
  }

  function handleDelete() {
    if (confirmingDelete) {
      onDelete(profile.id);
    } else {
      confirmingDelete = true;
    }
  }
</script>

<div class="profile-editor">
  <div class="field-row">
    <label class="field-label" for="profile-name-{profile.id}">Name</label>
    <input
      id="profile-name-{profile.id}"
      type="text"
      class="field-input"
      bind:value={name}
      onblur={save}
    />
  </div>

  <div class="field-group">
    <span class="field-label">Directories</span>
    {#each directories as dir, i}
      <div class="dir-row">
        <input
          type="text"
          class="field-input dir-input"
          bind:value={directories[i]}
          onblur={save}
          placeholder="/path/to/project"
        />
        <button class="remove-btn" onclick={() => removeDirectory(i)}>✕</button>
      </div>
    {/each}
    <button class="add-btn" onclick={addDirectory}>+ Add directory</button>
  </div>

  <div class="field-group">
    <span class="field-label">Alert Tiers</span>
    <div class="alert-row">
      <span class="alert-label">Approval Needed</span>
      <select class="alert-select" bind:value={alerts.on_approval_needed} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
    <div class="alert-row">
      <span class="alert-label">Waiting for Input</span>
      <select class="alert-select" bind:value={alerts.on_stop} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
    <div class="alert-row">
      <span class="alert-label">Session Ended</span>
      <select class="alert-select" bind:value={alerts.on_session_end} onchange={save}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
    </div>
  </div>

  <div class="field-row">
    <label class="field-label" for="profile-volume-{profile.id}">Volume</label>
    <div class="volume-row">
      <input
        id="profile-volume-{profile.id}"
        type="range"
        min="0"
        max="100"
        bind:value={alertVolume}
        onchange={save}
        class="volume-slider"
      />
      <span class="volume-value">{alertVolume}%</span>
    </div>
  </div>

  <div class="field-row">
    <label class="field-label" for="profile-cmd-{profile.id}">Notification command</label>
    <input
      id="profile-cmd-{profile.id}"
      type="text"
      class="field-input"
      bind:value={notificationCommand}
      onblur={save}
      placeholder="e.g. ~/.config/jackdaw/on-notify.sh"
    />
  </div>

  <div class="delete-row">
    <button class="delete-btn" onclick={handleDelete}>
      {confirmingDelete ? 'Confirm' : 'Delete'}
    </button>
    {#if confirmingDelete}
      <button class="cancel-btn" onclick={() => (confirmingDelete = false)}>Cancel</button>
    {/if}
  </div>
</div>

<style>
  .profile-editor {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  .field-row {
    padding: 6px 0;
  }

  .field-group {
    padding: 6px 0;
  }

  .field-label {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
    font-family: monospace;
  }

  .field-input:focus {
    outline: none;
    border-color: var(--active);
  }

  .dir-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
  }

  .dir-input {
    flex: 1;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }

  .remove-btn:hover {
    color: var(--state-approval);
  }

  .add-btn {
    background: none;
    border: none;
    color: var(--active);
    cursor: pointer;
    font-size: 12px;
    padding: 4px 0;
  }

  .alert-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }

  .alert-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .alert-select {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
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

  .delete-row {
    display: flex;
    gap: 8px;
    padding: 8px 0 0;
  }

  .delete-btn {
    background: none;
    border: 1px solid var(--state-approval);
    color: var(--state-approval);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .cancel-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
