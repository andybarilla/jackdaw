<script lang="ts">
  import type { SearchAddon } from "@xterm/addon-search";

  interface Props {
    searchAddon: SearchAddon;
    onClose: () => void;
  }

  let { searchAddon, onClose }: Props = $props();
  let query = $state("");
  let caseSensitive = $state(false);
  let regex = $state(false);
  let wholeWord = $state(false);
  let resultIndex = $state(-1);
  let resultCount = $state(0);
  let inputEl: HTMLInputElement;

  let cleanup: { dispose: () => void } | undefined;

  $effect(() => {
    cleanup = searchAddon.onDidChangeResults((e) => {
      resultIndex = e.resultIndex;
      resultCount = e.resultCount;
    });
    return () => cleanup?.dispose();
  });

  $effect(() => {
    // Re-run search when options change
    if (query) {
      searchAddon.findNext(query, { caseSensitive, regex, wholeWord, incremental: true });
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        searchAddon.findPrevious(query, { caseSensitive, regex, wholeWord });
      } else {
        searchAddon.findNext(query, { caseSensitive, regex, wholeWord });
      }
    }
  }

  function close(): void {
    searchAddon.clearDecorations();
    onClose();
  }

  export function focusInput(): void {
    inputEl?.focus();
    inputEl?.select();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-bar" onkeydown={handleKeydown}>
  <input
    bind:this={inputEl}
    bind:value={query}
    type="text"
    placeholder="Search…"
    spellcheck="false"
    autocomplete="off"
  />
  <span class="result-count">
    {#if query && resultCount > 0}
      {resultIndex + 1}/{resultCount}
    {:else if query}
      0 results
    {/if}
  </span>
  <button
    class="option-toggle"
    class:active={caseSensitive}
    onclick={() => (caseSensitive = !caseSensitive)}
    title="Case sensitive"
  >Aa</button>
  <button
    class="option-toggle"
    class:active={wholeWord}
    onclick={() => (wholeWord = !wholeWord)}
    title="Whole word"
  >W</button>
  <button
    class="option-toggle"
    class:active={regex}
    onclick={() => (regex = !regex)}
    title="Regex"
  >.*</button>
  <button class="nav-btn" onclick={() => searchAddon.findPrevious(query, { caseSensitive, regex, wholeWord })} title="Previous (Shift+Enter)">&#x25B2;</button>
  <button class="nav-btn" onclick={() => searchAddon.findNext(query, { caseSensitive, regex, wholeWord })} title="Next (Enter)">&#x25BC;</button>
  <button class="close-btn" onclick={close} title="Close (Esc)">&times;</button>
</div>

<style>
  .search-bar {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  input {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    padding: 4px 8px;
    font-size: 13px;
    font-family: inherit;
    width: 200px;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .result-count {
    color: var(--text-muted);
    font-size: 12px;
    min-width: 50px;
    text-align: center;
  }

  .option-toggle {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    font-family: monospace;
  }

  .option-toggle:hover {
    background: var(--bg-tertiary);
  }

  .option-toggle.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .nav-btn,
  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .nav-btn:hover,
  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
