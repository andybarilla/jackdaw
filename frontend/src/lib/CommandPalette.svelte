<script lang="ts">
  import type { ShellCommand } from "./types";
  import type { Keymap } from "./keybindings";

  interface PaletteAction {
    id: string;
    label: string;
  }

  interface Props {
    actions: PaletteAction[];
    keymap: Keymap;
    shellCommands: ShellCommand[];
    activeSessionWorkDir?: string;
    onExecuteShellCommand: (command: string) => void;
    onExecuteAction: (actionId: string) => void;
    onClose: () => void;
  }

  const ACTION_LABELS: Record<string, string> = {
    "session.new": "New Session",
    "session.kill": "Kill Session",
    "session.next": "Next Session",
    "session.prev": "Previous Session",
    "session.viewDiff": "View Diff",
    "app.toggleSidebar": "Toggle Sidebar",
    "terminal.search": "Find in Terminal",
    "pane.splitVertical": "Split Pane Vertical",
    "pane.splitHorizontal": "Split Pane Horizontal",
    "pane.close": "Close Pane",
    "pane.focusUp": "Focus Pane Up",
    "pane.focusDown": "Focus Pane Down",
    "pane.focusLeft": "Focus Pane Left",
    "pane.focusRight": "Focus Pane Right",
    "pane.unsplit": "Unsplit Pane",
    "tab.next": "Next Tab",
    "tab.prev": "Previous Tab",
    "app.openSettings": "Open Settings",
    "commandPalette.open": "Command Palette",
  };

  let { actions, keymap, shellCommands, activeSessionWorkDir, onExecuteShellCommand, onExecuteAction, onClose }: Props = $props();
  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;
  let listEl: HTMLDivElement;

  interface Item {
    type: "action" | "shell";
    id: string;
    label: string;
    hint?: string;
    scope?: string;
  }

  const filteredItems = $derived.by(() => {
    const q = query.toLowerCase();
    const items: Item[] = [];

    for (const a of actions) {
      if (a.id === "commandPalette.open") continue;
      const label = ACTION_LABELS[a.id] || a.id;
      if (q && !label.toLowerCase().includes(q)) continue;
      items.push({ type: "action", id: a.id, label, hint: keymap[a.id] });
    }

    for (const sc of shellCommands) {
      const label = sc.name || sc.command;
      if (q && !label.toLowerCase().includes(q) && !sc.command.toLowerCase().includes(q)) continue;
      const inScope = !sc.work_dir || (activeSessionWorkDir && activeSessionWorkDir.startsWith(sc.work_dir));
      items.push({
        type: "shell",
        id: sc.command,
        label,
        scope: inScope ? undefined : sc.work_dir,
      });
    }

    return items;
  });

  $effect(() => {
    void filteredItems;
    selectedIndex = 0;
  });

  function scrollToSelected(): void {
    requestAnimationFrame(() => {
      const el = listEl?.querySelector(".selected");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1);
      scrollToSelected();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filteredItems[selectedIndex];
      if (!item) return;
      if (item.type === "action") {
        onExecuteAction(item.id);
      } else {
        onExecuteShellCommand(item.id);
      }
      onClose();
    }
  }

  function handleSelect(item: Item): void {
    if (item.type === "action") {
      onExecuteAction(item.id);
    } else {
      onExecuteShellCommand(item.id);
    }
    onClose();
  }

  $effect(() => {
    inputEl?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={handleKeydown}>
  <div class="palette">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Type a command..."
      spellcheck="false"
      autocomplete="off"
    />
    <div class="list" bind:this={listEl}>
      {#each filteredItems as item, i}
        <button
          class="item"
          class:selected={i === selectedIndex}
          onmousedown={() => handleSelect(item)}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="item-label">{item.label}</span>
          {#if item.hint}
            <span class="item-hint">{item.hint}</span>
          {/if}
          {#if item.scope}
            <span class="item-scope">{item.scope}</span>
          {/if}
          {#if item.type === "shell" && !item.scope}
            <span class="item-badge">shell</span>
          {/if}
        </button>
      {/each}
      {#if filteredItems.length === 0}
        <div class="empty">No matching commands</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    z-index: 200;
  }

  .palette {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 500px;
    max-height: 50vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  input {
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 1.077rem;
    font-family: inherit;
    outline: none;
  }

  .list {
    overflow-y: auto;
    padding: 4px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 0.923rem;
    cursor: pointer;
    text-align: left;
  }

  .item.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-hint {
    color: var(--text-secondary);
    font-size: 0.846rem;
    white-space: nowrap;
  }

  .item-scope {
    color: var(--text-secondary);
    font-size: 0.769rem;
    opacity: 0.6;
    white-space: nowrap;
  }

  .item-badge {
    color: var(--text-secondary);
    font-size: 0.769rem;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .empty {
    padding: 16px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
