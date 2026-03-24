# Brutalist UI Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-dark visual skin with a brutalist design using the whattheflock brand palette (pink/black/monospace).

**Architecture:** CSS-only changes plus font bundling. No layout, functionality, or backend changes. Every component keeps its structure — only colors, typography, border-radius, and glow effects change.

**Tech Stack:** Svelte 5 scoped styles, CSS custom properties, JetBrains Mono (bundled woff2)

**Spec:** `docs/superpowers/specs/2026-03-23-brutalist-skin-design.md`

---

### Task 1: Bundle JetBrains Mono fonts

**Files:**
- Create: `src/assets/fonts/JetBrainsMono-Regular.woff2`
- Create: `src/assets/fonts/JetBrainsMono-SemiBold.woff2`
- Create: `src/assets/fonts/JetBrainsMono-Bold.woff2`

- [ ] **Step 1: Create fonts directory and download font files**

```bash
mkdir -p src/assets/fonts
curl -L -o /tmp/JetBrainsMono.zip "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip"
unzip -j /tmp/JetBrainsMono.zip "fonts/webfonts/JetBrainsMono-Regular.woff2" -d src/assets/fonts/
unzip -j /tmp/JetBrainsMono.zip "fonts/webfonts/JetBrainsMono-SemiBold.woff2" -d src/assets/fonts/
unzip -j /tmp/JetBrainsMono.zip "fonts/webfonts/JetBrainsMono-Bold.woff2" -d src/assets/fonts/
rm /tmp/JetBrainsMono.zip
```

- [ ] **Step 2: Verify files exist**

Run: `ls -la src/assets/fonts/`
Expected: Three `.woff2` files present.

- [ ] **Step 3: Commit**

```bash
git add src/assets/fonts/
git commit -m "chore: bundle JetBrains Mono woff2 fonts"
```

---

### Task 2: Replace app.css design tokens and global styles

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Replace app.css with new tokens and @font-face declarations**

Replace the entire contents of `src/app.css` with:

```css
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-SemiBold.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --bg: #000000;
  --card-bg: #111111;
  --tool-bg: #0a0a0a;
  --border: #222222;
  --border-active: #ff2d7830;
  --border-active-tool: #ff2d7840;
  --border-attention: #d4a01730;
  --border-attention-tool: #d4a01740;
  --text-primary: #d4d4d4;
  --text-secondary: #999999;
  --text-muted: #666666;
  --active: #ff2d78;
  --active-hover: #ff4d8e;
  --attention: #d4a017;
  --success: #3fb950;
  --error: #f85149;
  --idle: #444444;
  --glow-active: 0 0 12px #ff2d7810;
  --glow-attention: 0 0 12px #d4a01710;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  border-radius: 0 !important;
}

body {
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app.css
git commit -m "feat: replace design tokens with brutalist palette"
```

---

### Task 3: Update SessionStatusIcon color classes

**Files:**
- Modify: `src/lib/components/SessionStatusIcon.svelte`

- [ ] **Step 1: Update the style block**

Replace the color classes in `<style>`:

```css
.status-green { color: var(--active); }
.status-blue { color: var(--attention); }
.status-orange { color: var(--attention); }
.status-gray { color: var(--text-muted); }
```

No other changes — keep pulse animation and component logic.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/SessionStatusIcon.svelte
git commit -m "feat: remap session status colors to brutalist palette"
```

---

### Task 4: Collapse ToolIcon to single active color

**Files:**
- Modify: `src/lib/components/ToolIcon.svelte`

- [ ] **Step 1: Update the style block**

Replace all tool color classes with a single color:

```css
.tool-green { color: var(--active); }
.tool-blue { color: var(--active); }
.tool-orange { color: var(--active); }
.tool-purple { color: var(--active); }
.tool-cyan { color: var(--active); }
.tool-gray { color: var(--text-muted); }
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ToolIcon.svelte
git commit -m "feat: collapse tool icon colors to single active pink"
```

---

### Task 5: Update Header colors

**Files:**
- Modify: `src/lib/components/Header.svelte`

- [ ] **Step 1: Update the style block**

Replace status color classes:

```css
.status-green { color: var(--active); }
.status-blue { color: var(--attention); }
.status-orange { color: var(--attention); }
.status-gray { color: var(--text-muted); }
```

Remove `border-radius: 4px;` from `.window-btn`.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Header.svelte
git commit -m "feat: update header to brutalist palette"
```

---

### Task 6: Update Dashboard tab colors

**Files:**
- Modify: `src/lib/components/Dashboard.svelte`

- [ ] **Step 1: Update the style block**

In `.tab.active`, change `border-bottom-color` from `var(--blue)` to `var(--active)`.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Dashboard.svelte
git commit -m "feat: update tab active color to pink"
```

---

### Task 7: Update SessionCard with glow effects and state-based borders

This is the largest change. The card needs to apply different border colors and box-shadows based on session state.

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add state-based CSS classes to the card element**

In the template, update the card `<div>` to include state classes. Change:

```svelte
<div class="card" class:expanded>
```

To:

```svelte
<div class="card" class:expanded class:running={isActive} class:needs-attention={isPending}>
```

- [ ] **Step 2: Update the style block**

Replace `.card` border-radius and add state variants:

```css
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
}

.card.running {
  border-color: var(--border-active);
  box-shadow: var(--glow-active);
}

.card.needs-attention {
  border-color: var(--border-attention);
  box-shadow: var(--glow-attention);
}

.card.expanded {
  /* No border-color override — inherits from state (.running, .needs-attention, or default) */
}
```

Remove `border-radius: 8px;` from `.card`.
Remove `border-radius: 6px;` from `.tool-display`.
Remove `border-radius: 4px;` from `.dismiss`.

Update `.tool-display` default border to use `--border` (neutral). Change:

```css
.tool-display {
  background: var(--tool-bg);
  border: 1px solid var(--tool-border);
```

To:

```css
.tool-display {
  background: var(--tool-bg);
  border: 1px solid var(--border);
```

Add active tool border (only when actively running):

```css
.tool-display.active {
  border-color: var(--border-active-tool);
}

.tool-display.active .tool-name {
  color: var(--active);
}
```

Update `.tool-display.dimmed` border to `var(--border)` (already the default now, but keep the rule explicit).

Update `.subagent-count` color from `var(--blue)` to `var(--active)`.

- [ ] **Step 3: Handle attention state tool border**

The card needs attention-state tool borders when `isPending` is true. Add a CSS class for attention tool display. In the template, update the tool-display div to include a class based on state.

Change `<div class="tool-display active">` (line 56, which has a hardcoded `active` class) to:

```svelte
<div class="tool-display" class:active={isActive && !isPending} class:attention={isPending}>
```

Also update the tool row visibility conditional from `{#if isActive}` to `{#if isActive || isPending}` so that pending-approval sessions show their tool row with amber styling.

And add the attention variant in styles:

```css
.tool-display.attention {
  border-color: var(--border-attention-tool);
}

.tool-display.attention .tool-name {
  color: var(--attention);
}
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: add glow effects and state-based borders to session cards"
```

---

### Task 8: Update HookSetup styling

**Files:**
- Modify: `src/lib/components/HookSetup.svelte`

- [ ] **Step 1: Update the style block**

Remove all `border-radius` values (from `.hook-setup`, `.scope-toggle`, `.scope-toggle label`, `.path-input`, `.btn`).

Update colors:
- `.status.installed`: `var(--green)` → `var(--success)`
- `.status.outdated`: `var(--yellow)` → `var(--attention)`
- `.btn-primary` background and border-color: `var(--blue)` → `var(--active)`
- `.message.success`: `var(--green)` → `var(--success)`
- `.message.error`: hardcoded `#f85149` → `var(--error)`

Note: radio inputs have `display: none` so no `accent-color` change needed.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/HookSetup.svelte
git commit -m "feat: update HookSetup to brutalist palette"
```

---

### Task 9: Update Settings styling

**Files:**
- Modify: `src/lib/components/Settings.svelte`

- [ ] **Step 1: Update the style block**

Change checkbox `accent-color` from `var(--blue)` to `var(--active)`.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Settings.svelte
git commit -m "feat: update settings checkbox accent to pink"
```

---

### Task 10: Visual verification

- [ ] **Step 1: Start dev server**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify all states visually**

Check each state against the mockup:
- Running session: pink glow border, pink tool name
- Approval/input session: amber glow border, amber tool name
- Idle session: flat `#222` border, gray text
- Expanded card: inherits state border
- Header: JetBrains Mono, pink status icon
- Tabs: pink active underline
- HookSetup: pink primary button, no rounded corners
- Settings: pink checkbox accent
- All elements: zero border-radius

- [ ] **Step 3: Run full check suite**

Run: `npm run check && npm test`
Expected: All pass.

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: visual adjustments from verification"
```
