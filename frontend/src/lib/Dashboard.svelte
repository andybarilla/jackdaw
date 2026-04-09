<script lang="ts">
  import { GetDashboardData } from "../../wailsjs/go/main/App";
  import type { DashboardSession } from "./types";

  interface Props {
    onSelectSession: (id: string) => void;
  }

  let { onSelectSession }: Props = $props();

  let dashboardSessions = $state<DashboardSession[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    let active = true;
    async function poll() {
      try {
        dashboardSessions = ((await GetDashboardData()) || []) as DashboardSession[];
        error = null;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (active) setTimeout(poll, 2000);
    }
    poll();
    return () => { active = false; };
  });

  function formatElapsed(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const mins = Math.floor((now - start) / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) return `${hours}h ${remMins}m`;
    return `${Math.floor(hours / 24)}d`;
  }

  function statusColor(status: DashboardSession["status"]): string {
    switch (status) {
      case "idle":
        return "var(--text-muted)";
      case "working":
        return "var(--accent)";
      case "waiting_for_approval":
        return "var(--warning)";
      case "error":
        return "var(--error)";
      case "stopped":
      case "exited":
        return "var(--text-muted)";
    }
  }

  function basename(path: string): string {
    const parts = path.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || path;
  }
</script>

<div class="dashboard">
  {#if error}
    <div class="error-state">{error}</div>
  {/if}

  {#if dashboardSessions.length === 0 && !error}
    <div class="empty-state">No sessions</div>
  {:else}
    <div class="dashboard-grid">
      {#each dashboardSessions as session (session.id)}
        <button class="session-card" onclick={() => onSelectSession(session.id)}>
          <div class="card-header">
            <span class="status-dot" style="background: {statusColor(session.status)}"></span>
            <span class="session-name">{session.name}</span>
            <span class="elapsed">{formatElapsed(session.started_at)}</span>
          </div>
          <div class="card-meta">
            <span class="work-dir" title={session.work_dir}>{basename(session.work_dir)}</span>
            {#if session.worktree_enabled}
              <span class="branch-badge" title={session.branch_name}>&#9741; {session.branch_name}</span>
            {/if}
          </div>
          <div class="last-line">
            {#if session.last_line}
              {session.last_line}
            {:else}
              <span class="no-activity">No activity yet</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dashboard {
    height: 100%;
    overflow-y: auto;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
    padding: 16px;
  }

  .session-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 13px;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .session-card:hover {
    border-color: var(--accent);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .session-name {
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .elapsed {
    color: var(--text-muted);
    font-size: 12px;
    flex-shrink: 0;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .work-dir {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-badge {
    color: var(--accent);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .last-line {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-activity {
    font-style: italic;
    color: var(--text-muted);
    font-family: inherit;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 14px;
  }

  .error-state {
    padding: 16px;
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
  }
</style>
