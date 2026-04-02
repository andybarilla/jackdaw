# Embedded Browser Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preview modal with an embedded native webview so users can view URLs from tool output without leaving Jackdaw.

**Architecture:** URLs are extracted from `tool_input` at ingestion time and stored on `ToolEvent`. The frontend renders clickable URLs and preview buttons. Clicking opens a Svelte modal overlay with a navigation bar; the actual page renders in a Tauri native webview embedded inside the main window via `window.add_child()`. Back/forward use `webview.eval("history.back()")`.

**Tech Stack:** Rust/Tauri v2 (with `unstable` feature for `add_child`), Svelte 5, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src-tauri/Cargo.toml` | Add `unstable` feature to tauri dependency |
| Modify | `src-tauri/capabilities/default.json` | Add webview permissions |
| Modify | `src-tauri/src/state.rs` | Add `extract_urls()`, add `urls` field to `ToolEvent` |
| Modify | `src-tauri/src/server.rs` | Call `extract_urls()` when constructing `ToolEvent` |
| Create | `src-tauri/src/preview.rs` | Preview webview lifecycle management + Tauri commands |
| Modify | `src-tauri/src/lib.rs` | Register preview module + commands |
| Modify | `src/lib/types.ts` | Add `urls` field to `ToolEvent` |
| Create | `src/lib/urls.ts` | URL extraction from summary text |
| Create | `src/lib/urls.test.ts` | Tests for URL extraction |
| Create | `src/lib/components/PreviewModal.svelte` | Modal overlay with nav bar |
| Modify | `src/lib/components/SessionCard.svelte` | Clickable URLs + preview buttons |
| Modify | `src/lib/components/Dashboard.svelte` | Mount PreviewModal, wire Escape handling |

---

### Task 1: Backend — `extract_urls()` and `ToolEvent.urls`

**Files:**
- Modify: `src-tauri/src/state.rs:70-77` (ToolEvent struct)
- Modify: `src-tauri/src/state.rs:104-119` (near extract_summary)
- Test: `src-tauri/src/state.rs` (existing `#[cfg(test)]` module)

- [ ] **Step 1: Write failing tests for `extract_urls()`**

Add these tests to the existing `#[cfg(test)] mod tests` block in `src-tauri/src/state.rs`:

```rust
#[test]
fn extract_urls_from_web_fetch() {
    let input = Some(json!({"url": "https://example.com/page"}));
    assert_eq!(extract_urls(&input), vec!["https://example.com/page"]);
}

#[test]
fn extract_urls_from_bash_command() {
    let input = Some(json!({"command": "curl https://api.example.com/data"}));
    assert_eq!(extract_urls(&input), vec!["https://api.example.com/data"]);
}

#[test]
fn extract_urls_from_nested_json() {
    let input = Some(json!({
        "content": "Check http://localhost:3000/dashboard for the result"
    }));
    assert_eq!(extract_urls(&input), vec!["http://localhost:3000/dashboard"]);
}

#[test]
fn extract_urls_multiple() {
    let input = Some(json!({
        "command": "curl https://a.com && curl https://b.com"
    }));
    let urls = extract_urls(&input);
    assert_eq!(urls, vec!["https://a.com", "https://b.com"]);
}

#[test]
fn extract_urls_none_input() {
    assert_eq!(extract_urls(&None), Vec::<String>::new());
}

#[test]
fn extract_urls_no_urls() {
    let input = Some(json!({"command": "ls -la"}));
    assert_eq!(extract_urls(&input), Vec::<String>::new());
}

#[test]
fn extract_urls_deduplicates() {
    let input = Some(json!({
        "url": "https://example.com",
        "command": "fetch https://example.com"
    }));
    assert_eq!(extract_urls(&input), vec!["https://example.com"]);
}

#[test]
fn extract_urls_localhost_with_port() {
    let input = Some(json!({"command": "open http://localhost:5173/page"}));
    assert_eq!(extract_urls(&input), vec!["http://localhost:5173/page"]);
}

#[test]
fn extract_urls_filters_disallowed_schemes() {
    let input = Some(json!({"command": "javascript:alert(1) https://safe.com"}));
    assert_eq!(extract_urls(&input), vec!["https://safe.com"]);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test extract_urls`
Expected: compilation error — `extract_urls` not defined

- [ ] **Step 3: Implement `extract_urls()`**

Add to `src-tauri/src/state.rs`, right after the `extract_summary` function (after line 119):

```rust
/// Extract URLs from tool_input by walking all string values in the JSON.
pub fn extract_urls(tool_input: &Option<serde_json::Value>) -> Vec<String> {
    let Some(input) = tool_input else {
        return Vec::new();
    };

    let mut urls = Vec::new();
    collect_urls_from_value(input, &mut urls);

    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    urls.retain(|url| seen.insert(url.clone()));
    urls
}

fn collect_urls_from_value(value: &serde_json::Value, urls: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => extract_urls_from_str(s, urls),
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_urls_from_value(v, urls);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                collect_urls_from_value(v, urls);
            }
        }
        _ => {}
    }
}

fn extract_urls_from_str(s: &str, urls: &mut Vec<String>) {
    // Match http://, https://, and file:// URLs
    let mut remaining = s;
    while let Some(start) = remaining.find("http://")
        .or_else(|| remaining.find("https://"))
        .or_else(|| remaining.find("file://"))
    {
        let url_start = &remaining[start..];
        // URL ends at whitespace, quote, backtick, or end of string
        let end = url_start
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '`' || c == '>' || c == ')' || c == ']')
            .unwrap_or(url_start.len());
        let url = &url_start[..end];
        // Basic validation: must have at least scheme + something after ://
        if url.len() > 8 {
            urls.push(url.to_string());
        }
        remaining = &remaining[start + end..];
    }
}
```

- [ ] **Step 4: Add `urls` field to `ToolEvent`**

In `src-tauri/src/state.rs`, update the `ToolEvent` struct (line 70-77):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct ToolEvent {
    pub tool_name: String,
    pub timestamp: DateTime<Utc>,
    pub summary: Option<String>,
    pub urls: Vec<String>,
    #[serde(skip_serializing)]
    pub tool_use_id: Option<String>,
}
```

Then fix every place that constructs a `ToolEvent` to include `urls: Vec::new()` (or the actual URLs). There are several construction sites:

In `hydrate_from_history` (line 238):
```rust
self.tool_history.push(ToolEvent {
    tool_name: event.tool_name.clone(),
    timestamp: ts,
    summary: event.summary.clone(),
    urls: Vec::new(),
    tool_use_id: None,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test extract_urls`
Expected: all 9 `extract_urls_*` tests pass

- [ ] **Step 6: Fix any remaining compilation errors**

Run: `cd src-tauri && cargo test`
Expected: full test suite passes. Fix any `ToolEvent` construction sites that are missing `urls`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: add extract_urls() and urls field to ToolEvent"
```

---

### Task 2: Backend — Wire URL extraction through server.rs

**Files:**
- Modify: `src-tauri/src/server.rs:252-298` (PreToolUse and PostToolUse handlers)

- [ ] **Step 1: Update imports in server.rs**

In `src-tauri/src/server.rs` line 5, add `extract_urls` to the import:

```rust
use crate::state::{extract_summary, extract_urls, AppState, HookPayload, Session, ToolEvent};
```

- [ ] **Step 2: Update PreToolUse handler to extract URLs**

In `src-tauri/src/server.rs`, in the `"PreToolUse"` match arm (around line 260), update the ToolEvent construction:

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
    let tool_event = ToolEvent {
        tool_name,
        timestamp: Utc::now(),
        summary,
        urls,
        tool_use_id: payload.tool_use_id,
    };

    if let Some(session) = sessions.get_mut(&session_id) {
        session.pending_approval = false;
        session.processing = true;
        session.set_current_tool(tool_event);
    }
}
```

- [ ] **Step 3: Update PostToolUse handler to extract URLs**

In the `"PostToolUse"` match arm (around line 284):

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
    let now = Utc::now();
    let tool_event = ToolEvent {
        tool_name: tool_name.clone(),
        timestamp: now,
        summary: summary.clone(),
        urls,
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

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat: extract URLs from tool_input in PreToolUse/PostToolUse"
```

---

### Task 3: Backend — Preview webview management

**Files:**
- Create: `src-tauri/src/preview.rs`
- Modify: `src-tauri/src/lib.rs:1-5` (add mod), `src-tauri/src/lib.rs:670-699` (register commands)
- Modify: `src-tauri/Cargo.toml:22` (add unstable feature)
- Modify: `src-tauri/capabilities/default.json` (add webview permissions)

- [ ] **Step 1: Add `unstable` feature to Tauri in Cargo.toml**

In `src-tauri/Cargo.toml` line 22, change:

```toml
tauri = { version = "2", features = ["tray-icon", "image-png", "unstable"] }
```

- [ ] **Step 2: Add webview permissions to capabilities**

In `src-tauri/capabilities/default.json`, add to the permissions array:

```json
"core:webview:allow-create-webview",
"core:webview:allow-set-webview-position",
"core:webview:allow-set-webview-size"
```

- [ ] **Step 3: Create `src-tauri/src/preview.rs`**

```rust
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri::webview::WebviewBuilder;
use tauri_runtime::dpi::{LogicalPosition, LogicalSize};

pub struct PreviewState {
    webview: Mutex<Option<Webview>>,
}

impl PreviewState {
    pub fn new() -> Self {
        Self {
            webview: Mutex::new(None),
        }
    }
}

fn is_allowed_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://") || url.starts_with("file://")
}

#[tauri::command]
pub async fn preview_open(
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    app: AppHandle,
    state: tauri::State<'_, PreviewState>,
) -> Result<String, String> {
    if !is_allowed_url(&url) {
        return Err(format!("Blocked URL scheme: {url}"));
    }

    let mut webview_lock = state.webview.lock().unwrap();

    // If webview exists, navigate it
    if let Some(ref wv) = *webview_lock {
        wv.navigate(url::Url::parse(&url).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        // Reposition in case modal moved
        let _ = wv.set_position(LogicalPosition::new(x, y).into());
        let _ = wv.set_size(LogicalSize::new(width, height).into());
        return Ok(url);
    }

    // Create new webview
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let emit_handle = app.clone();

    let builder = WebviewBuilder::new("preview", tauri::WebviewUrl::External(parsed_url))
        .auto_resize()
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            let _ = emit_handle.emit("preview-navigation", &url_str);
            // Only allow http/https/file navigations
            let scheme = nav_url.scheme();
            scheme == "http" || scheme == "https" || scheme == "file"
        });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    *webview_lock = Some(webview);
    Ok(url)
}

#[tauri::command]
pub fn preview_back(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        wv.eval("window.history.back()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_forward(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        wv.eval("window.history.forward()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_close(state: tauri::State<'_, PreviewState>) -> Result<(), String> {
    let mut lock = state.webview.lock().unwrap();
    if let Some(wv) = lock.take() {
        let _ = wv.close();
    }
    Ok(())
}

#[tauri::command]
pub fn preview_get_url(state: tauri::State<'_, PreviewState>) -> Result<Option<String>, String> {
    let lock = state.webview.lock().unwrap();
    if let Some(ref wv) = *lock {
        Ok(Some(wv.url().map_err(|e| e.to_string())?.to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_allowed_url_accepts_http() {
        assert!(is_allowed_url("http://example.com"));
        assert!(is_allowed_url("https://example.com"));
        assert!(is_allowed_url("file:///home/user/page.html"));
    }

    #[test]
    fn is_allowed_url_rejects_dangerous_schemes() {
        assert!(!is_allowed_url("javascript:alert(1)"));
        assert!(!is_allowed_url("data:text/html,<h1>hi</h1>"));
        assert!(!is_allowed_url("blob:http://example.com/abc"));
        assert!(!is_allowed_url("ftp://files.example.com"));
    }
}
```

- [ ] **Step 4: Add `url` crate dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
url = "2"
```

- [ ] **Step 5: Register module and commands in lib.rs**

In `src-tauri/src/lib.rs`, add the module declaration near the top with the other `mod` statements:

```rust
mod preview;
```

In the `run()` function, add the managed state after the existing `.manage()` calls (around line 595):

```rust
.manage(preview::PreviewState::new())
```

In the `invoke_handler` macro (around line 670), add the preview commands:

```rust
preview::preview_open,
preview::preview_back,
preview::preview_forward,
preview::preview_close,
preview::preview_get_url,
```

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass including new `preview::tests::*`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/preview.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/capabilities/default.json
git commit -m "feat: add preview webview management commands"
```

---

### Task 4: Frontend — URL types and extraction utility

**Files:**
- Modify: `src/lib/types.ts:3-7` (ToolEvent interface)
- Create: `src/lib/urls.ts`
- Create: `src/lib/urls.test.ts`

- [ ] **Step 1: Write failing tests for URL extraction**

Create `src/lib/urls.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractUrlsFromText } from './urls';

describe('extractUrlsFromText', () => {
  it('extracts http URLs', () => {
    expect(extractUrlsFromText('visit http://example.com now')).toEqual([
      { url: 'http://example.com', start: 6, end: 24 },
    ]);
  });

  it('extracts https URLs', () => {
    expect(extractUrlsFromText('see https://example.com/path')).toEqual([
      { url: 'https://example.com/path', start: 4, end: 28 },
    ]);
  });

  it('extracts multiple URLs', () => {
    const result = extractUrlsFromText('https://a.com and https://b.com');
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('https://a.com');
    expect(result[1].url).toBe('https://b.com');
  });

  it('extracts localhost URLs with port', () => {
    expect(extractUrlsFromText('http://localhost:5173/page')).toEqual([
      { url: 'http://localhost:5173/page', start: 0, end: 26 },
    ]);
  });

  it('returns empty array for no URLs', () => {
    expect(extractUrlsFromText('just some text')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(extractUrlsFromText(null)).toEqual([]);
    expect(extractUrlsFromText(undefined)).toEqual([]);
  });

  it('handles URLs at end of string', () => {
    const result = extractUrlsFromText('go to https://example.com');
    expect(result[0].url).toBe('https://example.com');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --reporter=verbose urls`
Expected: FAIL — module `./urls` not found

- [ ] **Step 3: Implement URL extraction**

Create `src/lib/urls.ts`:

```typescript
export interface UrlMatch {
  url: string;
  start: number;
  end: number;
}

const URL_REGEX = /https?:\/\/[^\s"'`>\])]*/g;

export function extractUrlsFromText(text: string | null | undefined): UrlMatch[] {
  if (!text) return [];

  const matches: UrlMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match[0].length > 8) {
      matches.push({
        url: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return matches;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --reporter=verbose urls`
Expected: all tests pass

- [ ] **Step 5: Update `ToolEvent` TypeScript interface**

In `src/lib/types.ts`, update the `ToolEvent` interface (lines 3-7):

```typescript
export interface ToolEvent {
  tool_name: string;
  timestamp: string; // ISO 8601 from Rust chrono
  summary: string | null;
  urls: string[];
}
```

- [ ] **Step 6: Run type check**

Run: `npm run check`
Expected: passes (or reveals places that construct ToolEvent objects that need `urls` added — fix any test fixtures)

- [ ] **Step 7: Commit**

```bash
git add src/lib/urls.ts src/lib/urls.test.ts src/lib/types.ts
git commit -m "feat: add URL extraction utility and urls field to ToolEvent"
```

---

### Task 5: Frontend — PreviewModal component

**Files:**
- Create: `src/lib/components/PreviewModal.svelte`

- [ ] **Step 1: Create PreviewModal component**

Create `src/lib/components/PreviewModal.svelte`:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';

  interface Props {
    url: string;
    onClose: () => void;
  }

  let { url, onClose }: Props = $props();

  let currentUrl = $state(url);
  let modalBody: HTMLDivElement | undefined = $state();
  let loading = $state(true);

  onMount(() => {
    const unlisten = listen<string>('preview-navigation', (event) => {
      currentUrl = event.payload;
      loading = false;
    });

    openPreview();

    return () => {
      unlisten.then((fn) => fn());
      invoke('preview_close').catch(() => {});
    };
  });

  async function openPreview() {
    loading = true;
    if (!modalBody) return;
    const rect = modalBody.getBoundingClientRect();
    try {
      await invoke('preview_open', {
        url,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
      loading = false;
    } catch (e) {
      console.error('Failed to open preview:', e);
      loading = false;
    }
  }

  async function handleBack() {
    await invoke('preview_back').catch(() => {});
  }

  async function handleForward() {
    await invoke('preview_forward').catch(() => {});
  }

  async function handleOpenExternal() {
    await openUrl(currentUrl);
  }

  function handleBackdropClick() {
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  }

  // Reposition webview when modal resizes
  $effect(() => {
    if (modalBody) {
      const observer = new ResizeObserver(() => {
        const rect = modalBody!.getBoundingClientRect();
        invoke('preview_open', {
          url: currentUrl,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }).catch(() => {});
      });
      observer.observe(modalBody);
      return () => observer.disconnect();
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="preview-backdrop" onclick={handleBackdropClick}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="preview-modal" onclick={(e) => e.stopPropagation()}>
    <div class="preview-nav">
      <div class="nav-buttons">
        <button class="nav-btn" onclick={handleBack} title="Back">&#x2190;</button>
        <button class="nav-btn" onclick={handleForward} title="Forward">&#x2192;</button>
      </div>
      <div class="nav-url" title={currentUrl}>{currentUrl}</div>
      <div class="nav-actions">
        <button class="nav-btn" onclick={handleOpenExternal} title="Open in browser">&#x2197;</button>
        <button class="nav-btn close-btn" onclick={onClose} title="Close">&#x2715;</button>
      </div>
    </div>
    <div class="preview-body" bind:this={modalBody}>
      {#if loading}
        <div class="preview-loading">Loading...</div>
      {/if}
      <!-- Native webview renders here, positioned absolutely by Tauri -->
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

  .preview-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
  }

  .nav-buttons {
    display: flex;
    gap: 2px;
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

  .nav-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .close-btn:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .nav-url {
    flex: 1;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 8px;
    background: var(--tool-bg);
    border: 1px solid var(--border);
  }

  .nav-actions {
    display: flex;
    gap: 2px;
  }

  .preview-body {
    flex: 1;
    position: relative;
  }

  .preview-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: passes

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/PreviewModal.svelte
git commit -m "feat: add PreviewModal component with nav bar"
```

---

### Task 6: Frontend — Clickable URLs in SessionCard

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add preview URL state and import**

In `src/lib/components/SessionCard.svelte`, add a new prop to the Props interface (after line 17):

```typescript
onPreviewUrl?: (url: string) => void;
```

Update the destructured props to include it:

```typescript
let { session, onDismiss, historyMode = false, endedAt, compact = false, onOpenShell, onPreviewUrl }: Props = $props();
```

- [ ] **Step 2: Add URL click handler**

After the existing derived state declarations, add:

```typescript
function handleUrlClick(event: MouseEvent, url: string) {
  event.stopPropagation();
  onPreviewUrl?.(url);
}
```

- [ ] **Step 3: Add preview buttons to tool displays**

In the active tool row (around line 161-163), after the summary span for `session.current_tool`:

```svelte
{#if session.current_tool.urls.length > 0 && onPreviewUrl}
  <button
    class="preview-btn"
    onclick={(e) => handleUrlClick(e, session.current_tool!.urls[0])}
    title={session.current_tool.urls[0]}
  >&#x2197;</button>
{/if}
```

Apply the same pattern after the summary span in the dimmed lastTool display (around line 169-171).

For history items (around line 204-206), after the `history-summary` span:

```svelte
{#if tool.urls.length > 0 && onPreviewUrl}
  <button
    class="preview-btn"
    onclick={(e) => handleUrlClick(e, tool.urls[0])}
    title={tool.urls[0]}
  >&#x2197;</button>
{/if}
```

- [ ] **Step 4: Add preview button styles**

In the `<style>` section of SessionCard.svelte, add:

```css
.preview-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 0 4px;
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
  flex-shrink: 0;
  margin-left: 4px;
}

.preview-btn:hover {
  color: var(--active);
  border-color: var(--active);
}
```

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: passes

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add clickable URL preview buttons to SessionCard"
```

---

### Task 7: Frontend — Wire PreviewModal into Dashboard

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Add preview state and import**

In `src/lib/components/Dashboard.svelte`, add the import (near the top of the `<script>` block, with the other component imports):

```typescript
import PreviewModal from './PreviewModal.svelte';
```

Add preview URL state (near the other state declarations, around line 35):

```typescript
let previewUrl = $state<string | null>(null);
```

Add handler functions:

```typescript
function openPreview(url: string) {
  previewUrl = url;
}

function closePreview() {
  previewUrl = null;
}
```

- [ ] **Step 2: Update close-modal shortcut handler**

In the keyboard shortcut handler (around line 286), update the `close-modal` case:

```typescript
case 'close-modal':
  if (previewUrl) closePreview();
  else if (confirmCloseCount !== null) dismissConfirmClose();
  else if (showNewSessionMenu) closeNewSessionMenu();
  return;
```

- [ ] **Step 3: Pass `onPreviewUrl` to SessionCard instances**

Find where `<SessionCard>` is rendered and add the `onPreviewUrl` prop. There are multiple render sites in Dashboard.svelte — search for `<SessionCard` and add `onPreviewUrl={openPreview}` to each instance.

- [ ] **Step 4: Add PreviewModal to the template**

At the end of the template, before the closing tags or after the existing modals, add:

```svelte
{#if previewUrl}
  <PreviewModal url={previewUrl} onClose={closePreview} />
{/if}
```

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: passes

- [ ] **Step 6: Run all frontend tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 7: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: wire PreviewModal into Dashboard with Escape handling"
```

---

### Task 8: Integration testing and polish

**Files:**
- Various — fix any issues found during manual testing

- [ ] **Step 1: Start dev mode**

Run: `npm run tauri dev`
Expected: app builds and launches without errors

- [ ] **Step 2: Manual test — URL detection**

Send a hook event with a `web_fetch` tool that has a URL in `tool_input`. Verify the preview button appears on the tool row.

- [ ] **Step 3: Manual test — preview modal**

Click the preview button. Verify:
- Modal overlay appears with dark backdrop
- Navigation bar shows the URL
- Native webview loads the page
- Escape closes the modal
- Clicking backdrop closes the modal

- [ ] **Step 4: Manual test — navigation**

With the preview open:
- Click a link within the previewed page
- Verify the URL bar updates
- Click back button — previous page loads
- Click forward button — returns to the page
- Click "open in browser" — system browser opens with the URL

- [ ] **Step 5: Fix any issues found**

Address any visual, functional, or positioning issues discovered during manual testing.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix: polish embedded browser preview integration"
```
