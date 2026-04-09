<script lang="ts">
  type PaneChoice = "terminal" | "session";

  interface Props {
    onSelect: (choice: PaneChoice) => void;
  }

  let { onSelect }: Props = $props();
</script>

<div class="quick-picker">
  <div class="picker-label">Open in this pane</div>
  <div class="picker-options">
    <button class="picker-btn terminal" onclick={() => onSelect("terminal")}>
      Terminal
    </button>
    <button class="picker-btn session" onclick={() => onSelect("session")}>
      Claude
    </button>
  </div>
</div>

<style>
  .quick-picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
  }

  .picker-label {
    color: var(--text-muted);
    font-size: 13px;
  }

  .picker-options {
    display: flex;
    gap: 8px;
  }

  .picker-btn {
    padding: 8px 20px;
    border-radius: 6px;
    border: 1px solid;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
  }

  .picker-btn.terminal {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .picker-btn.terminal:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .picker-btn.session {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 40%, transparent);
  }

  .picker-btn.session:hover {
    background: color-mix(in srgb, var(--success) 10%, transparent);
  }
</style>
