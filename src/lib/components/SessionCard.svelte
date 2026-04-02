<script lang="ts">
  import type { Session, CustomCommand } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { getUptime, getProjectName, shortenSessionId, formatEndedAt, getSessionState, computeToolVelocity } from '$lib/utils';
  import { slide } from 'svelte/transition';
  import ToolIcon from './ToolIcon.svelte';
  import MetadataDisplay from './MetadataDisplay.svelte';
  import CommandBar from './CommandBar.svelte';
  import { displayToolName } from '$lib/tools';
  import { isPreviewableFile } from '$lib/files';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
    historyMode?: boolean;
    endedAt?: string;
    compact?: boolean;
    onOpenShell?: (sessionId: string) => void;
    onPreviewUrl?: (url: string) => void;
    onPreviewFile?: (path: string) => void;
  }

  let { session, onDismiss, historyMode = false, endedAt, compact = false, onOpenShell, onPreviewUrl, onPreviewFile }: Props = $props();

  let expanded = $state(false);

  let cardState = $derived(
    historyMode
      ? (session.pending_approval
          ? 'approval'
          : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
            ? 'running'
            : 'idle')
      : getSessionState(session)
  );

  let isActive = $derived(cardState === 'running');
  let isPending = $derived(cardState === 'approval');

  let uptime = $derived(historyMode && endedAt
    ? formatEndedAt(endedAt)
    : getUptime(session.started_at));
  let recentHistory = $derived(session.tool_history.slice(-5).reverse());

  // Last completed tool for dimmed state between rapid tool calls
  let lastTool = $derived(session.tool_history.length > 0 ? session.tool_history[session.tool_history.length - 1] : null);
  let metadataEntries = $derived(
    Object.values(session.metadata).filter(
      (e) => !(e.key === 'progress' && e.value.type === 'progress')
    )
  );

  let explicitProgress = $derived(
    session.metadata['progress']?.value.type === 'progress'
      ? session.metadata['progress'].value.content
      : null
  );

  let toolVelocity = $derived(
    computeToolVelocity(session.tool_history, session.current_tool, session.started_at)
  );

  let prevProcessing = $state(session.processing);
  let showCompletion = $state(false);

  $effect(() => {
    if (prevProcessing && !session.processing) {
      showCompletion = true;
      const timer = setTimeout(() => (showCompletion = false), 2000);
      return () => clearTimeout(timer);
    }
    prevProcessing = session.processing;
  });

  let customCommands = $state<CustomCommand[]>([]);

  $effect(() => {
    if (!historyMode) {
      invoke<CustomCommand[]>('get_custom_commands', { cwd: session.cwd }).then(
        (cmds) => (customCommands = cmds)
      );
    }
  });

  function handleUrlClick(event: MouseEvent, url: string): void {
    event.stopPropagation();
    onPreviewUrl?.(url);
  }

  function handleFileClick(event: MouseEvent, path: string) {
    event.stopPropagation();
    onPreviewFile?.(path);
  }

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
  class:completion-flash={showCompletion}
  style="--accent-color: var(--state-{cardState})"
  class:has-attention={cardState === 'approval' || cardState === 'input'}
  class:alert-high={session.alert_tier === 'high'}
  class:alert-medium={session.alert_tier === 'medium'}
  class:alert-low={session.alert_tier === 'low'}
>
  <!-- Header row: always visible, clickable -->
  <div class="row-header" onclick={() => !compact && toggleExpand()} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !compact && toggleExpand())}>
    <div class="row-left">
      <span class="project-name">{getProjectName(session.cwd, session.display_name)}</span>
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
      {#if isActive && toolVelocity.total > 0}
        <span class="tool-velocity">{toolVelocity.total} tools · {toolVelocity.rate}/min</span>
      {/if}
      <span class="uptime">{uptime}</span>
      {#if onOpenShell && !historyMode}
        <button
          class="open-terminal"
          title="Open terminal"
          onclick={(e) => { e.stopPropagation(); onOpenShell(session.session_id); }}
        >&#x25B8;_</button>
      {/if}
      <span class="chevron">{expanded ? '▼' : '▶'}</span>
    </div>
  </div>

  {#if session.git_branch}
    <div class="metadata-row">
      <span class="branch-icon">⎇</span>
      <span class="branch-name">{session.git_branch}</span>
    </div>
  {/if}

  {#if session.source_tool && session.source_tool !== 'claude-code'}
    <div class="metadata-row">
      <span class="source-label">{session.source_tool}</span>
    </div>
  {/if}

  {#if explicitProgress !== null}
    <div class="card-progress">
      <div
        class="card-progress-fill"
        style="width: {Math.min(100, Math.max(0, explicitProgress))}%; background: var(--accent-color)"
      ></div>
    </div>
  {/if}

  <!-- Tool row: visible when active -->
  {#if isActive || isPending}
    <div class="tool-row">
      {#if session.current_tool}
        <div class="tool-display" class:active={isActive && !isPending} class:attention={isPending}>
          <ToolIcon tool_name={session.current_tool.tool_name} size={12} />
          <span class="tool-name">{displayToolName(session.current_tool.tool_name)}</span>
          {#if session.current_tool.summary}
            <span class="tool-summary">{session.current_tool.summary}</span>
          {/if}
          {#if session.current_tool!.urls.length > 0 && onPreviewUrl}
            <button
              class="preview-btn"
              onclick={(e) => handleUrlClick(e, session.current_tool!.urls[0])}
              title={session.current_tool!.urls[0]}
            >&#x2197;</button>
          {/if}
          {#if session.current_tool!.file_path && isPreviewableFile(session.current_tool!.file_path) && onPreviewFile}
            <button
              class="preview-btn"
              onclick={(e) => handleFileClick(e, session.current_tool!.file_path!)}
              title={session.current_tool!.file_path!}
            >&#x2197;</button>
          {/if}
        </div>
      {:else if lastTool}
        <div class="tool-display dimmed">
          <ToolIcon tool_name={lastTool.tool_name} size={12} />
          <span class="tool-name">{displayToolName(lastTool.tool_name)}</span>
          {#if lastTool.summary}
            <span class="tool-summary">{lastTool.summary}</span>
          {/if}
          {#if lastTool.urls.length > 0 && onPreviewUrl}
            <button
              class="preview-btn"
              onclick={(e) => handleUrlClick(e, lastTool.urls[0])}
              title={lastTool.urls[0]}
            >&#x2197;</button>
          {/if}
          {#if lastTool.file_path && isPreviewableFile(lastTool.file_path) && onPreviewFile}
            <button
              class="preview-btn"
              onclick={(e) => handleFileClick(e, lastTool.file_path!)}
              title={lastTool.file_path!}
            >&#x2197;</button>
          {/if}
        </div>
      {:else}
        <div class="tool-display dimmed">
          <span class="tool-summary">processing...</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if customCommands.length > 0 && !historyMode}
    <CommandBar commands={customCommands} cwd={session.cwd} />
  {/if}

  {#if metadataEntries.length > 0}
    <MetadataDisplay entries={metadataEntries} accentColor="var(--accent-color)" />
  {/if}

  <!-- Expanded section: toggle on click -->
  {#if !compact && expanded}
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
              <span class="history-tool-name">{displayToolName(tool.tool_name)}</span>
              {#if tool.summary}
                <span class="history-summary">{tool.summary}</span>
              {/if}
              {#if tool.urls.length > 0 && onPreviewUrl}
                <button
                  class="preview-btn"
                  onclick={(e) => handleUrlClick(e, tool.urls[0])}
                  title={tool.urls[0]}
                >&#x2197;</button>
              {/if}
              {#if tool.file_path && isPreviewableFile(tool.file_path) && onPreviewFile}
                <button
                  class="preview-btn"
                  onclick={(e) => handleFileClick(e, tool.file_path!)}
                  title={tool.file_path!}
                >&#x2197;</button>
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

  .open-terminal {
    background: none;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    padding: 1px 4px;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s, border-color 0.1s;
  }

  .card:hover .open-terminal {
    opacity: 1;
  }

  .open-terminal:hover {
    color: var(--text-primary);
    border-color: var(--border);
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

  .source-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
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

  .preview-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0 4px;
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .preview-btn:hover {
    color: var(--active);
    border-color: var(--active);
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

  .card-progress {
    height: 2px;
    background: var(--border);
    width: 100%;
  }

  .card-progress-fill {
    height: 100%;
    border-radius: 1px;
    transition: width 0.5s ease;
  }

  .tool-velocity {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .card.completion-flash {
    animation: flash-complete 2s ease-out;
  }

  @keyframes flash-complete {
    0% { border-left-color: var(--success); }
    100% { border-left-color: var(--accent-color); }
  }

  .card.alert-high {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #e74c3c;
  }

  .card.alert-medium {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #f39c12;
  }

  .card.alert-low {
    animation: pulse-alert 1.5s ease-out;
    --alert-color: #3498db;
  }

  @keyframes pulse-alert {
    0% {
      border-left-color: var(--alert-color);
      box-shadow: 0 0 16px color-mix(in srgb, var(--alert-color) 30%, transparent);
    }
    50% {
      border-left-color: var(--alert-color);
      box-shadow: 0 0 8px color-mix(in srgb, var(--alert-color) 15%, transparent);
    }
    100% {
      border-left-color: var(--accent-color);
      box-shadow: none;
    }
  }

</style>
