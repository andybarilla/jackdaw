# Embedded Browser Preview

Clickable URLs in tool output open a preview modal with a native Tauri webview, so users can review agent-generated web content without leaving Jackdaw.

## Approach

Tauri Webview Embed + Svelte Chrome. The modal overlay (backdrop, nav bar, close behavior) is Svelte. The page rendering is a native webview created and managed via Tauri commands, embedded inside the main window. This avoids iframe CORS restrictions and separate-window UX issues.

## URL Detection & Data Flow

### Backend: `extract_urls()`

A new function in `state.rs` scans `tool_input` (the full `serde_json::Value`) for URLs. Returns `Vec<String>`.

- Matches `http://`, `https://`, and `localhost:` patterns in string values
- Walks the JSON value recursively — URLs can appear in any field (`url`, `command`, `content`, nested objects)
- Called alongside `extract_summary()` during tool event ingestion
- Results stored in a new `urls: Vec<String>` field on `ToolEvent`

### Frontend: URL rendering

`ToolEvent` in `types.ts` gains `urls: string[]`. In tool summaries and history:

- URLs in summary text become clickable links
- Tool events with URLs get a preview icon button next to the tool name
- Clicking either opens the preview modal

## Preview Modal (Svelte)

### Structure

- Dark backdrop overlay, centered, ~80% of window width/height
- Dismissible with Escape key or clicking backdrop
- **Navigation bar** (top): back, forward, URL display (read-only), "open in browser" button, close button
- **Webview area** (body): native Tauri webview fills the remaining space

### Behavior

- Opening a URL creates the webview (or navigates an existing one)
- Only one preview webview at a time — new URLs reuse it
- Back/forward buttons invoke Tauri commands for history navigation
- URL display updates via `preview-navigation` events from the backend
- "Open in browser" uses `tauri::shell::open` to hand off to the system browser
- Closing destroys the webview

## Backend: Tauri Commands

### Preview state

`PreviewState` stored in app state behind a Mutex. Holds `Option<Webview>` for the current preview webview.

### Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `preview_open` | `url: String` | `String` (url) | Creates webview if none exists and navigates to URL; if webview exists, navigates it |
| `preview_back` | — | `()` | Go back in history |
| `preview_forward` | — | `()` | Go forward in history |
| `preview_close` | — | `()` | Destroys the webview |
| `preview_get_url` | — | `Option<String>` | Returns current URL |

### Events

- `preview-navigation` — emitted when the webview navigates (page load, redirect). Payload: `{ url: String }`. Frontend nav bar listens to this to stay in sync.

### Webview configuration

- Positioned inside the main window to align with the Svelte modal bounds
- Isolated context: no access to Tauri commands or app IPC
- Created with `WebviewBuilder` + positioned via `set_position`/`set_size`

## Security

### URL validation

Both frontend and backend validate URLs before opening:

- Allowed schemes: `http`, `https`, `file`
- Blocked: `javascript:`, `data:`, `blob:`, and anything else

### Webview isolation

- Preview webview has no IPC access — it cannot invoke Tauri commands
- No shared cookies or storage with the main app webview
- Crashes are detected; backend emits an event so the frontend can close the modal

## Testing

### Backend (Rust, `cargo test`)

- `extract_urls()`: URL extraction from various `tool_input` shapes — `web_fetch` with `.url`, Bash with URLs in command strings, nested JSON, no URLs, malformed URLs, disallowed schemes
- URL validation: scheme filtering (allow http/https/file, reject others)
- Preview state: open/close/reuse lifecycle

### Frontend (Vitest)

- URL detection in summary text: regex/parser for extracting URLs from plain text
- ToolEvent rendering: URLs produce clickable links and preview buttons
- Modal state: open/close/Escape behavior
- Nav bar: URL display, back/forward button disabled states

### Manual

- Webview creation, navigation, back/forward, open in browser
- Webview positioning/sizing relative to modal
- Loading error pages (no network, bad URL)
