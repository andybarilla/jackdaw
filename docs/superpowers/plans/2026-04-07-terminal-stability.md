# Terminal Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix flaky terminal rendering by correcting xterm.js lifecycle timing in Terminal.svelte.

**Architecture:** All changes are in `frontend/src/lib/Terminal.svelte`. The terminal instance is created eagerly in `onMount` but `open()` is deferred until the component is visible. Resize is debounced, fits are followed by forced repaints, and WebGL context loss is handled gracefully.

**Tech Stack:** Svelte 5 (runes), xterm.js v5, @xterm/addon-fit, @xterm/addon-webgl

**Spec:** `docs/superpowers/specs/2026-04-07-terminal-stability-design.md`

---

## File Structure

- **Modify:** `frontend/src/lib/Terminal.svelte` — terminal lifecycle, resize handling, WebGL resilience

---

### Task 1: Rewrite Terminal.svelte lifecycle

All five spec changes are in one file and deeply interrelated (deferred open moves code from `onMount` into `$effect`, which is where the debounced resize and WebGL setup also live). Implement them together.

**Files:**
- Modify: `frontend/src/lib/Terminal.svelte`

- [ ] **Step 1: Add `fitAndRefresh` helper and `opened` state variable**

After the existing variable declarations (after line 26 `let cleanups: ...`), add:

```typescript
let opened = false;

function fitAndRefresh(): void {
  fitAddon.fit();
  terminal.refresh(0, terminal.rows - 1);
}
```

- [ ] **Step 2: Replace the `$effect` block**

Replace the current `$effect` block (lines 28-33):

```typescript
$effect(() => {
  if (visible && fitAddon) {
    // Re-fit after becoming visible so xterm measures correctly
    requestAnimationFrame(() => fitAddon.fit());
  }
});
```

with the deferred-open logic that handles first open and subsequent visibility changes:

```typescript
$effect(() => {
  if (!visible || !terminal) return;

  if (!opened) {
    opened = true;
    terminal.open(terminalEl);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    fitAndRefresh();

    terminal.onData((data: string) => {
      EventsEmit("terminal-input", sessionId, data);
    });

    const cancelOutput = EventsOn(
      `terminal-output-${sessionId}`,
      (data: string) => {
        terminal.write(data);
      },
    );
    cleanups.push(cancelOutput);

    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!visible) return;
        fitAndRefresh();
        if (terminal.cols > 0 && terminal.rows > 0) {
          EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
        }
      }, 50);
    });
    resizeObserver.observe(terminalEl);
    cleanups.push(() => {
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
    });

    EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
    AttachSession(sessionId);

    onReady?.({ searchAddon, focus: () => terminal.focus() });
  } else {
    // Already opened, just becoming visible again — double-rAF for layout settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAndRefresh();
      });
    });
  }
});
```

- [ ] **Step 3: Trim `onMount` to only create the terminal and load addons**

Replace the entire `onMount` block with:

```typescript
onMount(() => {
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    theme: getXtermTheme(getTheme()),
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);
});
```

Everything that was previously in `onMount` after addon loading (`terminal.open()`, `WebglAddon`, `fitAddon.fit()`, `terminal.onData()`, `EventsOn`, `ResizeObserver`, `EventsEmit`, `AttachSession`, `onReady`) is now in the `$effect` above.

- [ ] **Step 4: Verify frontend type-checks**

Run: `cd frontend && npm run check`
Expected: No errors

- [ ] **Step 5: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/Terminal.svelte
git commit -m "fix: stabilize terminal rendering lifecycle

Defer terminal.open() until visible to prevent zero-size measurement.
Debounce ResizeObserver (50ms) with zero-dimension guard.
Force full repaint after every fit via fitAndRefresh helper.
Double-rAF on visibility change to ensure layout has settled.
Handle WebGL context loss gracefully with fallback to canvas."
```

---

### Task 2: Manual smoke test

- [ ] **Step 1: Run the app in dev mode**

Run: `GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41`

- [ ] **Step 2: Test each scenario**

1. Launch new session — terminal renders correctly with right dimensions
2. Launch second session while first is active — switch back to first, should render clean
3. Resize window during active session — no garbled output, final dimensions correct
4. Resize window, switch sessions — terminal reflows correctly
5. Restart Jackdaw with running sessions — recovered sessions render on first click
6. Rapid session switching — no blank/frozen terminals

- [ ] **Step 3: Fix and commit any issues found during testing**

If any issues found, fix and commit individually.
