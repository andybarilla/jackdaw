<script lang="ts">
  interface Props {
    url: string;
    proxyBaseUrl: string;
    onUrlChange: (url: string) => void;
  }

  let { url, proxyBaseUrl, onUrlChange }: Props = $props();

  let inputValue = $state("");
  let iframeKey = $state(0);

  let iframeSrc = $derived(proxyBaseUrl ? `${proxyBaseUrl}/${url}` : url);

  $effect(() => {
    inputValue = url;
  });

  function navigate() {
    let target = inputValue.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) {
      target = "http://" + target;
      inputValue = target;
    }
    onUrlChange(target);
    iframeKey++;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate();
    }
  }

  function refresh() {
    iframeKey++;
  }
</script>

<div class="browser-pane">
  <div class="url-bar">
    <input
      type="text"
      bind:value={inputValue}
      onkeydown={handleKeydown}
      spellcheck="false"
    />
    <button class="refresh-btn" onclick={refresh} title="Refresh">&#x21bb;</button>
  </div>
  <div class="iframe-container">
    {#key iframeKey}
      <iframe src={iframeSrc} title="Browser Preview"></iframe>
    {/key}
  </div>
</div>

<style>
  .browser-pane {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .url-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--bg-secondary, #1e1e1e);
    border-bottom: 1px solid var(--border, #333);
  }

  .url-bar input {
    flex: 1;
    background: var(--bg-primary, #111);
    color: var(--text-primary, #ccc);
    border: 1px solid var(--border, #333);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
  }

  .url-bar input:focus {
    border-color: var(--accent, #007acc);
  }

  .refresh-btn {
    background: transparent;
    border: 1px solid var(--border, #333);
    border-radius: 4px;
    color: var(--text-secondary, #999);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 1rem;
    line-height: 1;
  }

  .refresh-btn:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, #2a2a2a);
  }

  .iframe-container {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
</style>
