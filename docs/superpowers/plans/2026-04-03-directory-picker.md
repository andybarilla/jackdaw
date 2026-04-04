# Directory Picker for New Sessions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Browse..." button to the New Session modal so users can select any directory, not just recent ones.

**Architecture:** Add `tauri-plugin-dialog` for native folder picker. Frontend calls `open({ directory: true })` from the dialog plugin, then passes the selected path to the existing `spawnSession(cwd)` flow. No backend changes needed beyond adding the plugin.

**Tech Stack:** Tauri v2 dialog plugin (`@tauri-apps/plugin-dialog`, `tauri-plugin-dialog`), Svelte 5

---

### Task 1: Add tauri-plugin-dialog dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:1-15` (plugin registration)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (npm dependency)

- [ ] **Step 1: Add Rust dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the plugin in Tauri setup**

In `src-tauri/src/lib.rs`, find the `tauri::Builder` chain in `pub fn run()` and add `.plugin(tauri_plugin_dialog::init())` alongside the other plugin registrations.

- [ ] **Step 3: Add dialog permission to capabilities**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
"dialog:default"
```

- [ ] **Step 4: Install npm package**

```bash
npm install @tauri-apps/plugin-dialog
```

- [ ] **Step 5: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: add tauri-plugin-dialog for directory picker"
```

---

### Task 2: Add "Browse..." button to New Session modal

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Import the dialog open function**

At the top of Dashboard.svelte's `<script>` block, add:

```typescript
import { open } from '@tauri-apps/plugin-dialog';
```

- [ ] **Step 2: Add browseDirectory function**

After the `closeNewSessionMenu()` function (~line 244), add:

```typescript
async function browseDirectory() {
  const selected = await open({ directory: true, multiple: false, title: 'Select project directory' });
  if (selected) {
    spawnSession(selected as string);
  }
}
```

- [ ] **Step 3: Add Browse button to the modal body**

In the New Session modal body (around line 596-608), add a "Browse..." button above the recent directories list. Replace the modal-body content:

```svelte
<div class="modal-body">
  <button class="browse-btn" onclick={browseDirectory}>
    Browse...
  </button>
  {#if recentCwds.length > 0}
    <div class="recent-label">Recent directories</div>
    {#each recentCwds as cwd}
      <button class="cwd-option" onclick={() => spawnSession(cwd)}>
        <span class="cwd-project">{getProjectName(cwd)}</span>
        <span class="cwd-path">{shortenPath(cwd)}</span>
      </button>
    {/each}
  {:else}
    <div class="empty-text">No recent sessions</div>
  {/if}
</div>
```

- [ ] **Step 4: Add browse-btn styles**

In the `<style>` block, add:

```css
.browse-btn {
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: 1px dashed var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  text-align: center;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  margin-bottom: 8px;
}

.browse-btn:hover {
  background: var(--tool-bg);
  color: var(--text-primary);
  border-color: var(--text-muted);
}
```

- [ ] **Step 5: Verify manually**

```bash
npm run tauri dev
```

Click "+" button → modal should show "Browse..." at top, then recent directories below. Clicking "Browse..." should open a native folder picker. Selecting a folder should spawn a new session.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: add directory browse button to new session modal"
```
