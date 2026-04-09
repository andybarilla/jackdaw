<script lang="ts">
  interface Props {
    direction: "horizontal" | "vertical";
    onRatioChange: (ratio: number) => void;
  }

  let { direction, onRatioChange }: Props = $props();
  let dragging = $state(false);
  let ghostOffset = $state<number | null>(null);
  let ghostPosition = $state<number | null>(null);
  let dividerEl: HTMLDivElement;

  function handlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    dragging = true;
    dividerEl.setPointerCapture(event.pointerId);

    const parent = dividerEl.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    function handlePointerMove(e: PointerEvent): void {
      if (direction === "vertical") {
        ghostOffset = e.clientX - rect.left;
        ghostPosition = e.clientX;
      } else {
        ghostOffset = e.clientY - rect.top;
        ghostPosition = e.clientY;
      }
    }

    function handlePointerUp(e: PointerEvent): void {
      dividerEl.releasePointerCapture(e.pointerId);
      dragging = false;

      if (ghostOffset !== null) {
        const total = direction === "vertical" ? rect.width : rect.height;
        if (total > 0) {
          onRatioChange(ghostOffset / total);
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("pane-resize"));
          });
        }
      }
      ghostOffset = null;
      ghostPosition = null;

      dividerEl.removeEventListener("pointermove", handlePointerMove);
      dividerEl.removeEventListener("pointerup", handlePointerUp);
    }

    dividerEl.addEventListener("pointermove", handlePointerMove);
    dividerEl.addEventListener("pointerup", handlePointerUp);
  }

  function handleDblClick(): void {
    onRatioChange(0.5);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("pane-resize"));
    });
  }
</script>

<div
  class="divider"
  class:vertical={direction === "vertical"}
  class:horizontal={direction === "horizontal"}
  class:dragging
  bind:this={dividerEl}
  onpointerdown={handlePointerDown}
  ondblclick={handleDblClick}
  role="separator"
  aria-orientation={direction}
>
  {#if dragging && ghostPosition !== null}
    <div
      class="ghost"
      style={direction === "vertical"
        ? `left: ${ghostPosition}px; top: 0; bottom: 0; width: 2px;`
        : `top: ${ghostPosition}px; left: 0; right: 0; height: 2px;`}
    ></div>
  {/if}
</div>

<style>
  .divider {
    flex-shrink: 0;
    position: relative;
    z-index: 2;
  }

  .divider.vertical {
    width: 4px;
    cursor: col-resize;
  }

  .divider.horizontal {
    height: 4px;
    cursor: row-resize;
  }

  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  .ghost {
    position: fixed;
    background: var(--accent);
    opacity: 0.6;
    pointer-events: none;
    z-index: 100;
  }
</style>
