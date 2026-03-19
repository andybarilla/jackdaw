<script lang="ts">
  interface Props {
    sessionCount: number;
    runningCount: number;
  }

  let { sessionCount, runningCount }: Props = $props();
</script>

<header class="header">
  <div class="header-left">
    <span class="app-name">Jackdaw</span>
  </div>
  <div class="header-right">
    {#if sessionCount > 0}
      <span class="status-dot" class:active={runningCount > 0}></span>
      <span class="status-text">{sessionCount} active session{sessionCount !== 1 ? 's' : ''}</span>
    {:else}
      <span class="status-text">No active sessions</span>
    {/if}
  </div>
</header>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .app-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--yellow);
  }

  .status-dot.active {
    background: var(--green);
  }

  .status-text {
    font-size: 13px;
    color: var(--text-secondary);
  }
</style>
