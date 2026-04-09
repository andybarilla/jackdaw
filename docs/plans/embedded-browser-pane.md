# Embedded Browser Pane

## Overview

Add a browser pane type that renders a URL in an iframe alongside terminals. The primary trigger is clicking a URL in terminal output — instead of opening in the system browser, it opens in a pane within the app.

## UX

- Click a URL in terminal output → opens in a browser pane as a new tab (adjacent to the terminal)
- URL bar at top of the pane for manual navigation and refresh
- Browser panes don't persist across app restart (same as diff/settings)

## Data Flow

```
URL appears in terminal output (xterm.js WebLinksAddon detects it)
  → User clicks URL
  → WebLinksAddon handler callback fires with the URL
  → Terminal emits event / calls callback to open browser pane
  → App.svelte opens browser pane with { type: "browser", url: "..." }
  → BrowserPane.svelte renders iframe + URL bar
```

No backend changes needed — purely frontend.

## Frontend Changes

### 1. PaneContent type (`frontend/src/lib/layout.ts`)

Add variant:
```typescript
| { type: "browser"; url: string }
```

Add helpers: `findBrowserByUrl`, `collectBrowserPanes`.

### 2. Terminal.svelte — intercept link clicks

WebLinksAddon is already loaded (line 173). Pass a custom handler to open URLs in a pane instead of the system browser:

```typescript
terminal.loadAddon(new WebLinksAddon((_event, url) => {
  onOpenUrl?.(url);
}));
```

Add `onOpenUrl` to the Terminal component's Props interface.

### 3. BrowserPane component (`frontend/src/lib/BrowserPane.svelte`)

- URL bar at top: text input showing current URL, Enter to navigate, refresh button
- iframe fills remaining space
- `onUrlChange` callback updates the PaneContent so URL persists when switching tabs
- Style: matches app dark theme

### 4. PaneContainer routing (`frontend/src/lib/PaneContainer.svelte`)

Add case:
```svelte
{:else if content.type === "browser"}
  <BrowserPane url={content.url} onUrlChange={...} />
```

### 5. TabBar label (`frontend/src/lib/TabBar.svelte`)

```typescript
if (content.type === "browser") {
  try { return new URL(content.url).host; }
  catch { return "Browser"; }
}
```

### 6. App.svelte integration

- `openBrowserPane(url: string)`: if a browser tab with that URL already exists, focus it; otherwise add as new tab in the focused pane
- Wire `onOpenUrl` from Terminal through PaneContainer to App
- Startup cleanup: strip browser tabs from persisted layout

## File Changes

| Action | Path |
|--------|------|
| Modify | `frontend/src/lib/layout.ts` — add `browser` PaneContent variant + helpers |
| Create | `frontend/src/lib/BrowserPane.svelte` — iframe + URL bar component |
| Modify | `frontend/src/lib/Terminal.svelte` — custom WebLinksAddon handler, `onOpenUrl` prop |
| Modify | `frontend/src/lib/PaneContainer.svelte` — route `browser` type, pass `onOpenUrl` |
| Modify | `frontend/src/lib/TabBar.svelte` — label for browser tabs |
| Modify | `frontend/src/App.svelte` — `openBrowserPane()`, startup cleanup |

## Non-goals

- Port detection (separate roadmap item)
- DevTools integration
- QuickPicker/sidebar integration (could add later, but the primary UX is clicking links)
- Proxy or CORS workarounds — iframe loads localhost directly
