<script lang="ts">
  import type { Session } from '$lib/types';
  import { getProjectName, getSessionState, type SessionState } from '$lib/utils';
  import SessionCard from './SessionCard.svelte';

  interface Props {
    cwd: string;
    sessions: Session[];
    selectedSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onDismiss: (sessionId: string) => void;
    onOpenShell?: (sessionId: string) => void;
  }

  let { cwd, sessions, selectedSessionId, onSelect, onDismiss, onOpenShell }: Props = $props();

  let collapsed = $state(false);

  let sessionStates = $derived<SessionState[]>(sessions.map(s => getSessionState(s)));

  // Highest-priority attention state for collapsed header label
  let attentionLabel = $derived<string | null>(
    sessionStates.includes('approval') ? 'APPROVAL'
    : sessionStates.includes('input') ? 'INPUT'
    : null
  );

  function toggleCollapse() {
    collapsed = !collapsed;
  }
</script>

<div class="project-group">
  <div class="group-header" onclick={toggleCollapse} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleCollapse())}>
    <div class="header-left">
      <span class="chevron">{collapsed ? '▶' : '▼'}</span>
      <span class="project-name">{getProjectName(cwd)}</span>
      <span class="session-count">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
      {#if collapsed && attentionLabel}
        <span class="attention-label" class:approval={attentionLabel === 'APPROVAL'} class:input={attentionLabel === 'INPUT'}>{attentionLabel}</span>
      {/if}
    </div>
    <div class="header-right">
      {#each sessionStates as state}
        <span class="status-dot" style="background: var(--state-{state})"></span>
      {/each}
    </div>
  </div>

  {#if !collapsed}
    <div class="group-body">
      {#each sessions as session (session.session_id)}
        <div
          class="sidebar-session"
          class:selected={selectedSessionId === session.session_id}
          onclick={() => onSelect(session.session_id)}
          role="button"
          tabindex="0"
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(session.session_id)}
        >
          <SessionCard {session} onDismiss={onDismiss} {onOpenShell} compact />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .project-group {
    background: var(--card-bg);
    border: 1px solid var(--border);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    cursor: pointer;
    user-select: none;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .chevron {
    font-size: 10px;
    color: var(--text-muted);
  }

  .project-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .session-count {
    font-size: 11px;
    color: var(--text-muted);
  }

  .attention-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .attention-label.approval {
    color: var(--state-approval);
  }

  .attention-label.input {
    color: var(--state-input);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .group-body {
    border-top: 1px solid var(--border);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-session {
    cursor: pointer;
    transition: background 0.1s;
  }

  .sidebar-session:hover {
    background: var(--tool-bg);
  }

  .sidebar-session.selected {
    background: var(--tool-bg);
    outline: 1px solid var(--border);
  }
</style>
