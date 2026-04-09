<script lang="ts">
  interface Props {
    status: "exited" | "stopped";
    exitCode?: number;
    onRemove: () => void;
    onRestart: () => void;
  }

  let { status, exitCode, onRemove, onRestart }: Props = $props();

  let label = $derived(
    status === "stopped"
      ? "Session stopped"
      : `Session exited (code ${exitCode ?? 0})`,
  );
</script>

<div class="dead-session-banner">
  <span class="label">{label}</span>
  <div class="actions">
    <button class="btn restart" onclick={onRestart}>Restart</button>
    <button class="btn remove" onclick={onRemove}>Remove</button>
  </div>
</div>

<style>
  .dead-session-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg-secondary, #1e1e2e);
    border-top: 1px solid var(--border, #313244);
    z-index: 10;
  }

  .label {
    color: var(--text-muted, #a6adc8);
    font-size: 1rem;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 4px 12px;
    border: 1px solid var(--border, #313244);
    border-radius: 4px;
    font-size: 0.923rem;
    cursor: pointer;
    background: var(--bg-tertiary, #313244);
    color: var(--text, #cdd6f4);
  }

  .btn:hover {
    background: var(--bg-hover, #45475a);
  }

  .btn.restart {
    border-color: var(--accent, #007acc);
    color: var(--accent, #007acc);
  }

  .btn.restart:hover {
    background: var(--accent, #007acc);
    color: var(--bg, #1e1e2e);
  }
</style>
