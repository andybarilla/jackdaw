<script lang="ts">
  interface Props {
    onSubmit: (workDir: string) => void;
    onCancel: () => void;
  }

  let { onSubmit, onCancel }: Props = $props();
  let workDir = $state("");

  function handleSubmit(e: Event) {
    e.preventDefault();
    const trimmed = workDir.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }

</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onCancel} onkeydown={(e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }} role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <form
    class="dialog"
    onsubmit={handleSubmit}
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <h3>New Claude Code Session</h3>
    <label>
      Working Directory
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={workDir}
        placeholder="/path/to/project"
        autofocus
      />
    </label>
    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel}>Cancel</button>
      <button type="submit" class="submit" disabled={!workDir.trim()}>
        Launch
      </button>
    </div>
  </form>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    width: 400px;
  }

  h3 {
    margin-bottom: 16px;
    font-size: 16px;
  }

  label {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  input {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 14px;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    padding: 8px 16px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }

  .cancel {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .submit {
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 600;
  }

  .submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
