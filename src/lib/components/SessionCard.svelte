<script lang="ts">
  import type { Session } from '$lib/types';

  interface Props {
    session: Session;
    onDismiss: (sessionId: string) => void;
  }

  let { session, onDismiss }: Props = $props();

  let isPending = $derived(session.pending_approval);
  let isRunning = $derived(!isPending && (session.current_tool !== null || session.active_subagents > 0));
  let uptime = $derived(getUptime(session.started_at));
  let recentHistory = $derived(session.tool_history.slice(-5).reverse());

  function getUptime(startedAt: string): string {
    const start = new Date(startedAt);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m ago`;
  }

  function shortenPath(path: string): string {
    const home = path.replace(/^\/home\/[^/]+/, '~');
    return home;
  }

  function shortenSessionId(id: string): string {
    return id.length > 8 ? id.substring(0, 8) : id;
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="card-info">
      <div class="card-title">
        <span class="status-dot" class:running={isRunning} class:pending={isPending}></span>
        <span class="project-dir">{shortenPath(session.cwd)}</span>
      </div>
      <span class="meta">Session {shortenSessionId(session.session_id)} · started {uptime}</span>
    </div>
    <div class="card-actions">
      <span class="badge" class:running={isRunning} class:pending={isPending}>
        {#if isPending}
          🔒 Approval
        {:else if isRunning}
          ⚡ Running
        {:else}
          ⏸ Waiting
        {/if}
      </span>
      <button class="dismiss" onclick={() => onDismiss(session.session_id)} title="Dismiss session">×</button>
    </div>
  </div>

  {#if session.current_tool}
    <div class="current-tool">
      <span class="tool-name">▶ {session.current_tool.tool_name}</span>
      {#if session.current_tool.summary}
        <span class="tool-summary">{session.current_tool.summary}</span>
      {/if}
    </div>
  {/if}

  {#if session.active_subagents > 0}
    <div class="subagents">
      {session.active_subagents} subagent{session.active_subagents === 1 ? '' : 's'} running
    </div>
  {/if}

  {#if recentHistory.length > 0}
    <div class="history">
      {#each recentHistory as tool}
        <div class="history-item">
          <span class="done-mark">✓</span>
          <span class="tool-name-small">{tool.tool_name}</span>
          {#if tool.summary}
            <span class="tool-summary-small">{tool.summary}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--yellow);
  }

  .status-dot.pending {
    background: var(--blue);
    animation: pulse 2s infinite;
  }

  .status-dot.running {
    background: var(--green);
    animation: pulse 2s infinite;
  }

  .project-dir {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .meta {
    font-size: 12px;
    color: var(--text-muted);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge {
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 4px;
    background: var(--badge-waiting-bg);
    border: 1px solid var(--badge-waiting-border);
    color: var(--yellow);
  }

  .badge.pending {
    background: #1c2438;
    border-color: #1f3a5f;
    color: var(--blue);
  }

  .badge.running {
    background: var(--badge-running-bg);
    border-color: var(--badge-running-border);
    color: var(--green);
  }

  .dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .dismiss:hover {
    background: var(--border);
    color: var(--text-primary);
  }

  .subagents {
    font-size: 11px;
    color: var(--blue);
    padding: 4px 0;
    margin-bottom: 6px;
  }

  .current-tool {
    background: var(--tool-bg);
    border: 1px solid var(--tool-border);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--blue);
  }

  .tool-summary {
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  }

  .done-mark {
    color: var(--text-muted);
  }

  .tool-name-small {
    color: var(--text-secondary);
  }

  .tool-summary-small {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
