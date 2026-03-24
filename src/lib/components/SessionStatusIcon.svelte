<script lang="ts">
  import type { Session } from '$lib/types';
  import { ShieldAlert, Pause, Play, Circle } from 'lucide-svelte';

  interface Props {
    session: Session;
    size?: number;
    historyMode?: boolean;
  }

  let { session, size = 14, historyMode = false }: Props = $props();

  type SessionState = 'approval' | 'input' | 'running' | 'ended';

  let sessionState = $derived<SessionState>(
    historyMode
      ? 'ended'
      : session.pending_approval
        ? 'approval'
        : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
          ? 'running'
          : 'input'
  );

  const stateConfig: Record<SessionState, { icon: typeof Play; colorClass: string; pulse: boolean }> = {
    approval: { icon: ShieldAlert, colorClass: 'status-orange', pulse: true },
    input: { icon: Pause, colorClass: 'status-gray', pulse: false },
    running: { icon: Play, colorClass: 'status-green', pulse: true },
    ended: { icon: Circle, colorClass: 'status-gray', pulse: false },
  };

  let config = $derived(stateConfig[sessionState]);
</script>

<span class="status-icon {config.colorClass}" class:pulse={config.pulse}>
  {#if config}
    {@const Icon = config.icon}
    <Icon {size} strokeWidth={2} />
  {/if}
</span>

<style>
  .status-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .status-green { color: var(--active); }
  .status-blue { color: var(--attention); }
  .status-orange { color: var(--attention); }
  .status-gray { color: var(--text-muted); }

  .pulse {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
