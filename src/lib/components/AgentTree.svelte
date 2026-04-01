<script lang="ts">
  import type { Session } from '$lib/types';
  import TreeNode from './TreeNode.svelte';

  interface Props {
    parentSession: Session;
    childSessions: Session[];
    onDismiss: (sessionId: string) => void;
    onSelect: (sessionId: string) => void;
    onOpenShell: (sessionId: string) => void;
  }

  let { parentSession, childSessions, onDismiss, onSelect, onOpenShell }: Props = $props();
</script>

<div class="agent-tree">
  <div class="tree-layout">
    <div class="parent-col">
      <TreeNode session={parentSession} {onDismiss} {onSelect} {onOpenShell} />
    </div>

    {#if childSessions.length > 0}
      <div class="connector-col">
        {#each childSessions as _, i}
          <div class="connector-segment" class:first={i === 0} class:last={i === childSessions.length - 1} class:only={childSessions.length === 1}></div>
        {/each}
      </div>

      <div class="children-col">
        {#each childSessions as child (child.session_id)}
          <TreeNode session={child} {onDismiss} {onSelect} {onOpenShell} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .agent-tree {
    padding: 24px;
    overflow: auto;
  }

  .tree-layout {
    display: flex;
    align-items: flex-start;
  }

  .parent-col {
    display: flex;
    align-items: center;
    align-self: center;
  }

  .connector-col {
    display: flex;
    flex-direction: column;
    width: 40px;
    align-self: stretch;
  }

  .connector-segment {
    flex: 1;
    border-right: 1px solid var(--border);
    min-height: 20px;
  }

  .connector-segment.first {
    border-top: none;
    border-bottom: 1px solid var(--border);
  }

  .connector-segment.last {
    border-top: 1px solid var(--border);
    border-bottom: none;
  }

  .connector-segment.only {
    border-top: none;
    border-bottom: none;
    border-right: 1px solid var(--border);
    position: relative;
  }

  .connector-segment.only::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 0;
    width: 100%;
    height: 1px;
    background: var(--border);
  }

  .connector-segment:not(.first):not(.last):not(.only) {
    border-top: none;
    border-bottom: none;
  }

  .children-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    justify-content: center;
  }
</style>
