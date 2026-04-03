<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';

  interface Props {
    url: string;
    onClose: () => void;
  }

  let { url, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  let currentUrl = $state(url);
  let modalBody: HTMLDivElement | undefined = $state();
  let loading = $state(true);

  onMount(() => {
    const unlisten = listen<string>('preview-navigation', (event) => {
      currentUrl = event.payload;
      loading = false;
    });

    openPreview();

    return () => {
      unlisten.then((fn) => fn());
      invoke('preview_close').catch(() => {});
    };
  });

  async function openPreview() {
    loading = true;
    if (!modalBody) return;
    const rect = modalBody.getBoundingClientRect();
    try {
      await invoke('preview_open', {
        url,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
      loading = false;
    } catch (e) {
      console.error('Failed to open preview:', e);
      loading = false;
    }
  }

  async function handleBack() {
    await invoke('preview_back').catch(() => {});
  }

  async function handleForward() {
    await invoke('preview_forward').catch(() => {});
  }

  async function handleOpenExternal() {
    await openUrl(currentUrl);
  }

  function handleBackdropClick() {
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  // Reposition webview when modal resizes
  $effect(() => {
    if (modalBody) {
      const observer = new ResizeObserver(() => {
        const rect = modalBody!.getBoundingClientRect();
        invoke('preview_reposition', {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }).catch(() => {});
      });
      observer.observe(modalBody);
      return () => observer.disconnect();
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="preview-backdrop" onclick={handleBackdropClick}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="preview-modal" onclick={(e) => e.stopPropagation()}>
    <div class="preview-nav">
      <div class="nav-buttons">
        <button class="nav-btn" onclick={handleBack} title="Back">&#x2190;</button>
        <button class="nav-btn" onclick={handleForward} title="Forward">&#x2192;</button>
      </div>
      <div class="nav-url" title={currentUrl}>{currentUrl}</div>
      <div class="nav-actions">
        <button class="nav-btn" onclick={handleOpenExternal} title="Open in browser">&#x2197;</button>
        <button class="nav-btn close-btn" onclick={onClose} title="Close">&#x2715;</button>
      </div>
    </div>
    <div class="preview-body" bind:this={modalBody}>
      {#if loading}
        <div class="preview-loading">Loading...</div>
      {/if}
      <!-- Native webview renders here, positioned absolutely by Tauri -->
    </div>
  </div>
</div>

<style>
  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .preview-modal {
    width: 80%;
    height: 80%;
    background: var(--card-bg);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preview-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
  }

  .nav-buttons {
    display: flex;
    gap: 2px;
  }

  .nav-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }

  .nav-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .close-btn:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .nav-url {
    flex: 1;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 8px;
    background: var(--tool-bg);
    border: 1px solid var(--border);
  }

  .nav-actions {
    display: flex;
    gap: 2px;
  }

  .preview-body {
    flex: 1;
    position: relative;
  }

  .preview-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
