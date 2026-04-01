<script lang="ts">
  import type { Session } from '$lib/types';
  import { getProjectName, getSessionState } from '$lib/utils';
  import ToolIcon from './ToolIcon.svelte';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    onSelect: (sessionId: string) => void;
    onOpenShell: (sessionId: string) => void;
  }

  let { session, onDismiss, onSelect, onOpenShell }: Props = $props();

  let state = $derived(getSessionState(session));
  let lastTool = $derived(
    session.current_tool ?? (session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null)
  );
</script>

<div
  class="tree-node"
  style="--node-color: var(--state-{state})"
  onclick={() => onSelect(session.session_id)}
  role="button"
  tabindex="0"
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(session.session_id)}
>
  <div class="node-header">
    <span class="node-name">{getProjectName(session.cwd, session.display_name)}</span>
    <span class="node-state">{state === 'approval' ? 'APPROVAL' : state === 'running' ? 'RUNNING' : 'INPUT'}</span>
  </div>
  {#if lastTool}
    <div class="node-tool">
      <ToolIcon tool_name={lastTool.tool_name} size={10} />
      <span class="node-tool-name">{lastTool.tool_name}</span>
      {#if lastTool.summary}
        <span class="node-tool-summary">{lastTool.summary}</span>
      {/if}
    </div>
  {/if}
  <div class="node-actions">
    <button class="node-btn" onclick={(e) => { e.stopPropagation(); onDismiss(session.session_id); }}>Dismiss</button>
    <button class="node-btn" onclick={(e) => { e.stopPropagation(); onOpenShell(session.session_id); }}>&#x25B8;_</button>
  </div>
</div>

<style>
  .tree-node {
    background: var(--card-bg);
    border: 2px solid var(--node-color, var(--border));
    border-radius: 4px;
    padding: 10px 14px;
    min-width: 180px;
    max-width: 240px;
    cursor: pointer;
  }

  .tree-node:hover {
    background: var(--tool-bg);
  }

  .node-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    gap: 8px;
  }

  .node-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-state {
    font-size: 9px;
    font-weight: 600;
    color: var(--node-color);
    flex-shrink: 0;
  }

  .node-tool {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    overflow: hidden;
  }

  .node-tool-name {
    font-size: 10px;
    font-weight: 600;
    color: var(--node-color);
    flex-shrink: 0;
  }

  .node-tool-summary {
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-actions {
    display: flex;
    gap: 4px;
  }

  .node-btn {
    background: var(--tool-bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 9px;
    padding: 2px 6px;
    cursor: pointer;
    border-radius: 2px;
  }

  .node-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
</style>
