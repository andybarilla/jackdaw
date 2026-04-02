<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { marked } from 'marked';
  import { onMount } from 'svelte';

  interface Props {
    filePath: string;
    onClose: () => void;
  }

  let { filePath, onClose }: Props = $props();

  let content = $state('');
  let error = $state<string | null>(null);
  let loading = $state(true);

  let renderedHtml = $derived(content ? marked.parse(content) : '');

  let fileName = $derived(filePath.split('/').pop() ?? filePath);

  onMount(() => {
    loadFile();
  });

  async function loadFile() {
    loading = true;
    error = null;
    try {
      content = await invoke<string>('preview_read_file', { path: filePath });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="preview-backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="preview-modal" onclick={(e) => e.stopPropagation()}>
    <div class="preview-header">
      <span class="preview-filename">{fileName}</span>
      <button class="nav-btn close-btn" onclick={onClose} title="Close">&#x2715;</button>
    </div>
    <div class="preview-body">
      {#if loading}
        <div class="preview-status">Loading...</div>
      {:else if error}
        <div class="preview-status preview-error">{error}</div>
      {:else}
        <div class="markdown-content">
          {@html renderedHtml}
        </div>
      {/if}
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

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
  }

  .preview-filename {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
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

  .close-btn:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .preview-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
  }

  .preview-status {
    color: var(--text-muted);
    font-size: 12px;
  }

  .preview-error {
    color: var(--error);
  }

  .markdown-content {
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.6;
  }

  .markdown-content :global(h1) {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .markdown-content :global(h2) {
    font-size: 16px;
    font-weight: 700;
    margin: 20px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .markdown-content :global(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 16px 0 6px;
  }

  .markdown-content :global(h4),
  .markdown-content :global(h5),
  .markdown-content :global(h6) {
    font-size: 13px;
    font-weight: 600;
    margin: 12px 0 4px;
  }

  .markdown-content :global(p) {
    margin: 0 0 10px;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin: 0 0 10px;
    padding-left: 24px;
  }

  .markdown-content :global(li) {
    margin: 2px 0;
  }

  .markdown-content :global(code) {
    background: var(--tool-bg);
    padding: 1px 4px;
    font-size: 12px;
  }

  .markdown-content :global(pre) {
    background: var(--tool-bg);
    border: 1px solid var(--border);
    padding: 10px 12px;
    margin: 0 0 10px;
    overflow-x: auto;
  }

  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-content :global(blockquote) {
    border-left: 3px solid var(--text-muted);
    padding-left: 12px;
    margin: 0 0 10px;
    color: var(--text-secondary);
  }

  .markdown-content :global(table) {
    border-collapse: collapse;
    margin: 0 0 10px;
    width: 100%;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }

  .markdown-content :global(th) {
    background: var(--tool-bg);
    font-weight: 600;
  }

  .markdown-content :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }

  .markdown-content :global(a) {
    color: var(--active);
    text-decoration: none;
  }

  .markdown-content :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-content :global(img) {
    max-width: 100%;
  }
</style>
