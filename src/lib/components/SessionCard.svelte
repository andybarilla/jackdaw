<script lang="ts">
  import type { Session } from '$lib/types';
  import { getUptime, getProjectName, shortenSessionId, formatEndedAt } from '$lib/utils';
  import { slide } from 'svelte/transition';
  import ToolIcon from './ToolIcon.svelte';
  import SessionStatusIcon from './SessionStatusIcon.svelte';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    historyMode?: boolean;
    endedAt?: string;
  }

  let { session, onDismiss, historyMode = false, endedAt }: Props = $props();

  let expanded = $state(false);
  let isPending = $derived(session.pending_approval);
  let isActive = $derived(!isPending && (session.current_tool !== null || session.active_subagents > 0 || session.processing));
  let uptime = $derived(historyMode && endedAt
    ? formatEndedAt(endedAt)
    : getUptime(session.started_at));
  let recentHistory = $derived(session.tool_history.slice(-5).reverse());

  // Last completed tool for dimmed state between rapid tool calls
  let lastTool = $derived(session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null);

  function toggleExpand() {
    expanded = !expanded;
  }
</script>

<div class="card" class:expanded>
  <!-- Header row: always visible, clickable -->
  <div class="row-header" onclick={toggleExpand} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleExpand())}>
    <div class="row-left">
      <SessionStatusIcon {session} size={14} {historyMode} />
      <span class="project-name">{getProjectName(session.cwd)}</span>
      {#if !isActive && !isPending && !historyMode}
        <span class="idle-text">idle</span>
      {/if}
      {#if session.active_subagents > 0}
        <span class="subagent-count">· {session.active_subagents} agent{session.active_subagents === 1 ? '' : 's'}</span>
      {/if}
    </div>
    <div class="row-right">
      <span class="uptime">{uptime}</span>
      <span class="chevron">{expanded ? '▼' : '▶'}</span>
    </div>
  </div>

  <!-- Tool row: visible when active -->
  {#if isActive}
    <div class="tool-row">
      {#if session.current_tool}
        <div class="tool-display active">
          <ToolIcon tool_name={session.current_tool.tool_name} size={12} />
          <span class="tool-name">{session.current_tool.tool_name}</span>
          {#if session.current_tool.summary}
            <span class="tool-summary">{session.current_tool.summary}</span>
          {/if}
        </div>
      {:else if lastTool}
        <div class="tool-display dimmed">
          <ToolIcon tool_name={lastTool.tool_name} size={12} />
          <span class="tool-name">{lastTool.tool_name}</span>
          {#if lastTool.summary}
            <span class="tool-summary">{lastTool.summary}</span>
          {/if}
        </div>
      {:else}
        <div class="tool-display dimmed">
          <span class="tool-summary">processing...</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Expanded section: toggle on click -->
  {#if expanded}
    <div class="expanded-section" transition:slide={{ duration: 150 }}>
      <div class="expanded-header">
        <span class="session-id">Session {shortenSessionId(session.session_id)}</span>
        {#if !historyMode}
          <button class="dismiss" onclick={() => onDismiss(session.session_id)}>Dismiss</button>
        {/if}
      </div>
      {#if recentHistory.length > 0}
        <div class="history">
          {#each recentHistory as tool}
            <div class="history-item">
              <ToolIcon tool_name={tool.tool_name} size={11} />
              <span class="history-tool-name">{tool.tool_name}</span>
              {#if tool.summary}
                <span class="history-summary">{tool.summary}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .card.expanded {
    border-color: var(--blue);
  }

  .row-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
  }

  .row-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .row-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .project-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .idle-text {
    font-size: 11px;
    color: var(--text-muted);
  }

  .subagent-count {
    font-size: 11px;
    color: var(--blue);
  }

  .uptime {
    font-size: 11px;
    color: var(--text-muted);
  }

  .chevron {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* Tool row */
  .tool-row {
    padding: 0 14px 10px;
  }

  .tool-display {
    background: var(--tool-bg);
    border: 1px solid var(--tool-border);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .tool-display.dimmed {
    background: var(--card-bg);
    border-color: var(--border);
    opacity: 0.5;
  }

  .tool-display.active .tool-name {
    color: var(--blue);
  }

  .tool-name {
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .tool-summary {
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-display.dimmed .tool-name {
    color: var(--text-muted);
  }

  .tool-display.dimmed .tool-summary {
    color: var(--text-muted);
  }

  /* Expanded section */
  .expanded-section {
    border-top: 1px solid var(--border);
    margin: 0 14px;
    padding: 10px 0 12px;
  }

  .expanded-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .session-id {
    font-size: 11px;
    color: var(--text-muted);
  }

  .dismiss {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .dismiss:hover {
    background: var(--border);
    color: var(--text-primary);
  }

  .history {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.8;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .history-tool-name {
    color: var(--text-secondary);
  }

  .history-summary {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }


</style>
