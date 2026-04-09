<script lang="ts">
  import type { PaneContent } from "./layout";
  import type { DropZone } from "./layout";
  import type { TerminalApi, SessionInfo } from "./types";
  import { TAB_DRAG_MIME } from "./drag";
  import Terminal from "./Terminal.svelte";
  import SearchBar from "./SearchBar.svelte";
  import QuickPicker from "./QuickPicker.svelte";
  import DiffViewer from "./DiffViewer.svelte";
  import SettingsEditor from "./SettingsEditor.svelte";
  import TabBar from "./TabBar.svelte";

  interface Props {
    contents: PaneContent[];
    activeIndex: number;
    focused: boolean;
    searchVisible: boolean;
    terminalApi: TerminalApi | null;
    sessions?: SessionInfo[];
    panePath: number[];
    onFocus: () => void;
    onQuickPick: (choice: "terminal" | "session") => void;
    onTerminalReady: (api: TerminalApi) => void;
    onMerge?: (sessionId: string) => void;
    onSelectSession?: (id: string) => void;
    onTabSelect: (index: number) => void;
    onTabClose: (index: number) => void;
    onTabReorder: (fromIndex: number, toIndex: number) => void;
    onTabDrop: (data: string, zone: DropZone, insertIndex?: number) => void;
  }

  let {
    contents,
    activeIndex,
    focused,
    searchVisible,
    terminalApi,
    sessions,
    panePath,
    onFocus,
    onQuickPick,
    onTerminalReady,
    onMerge,
    onSelectSession,
    onTabSelect,
    onTabClose,
    onTabReorder,
    onTabDrop,
  }: Props = $props();

  let content = $derived(contents[activeIndex] ?? null);

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

  let dropZone = $state<DropZone | null>(null);
  let paneEl: HTMLDivElement | undefined = $state();

  function isTabDrag(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(TAB_DRAG_MIME) ?? false;
  }

  function computeZone(e: DragEvent): DropZone {
    if (!paneEl) return "center";
    const rect = paneEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const edgeThreshold = 0.22;

    if (x < edgeThreshold) return "left";
    if (x > 1 - edgeThreshold) return "right";
    if (y < edgeThreshold) return "top";
    if (y > 1 - edgeThreshold) return "bottom";
    return "center";
  }

  function handlePaneDragOver(e: DragEvent): void {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropZone = computeZone(e);
  }

  function handlePaneDragLeave(e: DragEvent): void {
    // Only clear if we actually left the pane (not entering a child)
    if (paneEl && !paneEl.contains(e.relatedTarget as Node)) {
      dropZone = null;
    }
  }

  function handlePaneDrop(e: DragEvent): void {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
    if (data && dropZone) {
      onTabDrop(data, dropZone);
    }
    dropZone = null;
  }

  function handleCrossDropOnTabBar(data: string, targetIndex: number): void {
    onTabDrop(data, "center", targetIndex);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="pane-container"
  class:focused
  bind:this={paneEl}
  onclick={onFocus}
  ondragover={handlePaneDragOver}
  ondragleave={handlePaneDragLeave}
  ondrop={handlePaneDrop}
>
  {#if contents.length >= 1 && sessions}
    <TabBar
      {contents}
      {activeIndex}
      sessions={sessions}
      {panePath}
      onSelect={onTabSelect}
      onClose={onTabClose}
      onReorder={onTabReorder}
      onCrossDropTab={handleCrossDropOnTabBar}
    />
  {/if}

  <div class="pane-content">
    {#if content === null}
      <QuickPicker onSelect={onQuickPick} />
    {:else if content.type === "diff"}
      <DiffViewer
        sessionId={content.sessionId}
        worktreeEnabled={diffSession?.worktree_enabled}
        baseBranch={diffSession?.base_branch}
        onMerge={onMerge && content.sessionId ? () => onMerge(content.sessionId) : undefined}
      />
    {:else if content.type === "settings"}
      <SettingsEditor />
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

  {#if dropZone}
    <div class="drop-overlay" class:zone-center={dropZone === "center"} class:zone-left={dropZone === "left"} class:zone-right={dropZone === "right"} class:zone-top={dropZone === "top"} class:zone-bottom={dropZone === "bottom"}>
      <div class="drop-highlight"></div>
    </div>
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
    display: flex;
    flex-direction: column;
  }

  .pane-container.focused {
    border-color: var(--accent);
  }

  .pane-content {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 100;
  }

  .drop-highlight {
    position: absolute;
    background: rgba(0, 122, 204, 0.15);
    border: 2px solid rgba(0, 122, 204, 0.6);
    border-radius: 4px;
    transition: all 0.1s ease;
  }

  .zone-center .drop-highlight {
    inset: 4px;
  }

  .zone-left .drop-highlight {
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc(50% - 6px);
  }

  .zone-right .drop-highlight {
    top: 4px;
    bottom: 4px;
    right: 4px;
    width: calc(50% - 6px);
  }

  .zone-top .drop-highlight {
    left: 4px;
    right: 4px;
    top: 4px;
    height: calc(50% - 6px);
  }

  .zone-bottom .drop-highlight {
    left: 4px;
    right: 4px;
    bottom: 4px;
    height: calc(50% - 6px);
  }
</style>
