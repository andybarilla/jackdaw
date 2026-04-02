<script lang="ts">
  import {
    getBindings,
    getDefaultBindings,
    setBindings,
    formatBinding,
    type ShortcutBinding,
    type ShortcutAction,
  } from '$lib/shortcuts';

  let { onSave }: { onSave: (bindings: ShortcutBinding[]) => void } = $props();

  let bindings = $state<ShortcutBinding[]>(getBindings());
  let recordingAction = $state<ShortcutAction | null>(null);

  const ACTION_LABELS: Record<ShortcutAction, string> = {
    'next-session': 'Next Session',
    'prev-session': 'Previous Session',
    'new-session': 'New Session',
    'dismiss-session': 'Dismiss Session',
    'tab-active': 'Active Tab',
    'tab-history': 'History Tab',
    'tab-settings': 'Settings Tab',
    'close-modal': 'Close Modal',
  };

  function startRecording(action: ShortcutAction): void {
    recordingAction = action;
  }

  function cancelRecording(): void {
    recordingAction = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!recordingAction) return;
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;

    event.preventDefault();
    event.stopPropagation();

    const newBinding: ShortcutBinding = {
      action: recordingAction,
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    };

    // Remove conflict: unbind any other action using this combo
    const updated = bindings.map((b) => {
      if (b.action === recordingAction) {
        return newBinding;
      }
      if (
        b.key === newBinding.key &&
        b.ctrl === newBinding.ctrl &&
        b.shift === newBinding.shift &&
        b.alt === newBinding.alt &&
        b.meta === newBinding.meta
      ) {
        return { ...b, key: '', ctrl: false, shift: false, alt: false, meta: false };
      }
      return b;
    });

    bindings = updated;
    setBindings(updated);
    onSave(updated);
    recordingAction = null;
  }

  function resetToDefaults(): void {
    const defaults = getDefaultBindings();
    bindings = defaults;
    setBindings(defaults);
    onSave(defaults);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="shortcut-settings">
  {#each bindings as binding}
    <div class="shortcut-row">
      <span class="shortcut-label">{ACTION_LABELS[binding.action]}</span>
      {#if recordingAction === binding.action}
        <span class="shortcut-recording">Press keys...</span>
        <button class="shortcut-cancel" onclick={cancelRecording}>Cancel</button>
      {:else}
        <button class="shortcut-key" onclick={() => startRecording(binding.action)}>
          {binding.key ? formatBinding(binding) : 'Unbound'}
        </button>
      {/if}
    </div>
  {/each}
  <button class="reset-btn" onclick={resetToDefaults}>Reset to Defaults</button>
</div>

<style>
  .shortcut-settings {
    padding: 0 0 8px 0;
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
  }

  .shortcut-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .shortcut-key {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
  }

  .shortcut-key:hover {
    border-color: var(--active);
  }

  .shortcut-recording {
    font-size: 12px;
    color: var(--active);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .shortcut-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    margin-left: 6px;
  }

  .reset-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    margin-top: 8px;
  }

  .reset-btn:hover {
    border-color: var(--text-muted);
  }
</style>
