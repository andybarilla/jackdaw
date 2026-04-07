<script lang="ts">
  import type { PaneContent } from "./layout";
  import type { TerminalApi } from "./types";
  import Terminal from "./Terminal.svelte";
  import SearchBar from "./SearchBar.svelte";
  import QuickPicker from "./QuickPicker.svelte";

  interface Props {
    content: PaneContent;
    focused: boolean;
    searchVisible: boolean;
    terminalApi: TerminalApi | null;
    onFocus: () => void;
    onQuickPick: (choice: "terminal" | "session") => void;
    onTerminalReady: (api: TerminalApi) => void;
  }

  let {
    content,
    focused,
    searchVisible,
    terminalApi,
    onFocus,
    onQuickPick,
    onTerminalReady,
  }: Props = $props();

  let contentId = $derived(
    content === null
      ? null
      : content.type === "session"
        ? content.sessionId
        : content.id,
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pane-container" class:focused onclick={onFocus}>
  {#if content === null}
    <QuickPicker onSelect={onQuickPick} />
  {:else if contentId}
    <Terminal
      sessionId={contentId}
      visible={true}
      onReady={onTerminalReady}
    />
    {#if searchVisible && terminalApi}
      <SearchBar
        searchAddon={terminalApi.searchAddon}
        onClose={() => {
          terminalApi?.focus();
        }}
      />
    {/if}
  {/if}
</div>

<style>
  .pane-container {
    width: 100%;
    height: 100%;
    position: relative;
    border: 1px solid transparent;
    box-sizing: border-box;
    overflow: hidden;
  }

  .pane-container.focused {
    border-color: var(--accent);
  }
</style>
