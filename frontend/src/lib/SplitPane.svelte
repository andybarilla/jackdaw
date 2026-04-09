<script lang="ts">
  import type { LayoutNode } from "./layout";
  import type { DropZone } from "./layout";
  import type { TerminalApi, SessionInfo } from "./types";
  import PaneContainer from "./PaneContainer.svelte";
  import DragDivider from "./DragDivider.svelte";
  import SplitPane from "./SplitPane.svelte";
  import type { PaneContent } from "./layout";

  interface Props {
    node: LayoutNode;
    path: number[];
    focusedPath: number[];
    searchVisible: boolean;
    terminalApis: Record<string, TerminalApi>;
    sessions?: SessionInfo[];
    onFocus: (path: number[]) => void;
    onRatioChange: (path: number[], ratio: number) => void;
    onQuickPick: (path: number[], choice: "terminal" | "session") => void;
    onTerminalReady: (id: string, api: TerminalApi) => void;
    onMerge?: (sessionId: string) => void;
    onSelectSession?: (id: string) => void;
    onRemoveSession?: (id: string) => void;
    onRestartSession?: (id: string) => void;
    onTabSelect: (path: number[], index: number) => void;
    onTabClose: (path: number[], index: number) => void;
    onTabReorder: (path: number[], fromIndex: number, toIndex: number) => void;
    onTabDrop: (path: number[], data: string, zone: DropZone, insertIndex?: number) => void;
  }

  let {
    node,
    path,
    focusedPath,
    searchVisible,
    terminalApis,
    sessions,
    onFocus,
    onRatioChange,
    onQuickPick,
    onTerminalReady,
    onMerge,
    onSelectSession,
    onRemoveSession,
    onRestartSession,
    onTabSelect,
    onTabClose,
    onTabReorder,
    onTabDrop,
  }: Props = $props();

  function isFocused(leafPath: number[]): boolean {
    if (leafPath.length !== focusedPath.length) return false;
    return leafPath.every((v, i) => v === focusedPath[i]);
  }

  function getActiveContentId(contents: PaneContent[], activeIndex: number): string | null {
    const content = contents[activeIndex];
    if (!content) return null;
    return content.type === "session" ? content.sessionId : content.type === "terminal" ? content.id : null;
  }
</script>

{#if node.type === "leaf"}
  {@const contentId = getActiveContentId(node.contents, node.activeIndex)}
  <PaneContainer
    contents={node.contents}
    activeIndex={node.activeIndex}
    focused={isFocused(path)}
    searchVisible={searchVisible && isFocused(path)}
    terminalApi={contentId ? terminalApis[contentId] ?? null : null}
    {sessions}
    panePath={path}
    onFocus={() => onFocus(path)}
    onQuickPick={(choice) => onQuickPick(path, choice)}
    onTerminalReady={(api) => {
      if (contentId) onTerminalReady(contentId, api);
    }}
    {onMerge}
    {onSelectSession}
    {onRemoveSession}
    {onRestartSession}
    onTabSelect={(index) => onTabSelect(path, index)}
    onTabClose={(index) => onTabClose(path, index)}
    onTabReorder={(from, to) => onTabReorder(path, from, to)}
    onTabDrop={(data, zone, insertIndex) => onTabDrop(path, data, zone, insertIndex)}
  />
{:else}
  <div
    class="split-container"
    class:vertical={node.direction === "vertical"}
    class:horizontal={node.direction === "horizontal"}
  >
    <div
      class="split-child"
      style={node.direction === "vertical"
        ? `width: ${node.ratio * 100}%`
        : `height: ${node.ratio * 100}%`}
    >
      <SplitPane
        node={node.children[0]}
        path={[...path, 0]}
        {focusedPath}
        {searchVisible}
        {terminalApis}
        {sessions}
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
        {onMerge}
        {onSelectSession}
        {onRemoveSession}
        {onRestartSession}
        {onTabSelect}
        {onTabClose}
        {onTabReorder}
        {onTabDrop}
      />
    </div>

    <DragDivider
      direction={node.direction}
      onRatioChange={(ratio) => onRatioChange(path, ratio)}
    />

    <div
      class="split-child"
      style={node.direction === "vertical"
        ? `width: ${(1 - node.ratio) * 100}%`
        : `height: ${(1 - node.ratio) * 100}%`}
    >
      <SplitPane
        node={node.children[1]}
        path={[...path, 1]}
        {focusedPath}
        {searchVisible}
        {terminalApis}
        {sessions}
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
        {onMerge}
        {onSelectSession}
        {onRemoveSession}
        {onRestartSession}
        {onTabSelect}
        {onTabClose}
        {onTabReorder}
        {onTabDrop}
      />
    </div>
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
  }

  .split-container.vertical {
    flex-direction: row;
  }

  .split-container.horizontal {
    flex-direction: column;
  }

  .split-child {
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }
</style>
