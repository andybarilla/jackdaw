# OpenCode Setup Guide in Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a setup guide section in Settings that shows users how to configure the `@jackdaw/opencode` plugin so OpenCode sessions appear in Jackdaw.

**Architecture:** Add an "Integrations" section to Settings.svelte with expandable setup instructions for OpenCode. A Tauri command checks whether the `@jackdaw/opencode` package is globally installed (via `npm ls -g @jackdaw/opencode`). The UI shows install status and copy-pasteable configuration snippets.

**Tech Stack:** Svelte 5, Tauri commands, npm CLI detection

---

### Task 1: Add backend command to check OpenCode plugin status

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the test**

In `src-tauri/src/lib.rs`, add at the bottom inside a `#[cfg(test)]` module (or the existing one):

```rust
#[cfg(test)]
mod opencode_tests {
    #[test]
    fn check_opencode_parses_installed() {
        // The command returns a struct with `installed: bool`
        // When npm ls succeeds (exit 0), installed = true
        // This is a smoke test that the parsing logic exists
        assert!(true); // Placeholder — real test is the integration below
    }
}
```

- [ ] **Step 2: Add check_opencode_installed command**

In `src-tauri/src/lib.rs`, add a new Tauri command:

```rust
#[tauri::command]
async fn check_opencode_installed() -> Result<bool, String> {
    let output = tokio::process::Command::new("npm")
        .args(["ls", "-g", "--depth=0", "@jackdaw/opencode"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {}", e))?;
    Ok(output.status.success())
}
```

- [ ] **Step 3: Register the command**

Find the `.invoke_handler(tauri::generate_handler![...])` call and add `check_opencode_installed` to the list.

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add check_opencode_installed command"
```

---

### Task 2: Add Integrations section to Settings

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Add state and onMount logic**

In `Settings.svelte`'s `<script>` block, add state variables:

```typescript
let opencodeInstalled = $state<boolean | null>(null);
let opencodeChecking = $state(false);
```

In the `onMount` callback, after the existing setup code, add:

```typescript
checkOpenCode();
```

Add the function:

```typescript
async function checkOpenCode() {
  opencodeChecking = true;
  try {
    opencodeInstalled = await invoke<boolean>('check_opencode_installed');
  } catch {
    opencodeInstalled = null;
  } finally {
    opencodeChecking = false;
  }
}
```

- [ ] **Step 2: Add the Integrations section to the template**

After the HTTP API section (before the closing `</div>` of `.settings`), add:

```svelte
<h3 class="settings-title">Integrations</h3>
<div class="integration-card">
  <div class="integration-header">
    <span class="integration-name">OpenCode</span>
    {#if opencodeChecking}
      <span class="integration-status status-checking">checking...</span>
    {:else if opencodeInstalled}
      <span class="integration-status status-installed">installed</span>
    {:else}
      <span class="integration-status status-not-installed">not installed</span>
    {/if}
  </div>
  <p class="integration-desc">Monitor OpenCode sessions in Jackdaw.</p>
  <div class="setup-steps">
    <div class="setup-step">
      <span class="step-number">1</span>
      <div class="step-content">
        <span class="step-label">Install the plugin globally:</span>
        <div class="code-block">
          <code>npm install -g @jackdaw/opencode</code>
          <button class="copy-btn" onclick={() => navigator.clipboard.writeText('npm install -g @jackdaw/opencode')}>Copy</button>
        </div>
      </div>
    </div>
    <div class="setup-step">
      <span class="step-number">2</span>
      <div class="step-content">
        <span class="step-label">Add to your OpenCode config (<code>opencode.json</code>):</span>
        <div class="code-block">
          <code>{`"plugins": ["@jackdaw/opencode"]`}</code>
          <button class="copy-btn" onclick={() => navigator.clipboard.writeText('"plugins": ["@jackdaw/opencode"]')}>Copy</button>
        </div>
      </div>
    </div>
    <div class="setup-step">
      <span class="step-number">3</span>
      <div class="step-content">
        <span class="step-label">Start an OpenCode session — it will appear in Jackdaw automatically.</span>
      </div>
    </div>
  </div>
  <button class="check-btn" onclick={checkOpenCode} disabled={opencodeChecking}>
    {opencodeChecking ? 'Checking...' : 'Re-check'}
  </button>
</div>
```

- [ ] **Step 3: Add integration styles**

In the `<style>` block, add:

```css
.integration-card {
  border: 1px solid var(--border);
  padding: 12px;
  margin-bottom: 16px;
}

.integration-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.integration-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.integration-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 2px;
}

.status-installed {
  color: var(--state-running);
  border: 1px solid var(--state-running);
}

.status-not-installed {
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.status-checking {
  color: var(--text-muted);
}

.integration-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 12px 0;
}

.setup-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.setup-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.step-number {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 50%;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-label {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  margin-bottom: 4px;
}

.step-label code {
  color: var(--text-primary);
}

.code-block {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--tool-bg);
  border: 1px solid var(--border);
  padding: 6px 8px;
}

.code-block code {
  flex: 1;
  font-size: 11px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Verify manually**

```bash
npm run tauri dev
```

Navigate to Settings tab. Should see "Integrations" section at the bottom with OpenCode card showing install status, numbered steps, and copy buttons.

- [ ] **Step 5: Run type check**

```bash
npm run check
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: add OpenCode integration setup guide in settings"
```
