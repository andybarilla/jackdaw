# Markdown File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rendered markdown preview modal for `.md` file paths in tool output, reusing the same preview button UX as the browser preview.

**Architecture:** `extract_file_path()` pulls file paths from `tool_input` for file tools. A new `file_path` field on `ToolEvent` carries this to the frontend. `isPreviewableFile()` detects `.md` files. Clicking the preview button invokes `preview_read_file` to read the file, then `MarkdownPreview.svelte` renders it with `marked`.

**Tech Stack:** Rust/Tauri v2, Svelte 5, `marked` (markdown→HTML), Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/src/state.rs` | Add `extract_file_path()`, add `file_path` field to `ToolEvent` |
| Modify | `src-tauri/src/server.rs` | Call `extract_file_path()` when constructing `ToolEvent` |
| Modify | `src-tauri/src/preview.rs` | Add `preview_read_file` command |
| Modify | `src-tauri/src/lib.rs` | Register `preview_read_file` command |
| Modify | `src/lib/types.ts` | Add `file_path` to `ToolEvent` |
| Create | `src/lib/files.ts` | `isPreviewableFile()` utility |
| Create | `src/lib/files.test.ts` | Tests for file detection |
| Create | `src/lib/components/MarkdownPreview.svelte` | Markdown preview modal |
| Modify | `src/lib/components/SessionCard.svelte` | Add `onPreviewFile` prop, show button for previewable files |
| Modify | `src/lib/components/ProjectGroup.svelte` | Thread `onPreviewFile` prop |
| Modify | `src/lib/components/Dashboard.svelte` | Mount MarkdownPreview, add `previewFilePath` state |
| Modify | `package.json` | Add `marked` dependency |

---

### Task 1: Backend — `extract_file_path()` and `ToolEvent.file_path`

**Files:**
- Modify: `src-tauri/src/state.rs:70-78` (ToolEvent struct)
- Modify: `src-tauri/src/state.rs:104-120` (near extract_summary)
- Test: `src-tauri/src/state.rs` (existing `#[cfg(test)]` module)

- [ ] **Step 1: Write failing tests for `extract_file_path()`**

Add to the existing `#[cfg(test)] mod tests` block in `src-tauri/src/state.rs`:

```rust
#[test]
fn extract_file_path_read() {
    let input = Some(json!({"file_path": "/home/user/docs/plan.md"}));
    assert_eq!(extract_file_path("Read", &input), Some("/home/user/docs/plan.md".into()));
}

#[test]
fn extract_file_path_write() {
    let input = Some(json!({"file_path": "/src/lib.rs"}));
    assert_eq!(extract_file_path("Write", &input), Some("/src/lib.rs".into()));
}

#[test]
fn extract_file_path_edit() {
    let input = Some(json!({"file_path": "/src/main.rs"}));
    assert_eq!(extract_file_path("Edit", &input), Some("/src/main.rs".into()));
}

#[test]
fn extract_file_path_canonical_names() {
    let input = Some(json!({"file_path": "/readme.md"}));
    assert_eq!(extract_file_path("file_read", &input), Some("/readme.md".into()));
    assert_eq!(extract_file_path("file_write", &input), Some("/readme.md".into()));
    assert_eq!(extract_file_path("file_edit", &input), Some("/readme.md".into()));
}

#[test]
fn extract_file_path_non_file_tool() {
    let input = Some(json!({"command": "ls"}));
    assert_eq!(extract_file_path("Bash", &input), None);
}

#[test]
fn extract_file_path_none_input() {
    assert_eq!(extract_file_path("Read", &None), None);
}

#[test]
fn extract_file_path_missing_field() {
    let input = Some(json!({"other": "value"}));
    assert_eq!(extract_file_path("Read", &input), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test extract_file_path`
Expected: compilation error — `extract_file_path` not defined

- [ ] **Step 3: Implement `extract_file_path()`**

Add to `src-tauri/src/state.rs`, after `extract_urls` and its helpers (after the `extract_urls_from_str` function):

```rust
/// Extract file_path from tool_input for file-based tools.
pub fn extract_file_path(tool_name: &str, tool_input: &Option<serde_json::Value>) -> Option<String> {
    let input = tool_input.as_ref()?;
    match tool_name {
        "file_edit" | "file_read" | "file_write" | "Edit" | "Read" | "Write" => {
            input.get("file_path")?.as_str().map(|s| s.to_string())
        }
        _ => None,
    }
}
```

- [ ] **Step 4: Add `file_path` field to `ToolEvent`**

In `src-tauri/src/state.rs`, update the `ToolEvent` struct:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ToolEvent {
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,
    pub summary: Option<String>,
    pub urls: Vec<String>,
    pub file_path: Option<String>,
    #[serde(skip_serializing)]
    pub tool_use_id: Option<String>,
}
```

Fix all `ToolEvent` construction sites to include `file_path: None`:

In `hydrate_from_history` (around line 295):
```rust
self.tool_history.push(ToolEvent {
    tool_name: event.tool_name.clone(),
    timestamp: ts,
    summary: event.summary.clone(),
    urls: Vec::new(),
    file_path: None,
    tool_use_id: None,
});
```

Also fix any test helpers that construct `ToolEvent`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test extract_file_path`
Expected: all 7 tests pass

- [ ] **Step 6: Fix remaining compilation errors**

Run: `cd src-tauri && cargo test`
Expected: full suite passes

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add extract_file_path() and file_path field to ToolEvent"
```

---

### Task 2: Backend — Wire file_path through server.rs and add preview_read_file

**Files:**
- Modify: `src-tauri/src/server.rs:252-303` (PreToolUse and PostToolUse handlers)
- Modify: `src-tauri/src/preview.rs` (add preview_read_file command)
- Modify: `src-tauri/src/lib.rs` (register command)

- [ ] **Step 1: Update imports in server.rs**

In `src-tauri/src/server.rs` line 5, add `extract_file_path` to the import:

```rust
use crate::state::{extract_summary, extract_file_path, extract_urls, AppState, HookPayload, Session, ToolEvent};
```

- [ ] **Step 2: Update PreToolUse handler**

In the `"PreToolUse"` match arm (around line 260), add file_path extraction and include it in ToolEvent:

```rust
"PreToolUse" => {
    let tool_name = match payload.tool_name {
        Some(name) => name,
        None => {
            eprintln!("Jackdaw: PreToolUse missing tool_name");
            return;
        }
    };
    let summary = extract_summary(&tool_name, &payload.tool_input);
    let urls = extract_urls(&payload.tool_input);
    let file_path = extract_file_path(&tool_name, &payload.tool_input);
    let tool_event = ToolEvent {
        tool_name,
        timestamp: Utc::now(),
        summary,
        urls,
        file_path,
        tool_use_id: payload.tool_use_id,
    };

    if let Some(session) = sessions.get_mut(&session_id) {
        session.pending_approval = false;
        session.processing = true;
        session.set_current_tool(tool_event);
    }
}
```

- [ ] **Step 3: Update PostToolUse handler**

Same pattern in the `"PostToolUse"` match arm (around line 284):

```rust
"PostToolUse" => {
    let tool_name = match payload.tool_name {
        Some(name) => name,
        None => {
            eprintln!("Jackdaw: PostToolUse missing tool_name");
            return;
        }
    };
    let summary = extract_summary(&tool_name, &payload.tool_input);
    let urls = extract_urls(&payload.tool_input);
    let file_path = extract_file_path(&tool_name, &payload.tool_input);
    let now = Utc::now();
    let tool_event = ToolEvent {
        tool_name: tool_name.clone(),
        timestamp: now,
        summary: summary.clone(),
        urls,
        file_path,
        tool_use_id: payload.tool_use_id.clone(),
    };

    db_tool_name = Some(tool_name);
    db_tool_summary = summary;
    db_tool_timestamp = Some(now.to_rfc3339());

    if let Some(session) = sessions.get_mut(&session_id) {
        session.pending_approval = false;
        session.complete_tool(payload.tool_use_id.as_deref(), tool_event);
    }
}
```

- [ ] **Step 4: Add `preview_read_file` command to preview.rs**

Add to the end of `src-tauri/src/preview.rs` (before the `#[cfg(test)]` module):

```rust
#[tauri::command]
pub fn preview_read_file(path: String) -> Result<String, String> {
    let path = std::path::Path::new(&path);
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    std::fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))
}
```

Add a test for `preview_read_file` in the existing `#[cfg(test)]` module:

```rust
#[test]
fn preview_read_file_missing() {
    let result = preview_read_file("/nonexistent/file.md".into());
    assert!(result.is_err());
}

#[test]
fn preview_read_file_reads_existing() {
    let dir = std::env::temp_dir();
    let path = dir.join("jackdaw_test_preview.md");
    std::fs::write(&path, "# Hello\nWorld").unwrap();
    let result = preview_read_file(path.to_string_lossy().into());
    assert_eq!(result.unwrap(), "# Hello\nWorld");
    std::fs::remove_file(&path).unwrap();
}
```

- [ ] **Step 5: Register command in lib.rs**

In `src-tauri/src/lib.rs`, in the `invoke_handler` macro, add:

```rust
preview::preview_read_file,
```

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/server.rs src-tauri/src/preview.rs src-tauri/src/lib.rs
git commit -m "feat: wire file_path through server.rs, add preview_read_file command"
```

---

### Task 3: Frontend — file types, detection utility, and marked dependency

**Files:**
- Modify: `src/lib/types.ts:3-8` (ToolEvent interface)
- Create: `src/lib/files.ts`
- Create: `src/lib/files.test.ts`
- Modify: `package.json` (add `marked`)

- [ ] **Step 1: Install marked**

Run: `npm install marked`

- [ ] **Step 2: Write failing tests**

Create `src/lib/files.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isPreviewableFile } from './files';

describe('isPreviewableFile', () => {
  it('returns true for .md files', () => {
    expect(isPreviewableFile('/home/user/docs/plan.md')).toBe(true);
  });

  it('returns true for .MD files (case insensitive)', () => {
    expect(isPreviewableFile('/docs/README.MD')).toBe(true);
  });

  it('returns true for .Md files (mixed case)', () => {
    expect(isPreviewableFile('/docs/notes.Md')).toBe(true);
  });

  it('returns false for non-markdown files', () => {
    expect(isPreviewableFile('/src/main.rs')).toBe(false);
    expect(isPreviewableFile('/src/app.txt')).toBe(false);
    expect(isPreviewableFile('/src/index.html')).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(isPreviewableFile('/src/Makefile')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPreviewableFile(null)).toBe(false);
    expect(isPreviewableFile(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --reporter=verbose files`
Expected: FAIL — module `./files` not found

- [ ] **Step 4: Implement file detection**

Create `src/lib/files.ts`:

```typescript
export function isPreviewableFile(path: string | null | undefined): boolean {
  if (!path) return false;
  return path.toLowerCase().endsWith('.md');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --reporter=verbose files`
Expected: all tests pass

- [ ] **Step 6: Update `ToolEvent` TypeScript interface**

In `src/lib/types.ts`, update the `ToolEvent` interface:

```typescript
export interface ToolEvent {
  tool_name: string;
  timestamp: string; // ISO 8601 from Rust chrono
  summary: string | null;
  urls: string[];
  file_path: string | null;
}
```

- [ ] **Step 7: Run type check and fix any issues**

Run: `npm run check`
Expected: may reveal ToolEvent construction sites in tests or Dashboard that need `file_path: null` added. Fix them.

- [ ] **Step 8: Commit**

```bash
git add src/lib/files.ts src/lib/files.test.ts src/lib/types.ts package.json package-lock.json
git commit -m "feat: add isPreviewableFile utility, file_path on ToolEvent, install marked"
```

---

### Task 4: Frontend — MarkdownPreview component

**Files:**
- Create: `src/lib/components/MarkdownPreview.svelte`

- [ ] **Step 1: Create MarkdownPreview component**

Create `src/lib/components/MarkdownPreview.svelte`:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { marked } from 'marked';
  import { onMount } from 'svelte';

  interface Props {
    filePath: string;
    onClose: () => void;
  }

  let { filePath, onClose }: Props = $props();

  let content = $state('');
  let error = $state<string | null>(null);
  let loading = $state(true);

  let renderedHtml = $derived(content ? marked.parse(content) : '');

  let fileName = $derived(filePath.split('/').pop() ?? filePath);

  onMount(() => {
    loadFile();
  });

  async function loadFile() {
    loading = true;
    error = null;
    try {
      content = await invoke<string>('preview_read_file', { path: filePath });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="preview-backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="preview-modal" onclick={(e) => e.stopPropagation()}>
    <div class="preview-header">
      <span class="preview-filename">{fileName}</span>
      <button class="nav-btn close-btn" onclick={onClose} title="Close">&#x2715;</button>
    </div>
    <div class="preview-body">
      {#if loading}
        <div class="preview-status">Loading...</div>
      {:else if error}
        <div class="preview-status preview-error">{error}</div>
      {:else}
        <div class="markdown-content">
          {@html renderedHtml}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .preview-modal {
    width: 80%;
    height: 80%;
    background: var(--card-bg);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
  }

  .preview-filename {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .nav-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }

  .close-btn:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .preview-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
  }

  .preview-status {
    color: var(--text-muted);
    font-size: 12px;
  }

  .preview-error {
    color: var(--error);
  }

  /* Markdown content styles */
  .markdown-content {
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.6;
  }

  .markdown-content :global(h1) {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .markdown-content :global(h2) {
    font-size: 16px;
    font-weight: 700;
    margin: 20px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .markdown-content :global(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 16px 0 6px;
  }

  .markdown-content :global(h4),
  .markdown-content :global(h5),
  .markdown-content :global(h6) {
    font-size: 13px;
    font-weight: 600;
    margin: 12px 0 4px;
  }

  .markdown-content :global(p) {
    margin: 0 0 10px;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin: 0 0 10px;
    padding-left: 24px;
  }

  .markdown-content :global(li) {
    margin: 2px 0;
  }

  .markdown-content :global(code) {
    background: var(--tool-bg);
    padding: 1px 4px;
    font-size: 12px;
  }

  .markdown-content :global(pre) {
    background: var(--tool-bg);
    border: 1px solid var(--border);
    padding: 10px 12px;
    margin: 0 0 10px;
    overflow-x: auto;
  }

  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-content :global(blockquote) {
    border-left: 3px solid var(--text-muted);
    padding-left: 12px;
    margin: 0 0 10px;
    color: var(--text-secondary);
  }

  .markdown-content :global(table) {
    border-collapse: collapse;
    margin: 0 0 10px;
    width: 100%;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }

  .markdown-content :global(th) {
    background: var(--tool-bg);
    font-weight: 600;
  }

  .markdown-content :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }

  .markdown-content :global(a) {
    color: var(--active);
    text-decoration: none;
  }

  .markdown-content :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-content :global(img) {
    max-width: 100%;
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: passes

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/MarkdownPreview.svelte
git commit -m "feat: add MarkdownPreview component"
```

---

### Task 5: Frontend — Wire file preview into SessionCard and Dashboard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`
- Modify: `src/lib/components/ProjectGroup.svelte`
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add `onPreviewFile` prop and logic to SessionCard**

In `src/lib/components/SessionCard.svelte`, add the import at the top:

```typescript
import { isPreviewableFile } from '$lib/files';
```

Add to the Props interface:

```typescript
onPreviewFile?: (path: string) => void;
```

Update destructured props:

```typescript
let { session, onDismiss, historyMode = false, endedAt, compact = false, onOpenShell, onPreviewUrl, onPreviewFile }: Props = $props();
```

Add handler:

```typescript
function handleFileClick(event: MouseEvent, path: string) {
  event.stopPropagation();
  onPreviewFile?.(path);
}
```

In the three tool display locations (active tool, dimmed lastTool, history items), after the existing URL preview button block, add the file preview button. For the active tool (after the `urls` button block around line 176):

```svelte
{#if session.current_tool!.file_path && isPreviewableFile(session.current_tool!.file_path) && onPreviewFile}
  <button
    class="preview-btn"
    onclick={(e) => handleFileClick(e, session.current_tool!.file_path!)}
    title={session.current_tool!.file_path!}
  >&#x2197;</button>
{/if}
```

For the dimmed lastTool (after its `urls` button block around line 191):

```svelte
{#if lastTool.file_path && isPreviewableFile(lastTool.file_path) && onPreviewFile}
  <button
    class="preview-btn"
    onclick={(e) => handleFileClick(e, lastTool.file_path!)}
    title={lastTool.file_path!}
  >&#x2197;</button>
{/if}
```

For history items (after their `urls` button block around line 233):

```svelte
{#if tool.file_path && isPreviewableFile(tool.file_path) && onPreviewFile}
  <button
    class="preview-btn"
    onclick={(e) => handleFileClick(e, tool.file_path!)}
    title={tool.file_path!}
  >&#x2197;</button>
{/if}
```

- [ ] **Step 2: Thread `onPreviewFile` through ProjectGroup**

In `src/lib/components/ProjectGroup.svelte`, add to the Props interface:

```typescript
onPreviewFile?: (path: string) => void;
```

Update destructured props to include `onPreviewFile`.

Pass it to SessionCard:

```svelte
<SessionCard {session} onDismiss={onDismiss} {onOpenShell} {onPreviewUrl} {onPreviewFile} compact />
```

- [ ] **Step 3: Wire into Dashboard**

In `src/lib/components/Dashboard.svelte`, add the import:

```typescript
import MarkdownPreview from './MarkdownPreview.svelte';
```

Add state (near `previewUrl`):

```typescript
let previewFilePath = $state<string | null>(null);
```

Add handlers:

```typescript
function openPreviewFile(path: string) {
  previewFilePath = path;
}

function closePreviewFile() {
  previewFilePath = null;
}
```

Update the `close-modal` case (around line 296):

```typescript
case 'close-modal':
  if (previewFilePath) closePreviewFile();
  else if (previewUrl) closePreview();
  else if (confirmCloseCount !== null) dismissConfirmClose();
  else if (showNewSessionMenu) closeNewSessionMenu();
  return;
```

Add `onPreviewFile={openPreviewFile}` to all `<SessionCard` instances and the `<ProjectGroup` instance. There are multiple render sites — search for `onPreviewUrl={openPreview}` and add `onPreviewFile={openPreviewFile}` next to each one.

Add the modal at the end of the template (after the PreviewModal block):

```svelte
{#if previewFilePath}
  <MarkdownPreview filePath={previewFilePath} onClose={closePreviewFile} />
{/if}
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: passes

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 6: Run backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/SessionCard.svelte src/lib/components/ProjectGroup.svelte src/lib/components/Dashboard.svelte
git commit -m "feat: wire markdown preview into SessionCard and Dashboard"
```

---

### Task 6: Manual testing and polish

- [ ] **Step 1: Start dev mode**

Run: `npm run tauri dev`
Expected: app builds and launches

- [ ] **Step 2: Test markdown preview**

Send a hook event with a Read tool targeting a `.md` file. Verify:
- Preview button (↗) appears on the tool row
- Clicking opens the MarkdownPreview modal
- Headings, code blocks, lists, tables render correctly with dark theme
- Escape closes the modal
- Clicking backdrop closes the modal

- [ ] **Step 3: Test error state**

Send a hook event with a Read tool targeting a non-existent `.md` file. Click preview. Verify the error message displays.

- [ ] **Step 4: Test that URL preview still works**

Send a hook event with a web_fetch tool. Verify the URL preview button still opens PreviewModal (not MarkdownPreview).

- [ ] **Step 5: Fix any issues found**

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix: polish markdown preview"
```
