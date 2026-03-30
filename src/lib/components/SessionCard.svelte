<script lang="ts">
  import type { Session } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { getUptime, getProjectName, shortenSessionId, formatEndedAt } from '$lib/utils';
  import { slide } from 'svelte/transition';
  import ToolIcon from './ToolIcon.svelte';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    historyMode?: boolean;
    endedAt?: string;
  }

  let { session, onDismiss, historyMode = false, endedAt }: Props = $props();

  let expanded = $state(false);

  type CardState = 'approval' | 'input' | 'running' | 'idle';

  let cardState = $derived<CardState>(
    session.pending_approval
      ? 'approval'
      : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
        ? 'running'
        : historyMode
          ? 'idle'
          : 'input'
  );

  let isActive = $derived(cardState === 'running');
  let isPending = $derived(cardState === 'approval');

  let uptime = $derived(historyMode && endedAt
    ? formatEndedAt(endedAt)
    : getUptime(session.started_at));
  let recentHistory = $derived(session.tool_history.slice(-5).reverse());

  // Last completed tool for dimmed state between rapid tool calls
  let lastTool = $derived(session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null);

  async function toggleExpand(): Promise<void> {
    expanded = !expanded;
    if (expanded && session.has_unread) {
      await invoke('mark_session_read', { sessionId: session.session_id });
    }
  }
</script>

<div
  class="card"
  class:expanded
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
>
  <!-- Header row: always visible, clickable -->
  <div class="row-header" onclick={toggleExpand} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleExpand())}>
    <div class="row-left">
      <span class="project-name">{getProjectName(session.cwd)}</span>
      {#if session.has_unread}
        <span class="unread-dot"></span>
      {/if}
      {#if cardState === 'approval'}
        <span class="state-label approval">APPROVAL</span>
      {:else if cardState === 'input' && !historyMode}
        <span class="state-label input">INPUT</span>
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

  {#if session.git_branch}
    <div class="metadata-row">
      <span class="branch-icon">⎇</span>
      <span class="branch-name">{session.git_branch}</span>
    </div>
  {/if}

  <!-- Tool row: visible when active -->
  {#if isActive || isPending}
    <div class="tool-row">
      {#if session.current_tool}
        <div class="tool-display" class:active={isActive && !isPending} class:attention={isPending}>
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
    border-left: 3px solid var(--accent-color, var(--border));
  }

  .card.has-attention {
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-color) 10%, transparent);
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

  .subagent-count {
    font-size: 11px;
    color: var(--active);
  }

  .uptime {
    font-size: 11px;
    color: var(--text-muted);
  }

  .chevron {
    font-size: 10px;
    color: var(--text-muted);
  }

  .metadata-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px 6px;
  }

  .branch-icon {
    font-size: 11px;
    color: var(--text-muted);
  }

  .branch-name {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Tool row */
  .tool-row {
    padding: 0 14px 10px;
  }

  .tool-display {
    background: var(--tool-bg);
    border: 1px solid var(--border);
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
    color: var(--active);
  }

  .tool-display.active {
    border-color: var(--border-active-tool);
  }

  .tool-display.attention {
    border-color: var(--border-attention-tool);
  }

  .tool-display.attention .tool-name {
    color: var(--attention);
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

  .state-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .state-label.approval {
    color: var(--state-approval);
  }

  .state-label.input {
    color: var(--state-input);
  }

  .unread-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-color);
    flex-shrink: 0;
  }

</style>
