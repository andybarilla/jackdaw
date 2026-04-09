<script lang="ts">
  import type { PaneContent } from "./layout";
  import type { TerminalApi, SessionInfo } from "./types";
  import Terminal from "./Terminal.svelte";
  import SearchBar from "./SearchBar.svelte";
  import QuickPicker from "./QuickPicker.svelte";
  import DiffViewer from "./DiffViewer.svelte";

  interface Props {
    content: PaneContent;
    focused: boolean;
    searchVisible: boolean;
    terminalApi: TerminalApi | null;
    sessions?: SessionInfo[];
    onFocus: () => void;
    onQuickPick: (choice: "terminal" | "session") => void;
    onTerminalReady: (api: TerminalApi) => void;
    onMerge?: (sessionId: string) => void;
  }

  let {
    content,
    focused,
    searchVisible,
    terminalApi,
    sessions,
    onFocus,
    onQuickPick,
    onTerminalReady,
    onMerge,
  }: Props = $props();

  let contentId = $derived(
    content === null
      ? null
      : content.type === "session"
        ? content.sessionId
        : content.type === "terminal"
          ? content.id
          : null,
  );

  let diffSession = $derived(
    content?.type === "diff" && sessions
      ? sessions.find((s) => s.id === content.sessionId) ?? null
      : null,
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pane-container" class:focused onclick={onFocus}>
  {#if content === null}
    <QuickPicker onSelect={onQuickPick} />
  {:else if content.type === "diff"}
    <DiffViewer
      sessionId={content.sessionId}
      worktreeEnabled={diffSession?.worktree_enabled}
      baseBranch={diffSession?.base_branch}
      onMerge={onMerge && content.sessionId ? () => onMerge(content.sessionId) : undefined}
    />
  {:else if contentId}
    {#key contentId}
      <Terminal
        sessionId={contentId}
        visible={true}
        onReady={onTerminalReady}
      />
    {/key}
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
