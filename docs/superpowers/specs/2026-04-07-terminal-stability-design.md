# Terminal Stability Design

Fix flaky terminal rendering in Jackdaw. Symptoms: garbled text, frozen terminals, broken reflow on resize, blank terminals on session switch/recovery. Root cause: xterm.js lifecycle timing — terminals render before they have correct dimensions, and visibility/resize transitions don't trigger proper repaints.

## Approach

Fix lifecycle timing in `Terminal.svelte`. No backend changes, no architecture changes. All changes are confined to the frontend terminal component.

## Changes

### 1. Defer terminal.open() until visible

Currently `onMount` calls `terminal.open(terminalEl)` immediately, even when the terminal wrapper has `visibility: hidden` (zero-size container). xterm.js measures wrong dimensions.

**Fix:** Create the `Terminal` instance and load addons in `onMount`, but defer `terminal.open(terminalEl)` until the `visible` prop is `true` for the first time. Use the existing `$effect` on `visible` to trigger first open. Event subscriptions (Wails output events, ResizeObserver) and `AttachSession()` also defer to first open, since there's nothing to write to or measure before then.

For the active session at creation time, `visible` is `true` immediately so open happens in the same tick as mount.

### 2. Robust re-fit on visibility change

The current visibility `$effect` does a single `requestAnimationFrame` then `fit()`. The browser may not have completed layout reflow in one frame after `visibility: hidden` -> `visible`.

**Fix:** Wait two rAF frames before calling `fitAndRefresh()`. This gives the browser a full layout cycle.

```
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    fitAndRefresh();
  });
});
```

### 3. Debounced ResizeObserver with zero-dimension guard

`ResizeObserver` fires on every observation, causing rapid-fire `fit()` + resize events during window resize drags. Many intermediate events have wrong dimensions. Hidden terminals can emit cols=0/rows=0.

**Fix:**
- Debounce the ResizeObserver callback with ~50ms timeout.
- After debounce settles: call `fitAndRefresh()`, then emit `terminal-resize` only if `cols > 0 && rows > 0`.
- Don't emit resize when the terminal isn't visible.

### 4. fitAndRefresh() helper

xterm.js (especially with WebGL renderer) doesn't always fully redraw after `fit()`. "Clicking fixes it" confirms data is in the buffer but canvas is stale.

**Fix:** Helper that calls `fitAddon.fit()` then `terminal.refresh(0, terminal.rows - 1)` to force full repaint. Used everywhere we currently call `fit()`.

```typescript
function fitAndRefresh(): void {
  fitAddon.fit();
  terminal.refresh(0, terminal.rows - 1);
}
```

### 5. WebGL context loss handler

WebGL context can be lost after initial load (GPU pressure, visibility changes). A lost context silently freezes the terminal.

**Fix:** Listen for context loss and dispose the WebGL addon, letting xterm.js fall back to canvas:

```typescript
const webglAddon = new WebglAddon();
webglAddon.onContextLoss(() => {
  webglAddon.dispose();
});
terminal.loadAddon(webglAddon);
```

Keep existing try/catch around `loadAddon` for environments without WebGL support.

## Files Modified

- `frontend/src/lib/Terminal.svelte` — all changes

## Testing

Manual testing:
1. Launch new session — terminal renders correctly with right dimensions
2. Launch second session while first is active — switch back to first, should render clean
3. Resize window during active session — no garbled output, final dimensions correct
4. Resize window, switch sessions — terminal reflows correctly
5. Restart Jackdaw with running sessions — recovered sessions render on first click
6. Rapid session switching — no blank/frozen terminals
