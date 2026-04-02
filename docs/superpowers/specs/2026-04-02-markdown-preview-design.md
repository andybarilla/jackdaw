# Markdown File Preview

Clickable file paths in tool output for `.md` files open a rendered markdown preview modal. Builds on the Embedded Browser Preview infrastructure — same button UX, separate lightweight Svelte renderer instead of a native webview.

## Approach

Svelte-rendered markdown in a modal. A JS markdown library (`marked`) renders file content to HTML in the frontend. A Tauri command reads the file from disk. No webview needed — the content is displayed directly in a styled Svelte component.

## Data Flow

### Backend: `file_path` on `ToolEvent`

Add `file_path: Option<String>` to the `ToolEvent` struct. Extracted from `tool_input` for file tools (Read/Write/Edit and their canonical equivalents file_read/file_write/file_edit). Called alongside `extract_summary()` and `extract_urls()` during tool event ingestion.

A new function `extract_file_path(tool_name, tool_input)` returns `Option<String>` — pulls `file_path` from `tool_input` for matching tool names, `None` for others.

### Backend: `preview_read_file` command

New Tauri command: `preview_read_file(path: String) -> Result<String, String>`. Reads the file and returns its content. Validates the path exists and is a regular file.

### Frontend: Previewable file detection

A utility function `isPreviewableFile(path: string): boolean` checks if the path ends with `.md` (case-insensitive). Extensible to other types later.

### Frontend: Preview trigger

SessionCard gains `onPreviewFile?: (path: string) => void` prop. When a `ToolEvent` has a `file_path` that passes `isPreviewableFile`, the same preview button (↗) appears. Clicking calls `onPreviewFile`.

Dashboard routes file previews to `MarkdownPreview` and URL previews to `PreviewModal` (existing).

## MarkdownPreview Component (Svelte)

### Structure

- Dark backdrop overlay, centered, ~80% of window width/height (matches PreviewModal)
- Dismissible with Escape key or clicking backdrop
- Header bar: file basename display, close button
- Scrollable body: rendered markdown HTML

### Rendering

- Uses `marked` library to convert markdown to HTML
- HTML rendered via `{@html}` in Svelte
- Styled with dark theme CSS — headings, code blocks (inline and fenced), lists, links, tables, blockquotes, horizontal rules
- Code blocks use `JetBrains Mono` (already the app font)

### Behavior

- On mount, invokes `preview_read_file` with the file path
- Shows loading state while reading
- If file read fails, shows error message in the modal body

## Integration with Dashboard

- New state: `let previewFilePath = $state<string | null>(null)`
- `openPreviewFile(path)` sets `previewFilePath`
- `closePreviewFile()` clears it
- Escape handler: `previewFilePath` checked before `previewUrl` and other modals
- SessionCard instances receive `onPreviewFile={openPreviewFile}`

## Types

`ToolEvent` in `types.ts` gains `file_path: string | null`.

`ToolEvent` in `state.rs` gains `file_path: Option<String>`.

## Testing

### Backend (Rust, `cargo test`)

- `extract_file_path()`: returns path for Read/Write/Edit tools, `None` for Bash/Agent/Glob/etc.
- `preview_read_file`: reads existing file, returns error for missing file (if testable without Tauri runtime — otherwise manual only)

### Frontend (Vitest)

- `isPreviewableFile()`: `.md` returns true, `.MD` returns true, `.txt`/`.rs`/no extension returns false, null/undefined returns false
- Markdown rendering: `marked` converts basic markdown (heading, code block, list) to expected HTML structure

### Manual

- Trigger Read/Write/Edit on a `.md` file, verify preview button appears
- Click preview, verify rendered markdown
- Escape to close
- Test with non-existent file path — verify error display
