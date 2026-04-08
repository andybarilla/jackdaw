<script lang="ts">
  import type { LayoutNode, PaneContent } from "./layout";
  import type { TerminalApi } from "./types";
  import PaneContainer from "./PaneContainer.svelte";
  import DragDivider from "./DragDivider.svelte";
  import SplitPane from "./SplitPane.svelte";

  interface Props {
    node: LayoutNode;
    path: number[];
    focusedPath: number[];
    searchVisible: boolean;
    terminalApis: Record<string, TerminalApi>;
    onFocus: (path: number[]) => void;
    onRatioChange: (path: number[], ratio: number) => void;
    onQuickPick: (path: number[], choice: "terminal" | "session") => void;
    onTerminalReady: (id: string, api: TerminalApi) => void;
  }

  let {
    node,
    path,
    focusedPath,
    searchVisible,
    terminalApis,
    onFocus,
    onRatioChange,
    onQuickPick,
    onTerminalReady,
  }: Props = $props();

  function isFocused(leafPath: number[]): boolean {
    if (leafPath.length !== focusedPath.length) return false;
    return leafPath.every((v, i) => v === focusedPath[i]);
  }

  function getContentId(content: PaneContent): string | null {
    if (content === null) return null;
    return content.type === "session" ? content.sessionId : content.type === "terminal" ? content.id : null;
  }
</script>

{#if node.type === "leaf"}
  {@const contentId = getContentId(node.content)}
  <PaneContainer
    content={node.content}
    focused={isFocused(path)}
    searchVisible={searchVisible && isFocused(path)}
    terminalApi={contentId ? terminalApis[contentId] ?? null : null}
    onFocus={() => onFocus(path)}
    onQuickPick={(choice) => onQuickPick(path, choice)}
    onTerminalReady={(api) => {
      if (contentId) onTerminalReady(contentId, api);
    }}
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
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
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
        {onFocus}
        {onRatioChange}
        {onQuickPick}
        {onTerminalReady}
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
