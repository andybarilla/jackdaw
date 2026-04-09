<script lang="ts">
  import { THEMES } from "./themes";
  import { DEFAULT_KEYMAP, type Action } from "./keybindings";
  import {
    getTheme,
    getKeymap,
    getToastDuration,
    getNotificationsEnabled,
    getDesktopNotifications,
    getErrorDetectionEnabled,
    getWorktreeRoot,
    getMergeMode,
    getHistoryMaxBytes,
    getAutoRemoveKilledSessions,
    setTheme,
    setKeybinding,
    setToastDuration,
    setNotificationsEnabled,
    setDesktopNotifications,
    setErrorDetectionEnabled,
    setWorktreeRoot,
    setMergeMode,
    setHistoryMaxBytes,
    setAutoRemoveKilledSessions,
  } from "./config.svelte";

  let capturingAction = $state<string | null>(null);

  const ACTION_LABELS: Record<Action, string> = {
    "session.new": "New Session",
    "session.kill": "Kill Session",
    "session.next": "Next Session",
    "session.prev": "Previous Session",
    "session.viewDiff": "View Diff",
    "app.toggleSidebar": "Toggle Sidebar",
    "app.openSettings": "Open Settings",
    "terminal.search": "Terminal Search",
    "pane.splitVertical": "Split Vertical",
    "pane.splitHorizontal": "Split Horizontal",
    "pane.close": "Close Pane",
    "pane.focusUp": "Focus Up",
    "pane.focusDown": "Focus Down",
    "pane.focusLeft": "Focus Left",
    "pane.focusRight": "Focus Right",
    "pane.unsplit": "Unsplit Pane",
    "tab.next": "Next Tab",
    "tab.prev": "Previous Tab",
  };

  function handleCaptureKeydown(e: KeyboardEvent): void {
    if (!capturingAction) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      capturingAction = null;
      return;
    }

    // Ignore bare modifier keys
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    const key = e.key.length === 1 ? e.key : e.key;
    parts.push(key);

    const binding = parts.join("+");
    setKeybinding(capturingAction, binding);
    capturingAction = null;
  }

  function startCapture(action: string): void {
    capturingAction = action;
  }

  function historyMB(): number {
    return Math.round(getHistoryMaxBytes() / 1048576);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="settings-editor" onkeydown={handleCaptureKeydown}>
  <div class="settings-scroll">
    <h1>Settings</h1>

    <!-- Theme -->
    <section>
      <h2>Theme</h2>
      <div class="button-group">
        {#each THEMES as t}
          <button
            class="theme-btn"
            class:active={getTheme().name === t.name}
            onclick={() => setTheme(t.name)}
          >{t.label}</button>
        {/each}
      </div>
    </section>

    <!-- Notifications -->
    <section>
      <h2>Notifications</h2>
      <label class="toggle-row">
        <span>Notifications enabled</span>
        <input type="checkbox" checked={getNotificationsEnabled()} onchange={(e) => setNotificationsEnabled(e.currentTarget.checked)} />
      </label>
      <label class="toggle-row">
        <span>Desktop notifications</span>
        <input type="checkbox" checked={getDesktopNotifications()} onchange={(e) => setDesktopNotifications(e.currentTarget.checked)} />
      </label>
      <label class="toggle-row">
        <span>Error detection</span>
        <input type="checkbox" checked={getErrorDetectionEnabled()} onchange={(e) => setErrorDetectionEnabled(e.currentTarget.checked)} />
      </label>
      <label class="toggle-row">
        <span>Toast duration (seconds)</span>
        <input
          type="number"
          min="1"
          max="60"
          value={getToastDuration()}
          onchange={(e) => setToastDuration(Number(e.currentTarget.value) || 5)}
        />
      </label>
    </section>

    <!-- Sessions -->
    <section>
      <h2>Sessions</h2>
      <label class="toggle-row">
        <span>Auto-remove killed sessions</span>
        <input type="checkbox" checked={getAutoRemoveKilledSessions()} onchange={(e) => setAutoRemoveKilledSessions(e.currentTarget.checked)} />
      </label>
    </section>

    <!-- Worktree -->
    <section>
      <h2>Worktree</h2>
      <label class="field-row">
        <span>Worktree root path</span>
        <input
          type="text"
          value={getWorktreeRoot()}
          placeholder="~/worktrees"
          onchange={(e) => setWorktreeRoot(e.currentTarget.value)}
        />
      </label>
      <fieldset class="radio-group">
        <legend>Merge mode</legend>
        <label>
          <input type="radio" name="mergeMode" value="squash" checked={getMergeMode() === "squash"} onchange={() => setMergeMode("squash")} />
          Squash
        </label>
        <label>
          <input type="radio" name="mergeMode" value="merge" checked={getMergeMode() === "merge"} onchange={() => setMergeMode("merge")} />
          Merge
        </label>
      </fieldset>
    </section>

    <!-- History -->
    <section>
      <h2>History</h2>
      <label class="field-row">
        <span>Max history size (MB)</span>
        <input
          type="number"
          min="1"
          max="100"
          value={historyMB()}
          onchange={(e) => setHistoryMaxBytes((Number(e.currentTarget.value) || 1) * 1048576)}
        />
      </label>
    </section>

    <!-- Keybindings -->
    <section>
      <h2>Keybindings</h2>
      <table class="keybindings-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Binding</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each Object.keys(DEFAULT_KEYMAP) as action (action)}
            <tr>
              <td>{ACTION_LABELS[action as Action] ?? action}</td>
              <td class="binding-cell">
                {#if capturingAction === action}
                  <span class="capturing">Press keys...</span>
                {:else}
                  <code>{getKeymap()[action] ?? ""}</code>
                {/if}
              </td>
              <td>
                <button class="edit-btn" onclick={() => startCapture(action)}>
                  {capturingAction === action ? "Cancel" : "Edit"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
</div>

<style>
  .settings-editor {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .settings-scroll {
    height: 100%;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 640px;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 24px;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }

  section {
    margin-bottom: 28px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border);
  }

  section:last-child {
    border-bottom: none;
  }

  .button-group {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 13px;
  }

  .theme-btn:hover {
    background: var(--bg-tertiary);
  }

  .theme-btn.active {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
    cursor: pointer;
  }

  .toggle-row input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }

  .toggle-row input[type="number"],
  .field-row input[type="number"] {
    width: 72px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }

  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
  }

  .field-row input[type="text"] {
    width: 240px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }

  .radio-group {
    border: none;
    padding: 0;
    margin: 8px 0 0;
    display: flex;
    gap: 16px;
    font-size: 13px;
  }

  .radio-group legend {
    display: none;
  }

  .radio-group label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .radio-group input[type="radio"] {
    accent-color: var(--accent);
  }

  .keybindings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .keybindings-table th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .keybindings-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .binding-cell code {
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }

  .capturing {
    color: var(--accent);
    font-style: italic;
  }

  .edit-btn {
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
  }

  .edit-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
