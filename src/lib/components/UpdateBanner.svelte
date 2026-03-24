<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { updaterStore } from '$lib/stores/updater.svelte';

  let installing = $state(false);
  let error = $state<string | null>(null);

  async function handleInstall() {
    installing = true;
    error = null;
    updaterStore.startDownload();
    try {
      await invoke('install_update');
    } catch (e) {
      error = String(e);
      installing = false;
    }
  }

  const progressPercent = $derived(
    updaterStore.totalBytes
      ? Math.round((updaterStore.downloadedBytes / updaterStore.totalBytes) * 100)
      : null,
  );
</script>

{#if updaterStore.isUpdateAvailable}
  <div class="update-banner">
    {#if updaterStore.isDownloading}
      <span class="update-text">
        Downloading v{updaterStore.availableVersion}...
        {#if progressPercent !== null}{progressPercent}%{/if}
      </span>
      {#if progressPercent !== null}
        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
      {/if}
    {:else if error}
      <span class="update-text error">Update failed: {error}</span>
      <button class="update-btn" onclick={handleInstall}>Retry</button>
    {:else}
      <span class="update-text">Jackdaw v{updaterStore.availableVersion} is available</span>
      <button class="update-btn" onclick={handleInstall} disabled={installing}>Update Now</button>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--card-bg);
    border: 1px solid var(--active);
    border-radius: 6px;
    margin-bottom: 6px;
  }

  .update-text {
    flex: 1;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .update-text.error {
    color: var(--error, #ef4444);
  }

  .update-btn {
    background: var(--active);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .update-btn:hover {
    opacity: 0.9;
  }

  .update-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--active);
    transition: width 0.2s;
  }
</style>
