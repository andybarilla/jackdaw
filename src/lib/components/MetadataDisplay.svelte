<script lang="ts">
  import type { MetadataEntry } from '$lib/types';

  interface Props {
    entries: MetadataEntry[];
    accentColor?: string;
  }

  let { entries, accentColor = 'var(--active)' }: Props = $props();

  let expandedLogs = $state<Set<string>>(new Set());

  function toggleLog(key: string): void {
    const next = new Set(expandedLogs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedLogs = next;
  }
</script>

{#if entries.length > 0}
  <div class="metadata-entries">
    {#each entries as entry (entry.key)}
      {#if entry.value.type === 'text'}
        <div class="meta-row">
          <span class="meta-key">{entry.key}</span>
          <span class="meta-value">{entry.value.content}</span>
        </div>
      {:else if entry.value.type === 'progress'}
        <div class="meta-progress">
          <div class="meta-row">
            <span class="meta-key">{entry.key}</span>
            <span class="meta-value">{Math.round(entry.value.content)}%</span>
          </div>
          <div class="progress-track">
            <div
              class="progress-bar"
              style="width: {Math.min(100, Math.max(0, entry.value.content))}%; background: {accentColor}"
            ></div>
          </div>
        </div>
      {:else if entry.value.type === 'log'}
        <div class="meta-log">
          <div
            class="meta-row clickable"
            onclick={() => toggleLog(entry.key)}
            role="button"
            tabindex="0"
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleLog(entry.key))}
          >
            <span class="meta-key">{entry.key}</span>
            <span class="meta-value">{expandedLogs.has(entry.key) ? '▾' : '▸'} {entry.value.content.length} line{entry.value.content.length === 1 ? '' : 's'}</span>
          </div>
          {#if expandedLogs.has(entry.key)}
            <pre class="log-block">{entry.value.content.join('\n')}</pre>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .metadata-entries {
    padding: 6px 14px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .meta-row.clickable {
    cursor: pointer;
    user-select: none;
  }

  .meta-key {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  .meta-value {
    font-size: 11px;
    color: var(--text-primary);
  }

  .meta-progress {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .progress-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .log-block {
    font-family: monospace;
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--tool-bg);
    border: 1px solid var(--border);
    padding: 6px 8px;
    margin: 4px 0 0;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
