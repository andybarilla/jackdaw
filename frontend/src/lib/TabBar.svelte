<script lang="ts">
  import type { PaneContent } from "./layout";
  import type { SessionInfo } from "./types";
  import { TAB_DRAG_MIME } from "./drag";


  interface Props {
    contents: PaneContent[];
    activeIndex: number;
    sessions: SessionInfo[];
    panePath: number[];
    onSelect: (index: number) => void;
    onClose: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onCrossDropTab: (data: string, targetIndex: number) => void;
  }

  let { contents, activeIndex, sessions, panePath, onSelect, onClose, onReorder, onCrossDropTab }: Props = $props();

  let dragFrom: number | null = $state(null);
  let dragOver: number | null = $state(null);

  function getLabel(content: PaneContent): string {
    if (content.type === "session") {
      const s = sessions.find((s) => s.id === content.sessionId);
      return s?.name || content.sessionId.slice(0, 8);
    }
    if (content.type === "terminal") return "Terminal";
    if (content.type === "settings") return "Settings";
    if (content.type === "diff") {
      const s = sessions.find((s) => s.id === content.sessionId);
      return `Diff: ${s?.name || content.sessionId.slice(0, 8)}`;
    }
    if (content.type === "browser") {
      try {
        return new URL(content.url).host;
      } catch {
        return "Browser";
      }
    }
    return "Unknown";
  }

  function handleDragStart(e: DragEvent, index: number): void {
    dragFrom = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Set cross-pane drag data
      e.dataTransfer.setData(
        TAB_DRAG_MIME,
        JSON.stringify({
          sourcePath: panePath,
          tabIndex: index,
          content: contents[index],
        }),
      );
    }
  }

  function handleDragOver(e: DragEvent, index: number): void {
    e.preventDefault();
    dragOver = index;
  }

  function handleDrop(e: DragEvent, index: number): void {
    e.preventDefault();

    // Check if this is a cross-pane drop
    const crossData = e.dataTransfer?.getData(TAB_DRAG_MIME);
    if (crossData) {
      try {
        const parsed = JSON.parse(crossData);
        const sourcePath = parsed.sourcePath as number[];
        // If from a different pane, handle as cross-pane move
        if (sourcePath.length !== panePath.length || !sourcePath.every((v: number, i: number) => v === panePath[i])) {
          onCrossDropTab(crossData, index);
          dragFrom = null;
          dragOver = null;
          return;
        }
      } catch {
        // fall through to local reorder
      }
    }

    if (dragFrom !== null && dragFrom !== index) {
      onReorder(dragFrom, index);
    }
    dragFrom = null;
    dragOver = null;
  }

  function handleDragEnd(): void {
    dragFrom = null;
    dragOver = null;
  }
</script>

<div class="tab-bar">
  {#each contents as content, i}
    <button
      class="tab"
      class:active={i === activeIndex}
      class:drag-over={i === dragOver && dragFrom !== null && dragFrom !== i}
      draggable="true"
      ondragstart={(e) => handleDragStart(e, i)}
      ondragover={(e) => handleDragOver(e, i)}
      ondrop={(e) => handleDrop(e, i)}
      ondragend={handleDragEnd}
      onclick={() => onSelect(i)}
    >
      <span class="tab-label">{getLabel(content)}</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <span
        class="tab-close"
        role="button"
        tabindex="-1"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onClose(i); }}
      >&times;</span>
    </button>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    height: 2.154rem;
    min-height: 2.154rem;
    background: var(--bg-secondary, #1e1e1e);
    border-bottom: 1px solid var(--border, #333);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.308rem;
    padding: 0 0.615rem;
    height: 100%;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-secondary, #888);
    font-size: 0.923rem;
    cursor: pointer;
    white-space: nowrap;
    min-width: 0;
    max-width: 12.308rem;
    flex-shrink: 0;
  }

  .tab:hover {
    color: var(--text-primary, #ccc);
    background: var(--bg-hover, #2a2a2a);
  }

  .tab.active {
    color: var(--text-primary, #ccc);
    border-bottom-color: var(--accent, #007acc);
  }

  .tab.drag-over {
    border-left: 2px solid var(--accent, #007acc);
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    opacity: 0;
    font-size: 1.077rem;
    line-height: 1;
    padding: 0 0.154rem;
    border-radius: 0.231rem;
    flex-shrink: 0;
  }

  .tab:hover .tab-close {
    opacity: 0.6;
  }

  .tab-close:hover {
    opacity: 1 !important;
    background: var(--bg-hover, #333);
  }
</style>
