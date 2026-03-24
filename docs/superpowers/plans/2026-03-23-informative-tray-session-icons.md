# Informative Tray & Session Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace monochrome tray dots and Unicode tool indicators with distinct, color-coded Lucide icons that communicate session and tool state at a glance.

**Architecture:** Backend gets a `TrayState` enum with priority-based resolution replacing the current `(usize, usize)` tuple. Frontend adds `lucide-svelte` and a `ToolIcon.svelte` component that maps tool names to colored Lucide icons. Tray PNGs are manually created from Lucide SVGs.

**Tech Stack:** Rust (Tauri backend), Svelte 5 with runes, lucide-svelte, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-informative-tray-session-icons-design.md`

---

## File Map

**Create:**
- `src/lib/components/ToolIcon.svelte` — Maps tool_name to Lucide icon + color
- `src/lib/components/SessionStatusIcon.svelte` — Maps session state to Lucide status icon + color
- `static/icons/tray-approval.png` — Orange shield-alert (32px)
- `static/icons/tray-input.png` — Blue message-square (32px)
- `static/icons/tray-running.png` — Green play (32px)
- `static/icons/tray-idle.png` — Gray circle (32px)

**Modify:**
- `src-tauri/src/tray.rs` — `TrayState` enum, new `compute_tray_state`, new icon constants
- `src/app.css` — Add `--orange`, `--purple`, `--cyan` CSS variables
- `src/lib/components/SessionCard.svelte` — Use `ToolIcon` and `SessionStatusIcon`
- `src/lib/components/Header.svelte` — Use `SessionStatusIcon`
- `src/lib/stores/sessions.svelte.ts` — Add `globalState` derived property

**Delete:**
- `static/icons/tray-green.png`
- `static/icons/tray-yellow.png`
- `static/icons/tray-gray.png`

---

### Task 1: Backend — TrayState enum and compute_tray_state

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Write failing tests for new TrayState enum**

Replace all existing `#[test]` functions in `tray.rs` with the ones below (the old tests use the `(usize, usize)` return type which no longer applies). Keep the existing helper functions (`idle_session`, `running_session_with_tool`, `running_session_with_subagents`, `running_session_processing`, `pending_only_session`). The new `compute_tray_state` returns a `TrayState` enum and a `TrayStateCounts` struct for tooltip building.

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum TrayState {
    WaitingForApproval,
    WaitingForInput,
    Running,
    Idle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrayStateCounts {
    pub approval: usize,
    pub input: usize,
    pub running: usize,
}

// Tests:

#[test]
fn tray_state_no_sessions() {
    let (state, counts) = compute_tray_state(&[]);
    assert_eq!(state, TrayState::Idle);
    assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 0 });
}

#[test]
fn tray_state_all_running() {
    let sessions = vec![running_session_with_tool(), running_session_with_subagents()];
    let (state, counts) = compute_tray_state(&sessions);
    assert_eq!(state, TrayState::Running);
    assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 2 });
}

#[test]
fn tray_state_all_waiting_for_input() {
    let sessions = vec![idle_session(), idle_session()];
    let (state, counts) = compute_tray_state(&sessions);
    assert_eq!(state, TrayState::WaitingForInput);
    assert_eq!(counts, TrayStateCounts { approval: 0, input: 2, running: 0 });
}

#[test]
fn tray_state_approval_wins_over_running() {
    let sessions = vec![running_session_with_tool(), pending_only_session()];
    let (state, counts) = compute_tray_state(&sessions);
    assert_eq!(state, TrayState::WaitingForApproval);
    assert_eq!(counts, TrayStateCounts { approval: 1, input: 0, running: 1 });
}

#[test]
fn tray_state_input_wins_over_running() {
    let sessions = vec![running_session_with_tool(), idle_session()];
    let (state, counts) = compute_tray_state(&sessions);
    assert_eq!(state, TrayState::WaitingForInput);
    assert_eq!(counts, TrayStateCounts { approval: 0, input: 1, running: 1 });
}

#[test]
fn tray_state_pending_with_tool_counts_as_approval() {
    let mut s = running_session_with_tool();
    s.pending_approval = true;
    let (state, counts) = compute_tray_state(&[s]);
    assert_eq!(state, TrayState::WaitingForApproval);
    assert_eq!(counts, TrayStateCounts { approval: 1, input: 0, running: 0 });
}

#[test]
fn tray_state_processing_counts_as_running() {
    let sessions = vec![running_session_processing()];
    let (state, counts) = compute_tray_state(&sessions);
    assert_eq!(state, TrayState::Running);
    assert_eq!(counts, TrayStateCounts { approval: 0, input: 0, running: 1 });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test tray`
Expected: FAIL — `TrayState` and `TrayStateCounts` don't exist yet, `compute_tray_state` has wrong signature.

- [ ] **Step 3: Implement TrayState enum and new compute_tray_state**

Add before `compute_tray_state`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum TrayState {
    WaitingForApproval,
    WaitingForInput,
    Running,
    Idle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrayStateCounts {
    pub approval: usize,
    pub input: usize,
    pub running: usize,
}
```

Replace `compute_tray_state`:

```rust
pub fn compute_tray_state(sessions: &[Session]) -> (TrayState, TrayStateCounts) {
    let mut counts = TrayStateCounts { approval: 0, input: 0, running: 0 };

    for s in sessions {
        if s.pending_approval {
            counts.approval += 1;
        } else if s.current_tool.is_none() && s.active_subagents == 0 && !s.processing {
            counts.input += 1;
        } else {
            counts.running += 1;
        }
    }

    let state = if sessions.is_empty() {
        TrayState::Idle
    } else if counts.approval > 0 {
        TrayState::WaitingForApproval
    } else if counts.input > 0 {
        TrayState::WaitingForInput
    } else {
        TrayState::Running
    };

    (state, counts)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test tray`
Expected: PASS

- [ ] **Step 5: Update update_tray to use new TrayState and build tooltip**

Update `update_tray` function:

```rust
pub fn update_tray(app: &AppHandle, sessions: &[Session]) {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(t) => t,
        None => return,
    };

    let (state, counts) = compute_tray_state(sessions);

    let icon_bytes = match state {
        TrayState::WaitingForApproval => ICON_APPROVAL,
        TrayState::WaitingForInput => ICON_INPUT,
        TrayState::Running => ICON_RUNNING,
        TrayState::Idle => ICON_IDLE,
    };

    let tooltip = if sessions.is_empty() {
        "Jackdaw — idle".to_string()
    } else {
        let mut parts = Vec::new();
        if counts.running > 0 {
            parts.push(format!("{} running", counts.running));
        }
        if counts.input > 0 {
            parts.push(format!("{} waiting for input", counts.input));
        }
        if counts.approval > 0 {
            parts.push(format!("{} waiting for approval", counts.approval));
        }
        format!("Jackdaw — {}", parts.join(", "))
    };

    if let Ok(icon) = Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
    }
    let _ = tray.set_tooltip(Some(&tooltip));
}
```

- [ ] **Step 6: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (compile may warn about unused old icon constants — that's fine, we'll replace them in Task 2)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/tray.rs
git commit -m "feat: TrayState enum with priority-based resolution"
```

---

### Task 2: Create tray icon PNGs and update constants

**Files:**
- Create: `static/icons/tray-approval.png`, `static/icons/tray-input.png`, `static/icons/tray-running.png`, `static/icons/tray-idle.png`
- Delete: `static/icons/tray-green.png`, `static/icons/tray-yellow.png`, `static/icons/tray-gray.png`
- Modify: `src-tauri/src/tray.rs` (icon constants)

- [ ] **Step 1: Generate tray icon PNGs**

Download Lucide SVGs and convert to colored 32x32 PNGs. Use `resvg` or ImageMagick to render. Colors:
- `shield-alert` → `#d29922` (orange/yellow) → `tray-approval.png`
- `message-square` → `#58a6ff` (blue) → `tray-input.png`
- `play` → `#3fb950` (green) → `tray-running.png`
- `circle` → `#6e7681` (gray) → `tray-idle.png`

Approach: Download SVGs from `https://unpkg.com/lucide-static/icons/`, modify stroke color, render to PNG at 32x32. Use `rsvg-convert` (from `librsvg`), which supports stdin.

```bash
# Install rsvg-convert if needed (e.g., sudo apt install librsvg2-bin / brew install librsvg)

curl -s https://unpkg.com/lucide-static/icons/play.svg | \
  sed 's/currentColor/#3fb950/g' | \
  rsvg-convert -w 32 -h 32 -o static/icons/tray-running.png

curl -s https://unpkg.com/lucide-static/icons/shield-alert.svg | \
  sed 's/currentColor/#d29922/g' | \
  rsvg-convert -w 32 -h 32 -o static/icons/tray-approval.png

curl -s https://unpkg.com/lucide-static/icons/message-square.svg | \
  sed 's/currentColor/#58a6ff/g' | \
  rsvg-convert -w 32 -h 32 -o static/icons/tray-input.png

curl -s https://unpkg.com/lucide-static/icons/circle.svg | \
  sed 's/currentColor/#6e7681/g' | \
  rsvg-convert -w 32 -h 32 -o static/icons/tray-idle.png
```

- [ ] **Step 2: Delete old icon files**

```bash
git rm static/icons/tray-green.png static/icons/tray-yellow.png static/icons/tray-gray.png
```

- [ ] **Step 3: Update include_bytes! constants in tray.rs**

Replace the three existing constants:

```rust
const ICON_APPROVAL: &[u8] = include_bytes!("../../static/icons/tray-approval.png");
const ICON_INPUT: &[u8] = include_bytes!("../../static/icons/tray-input.png");
const ICON_RUNNING: &[u8] = include_bytes!("../../static/icons/tray-running.png");
const ICON_IDLE: &[u8] = include_bytes!("../../static/icons/tray-idle.png");
```

Also update `create_tray` to use `ICON_IDLE` instead of `ICON_GRAY`:

```rust
let icon = Image::from_bytes(ICON_IDLE).expect("embedded idle icon");
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add static/icons/ src-tauri/src/tray.rs
git commit -m "feat: replace tray icons with state-specific Lucide PNGs"
```

---

### Task 3: Add CSS variables and lucide-svelte dependency

**Files:**
- Modify: `src/app.css`
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install lucide-svelte**

Run: `npm install lucide-svelte`

- [ ] **Step 2: Add new CSS color variables**

Add to `:root` in `src/app.css`, after the existing `--blue` line:

```css
--orange: #d29922;
--purple: #bc8cff;
--cyan: #39d2c0;
```

Note: `--orange` reuses the existing `--yellow` value since the spec's "orange" for approval maps to the same amber tone. `--yellow` is kept for backward compatibility.

- [ ] **Step 3: Verify type checking passes**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/app.css
git commit -m "feat: add lucide-svelte and new CSS color variables"
```

---

### Task 4: Create ToolIcon.svelte component

**Files:**
- Create: `src/lib/components/ToolIcon.svelte`

- [ ] **Step 1: Create ToolIcon.svelte**

```svelte
<script lang="ts">
  import {
    Terminal,
    FileText,
    Pencil,
    FilePlus,
    FolderSearch,
    Search,
    Bot,
    Wrench,
  } from 'lucide-svelte';

  interface Props {
    tool_name: string;
    size?: number;
  }

  let { tool_name, size = 12 }: Props = $props();

  const toolConfig: Record<string, { icon: typeof Terminal; colorClass: string }> = {
    Bash: { icon: Terminal, colorClass: 'tool-green' },
    Read: { icon: FileText, colorClass: 'tool-blue' },
    Edit: { icon: Pencil, colorClass: 'tool-orange' },
    Write: { icon: FilePlus, colorClass: 'tool-orange' },
    Glob: { icon: FolderSearch, colorClass: 'tool-purple' },
    Grep: { icon: Search, colorClass: 'tool-purple' },
    Agent: { icon: Bot, colorClass: 'tool-cyan' },
  };

  let config = $derived(toolConfig[tool_name] ?? { icon: Wrench, colorClass: 'tool-gray' });
</script>

<span class="tool-icon {config.colorClass}">
  <config.icon {size} strokeWidth={2} />
</span>

<style>
  .tool-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tool-green { color: var(--green); }
  .tool-blue { color: var(--blue); }
  .tool-orange { color: var(--orange); }
  .tool-purple { color: var(--purple); }
  .tool-cyan { color: var(--cyan); }
  .tool-gray { color: var(--text-muted); }
</style>
```

- [ ] **Step 2: Verify type checking passes**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ToolIcon.svelte
git commit -m "feat: add ToolIcon component with Lucide icons"
```

---

### Task 5: Create SessionStatusIcon.svelte component

**Files:**
- Create: `src/lib/components/SessionStatusIcon.svelte`

- [ ] **Step 1: Create SessionStatusIcon.svelte**

This component takes a `Session` and derives its per-session state, then renders the matching Lucide icon with color and optional pulse animation.

```svelte
<script lang="ts">
  import type { Session } from '$lib/types';
  import { ShieldAlert, MessageSquare, Play, Circle } from 'lucide-svelte';

  interface Props {
    session: Session;
    size?: number;
    historyMode?: boolean;
  }

  let { session, size = 14, historyMode = false }: Props = $props();

  type SessionState = 'approval' | 'input' | 'running' | 'ended';

  let sessionState = $derived<SessionState>(
    historyMode
      ? 'ended'
      : session.pending_approval
        ? 'approval'
        : (session.current_tool !== null || session.active_subagents > 0 || session.processing)
          ? 'running'
          : 'input'
  );

  const stateConfig: Record<SessionState, { icon: typeof Play; colorClass: string; pulse: boolean }> = {
    approval: { icon: ShieldAlert, colorClass: 'status-orange', pulse: true },
    input: { icon: MessageSquare, colorClass: 'status-blue', pulse: false },
    running: { icon: Play, colorClass: 'status-green', pulse: true },
    ended: { icon: Circle, colorClass: 'status-gray', pulse: false },
  };

  let config = $derived(stateConfig[sessionState]);
</script>

<span class="status-icon {config.colorClass}" class:pulse={config.pulse}>
  <config.icon {size} strokeWidth={2} />
</span>

<style>
  .status-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .status-green { color: var(--green); }
  .status-blue { color: var(--blue); }
  .status-orange { color: var(--orange); }
  .status-gray { color: var(--text-muted); }

  .pulse {
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
```

- [ ] **Step 2: Verify type checking passes**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/SessionStatusIcon.svelte
git commit -m "feat: add SessionStatusIcon component with per-session state"
```

---

### Task 6: Update SessionCard.svelte to use new icon components

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`

- [ ] **Step 1: Add imports**

Add at top of `<script>` block, after the existing imports:

```typescript
import ToolIcon from './ToolIcon.svelte';
import SessionStatusIcon from './SessionStatusIcon.svelte';
```

- [ ] **Step 2: Replace status dot with SessionStatusIcon**

Replace in the header row:

```svelte
<!-- Old -->
<span class="status-dot" class:running={isActive} class:pending={isPending}></span>

<!-- New -->
<SessionStatusIcon {session} size={14} {historyMode} />
```

- [ ] **Step 3: Guard idle-text for history mode**

The `idle-text` label shows when `!isActive && !isPending`, which is true for history-mode sessions. Add a `!historyMode` guard:

```svelte
<!-- Old -->
{#if !isActive && !isPending}
  <span class="idle-text">idle</span>
{/if}

<!-- New -->
{#if !isActive && !isPending && !historyMode}
  <span class="idle-text">idle</span>
{/if}
```

- [ ] **Step 4: Replace tool row icons with ToolIcon**

Replace the active tool display:

```svelte
<!-- Old -->
<span class="tool-icon">▶</span>

<!-- New -->
<ToolIcon tool_name={session.current_tool.tool_name} size={12} />
```

Replace the dimmed/completed tool display:

```svelte
<!-- Old -->
<span class="tool-icon">✓</span>

<!-- New -->
<ToolIcon tool_name={lastTool.tool_name} size={12} />
```

- [ ] **Step 5: Replace history checkmarks with ToolIcon**

Replace in the history section:

```svelte
<!-- Old -->
<span class="done-mark">✓</span>

<!-- New -->
<ToolIcon tool_name={tool.tool_name} size={11} />
```

- [ ] **Step 6: Remove unused CSS**

Remove these CSS rules from the `<style>` block:
- `.status-dot` (and its `.pending`, `.running` variants)
- `.tool-icon`
- `.tool-display.active .tool-icon`
- `.tool-display.dimmed .tool-icon`
- `.done-mark`
- The `@keyframes pulse` block (now lives in `SessionStatusIcon.svelte`)

- [ ] **Step 7: Remove unused color rules from .tool-display.active**

The `.tool-display.active .tool-icon, .tool-display.active .tool-name` rule set `color: var(--blue)`. The tool name color is now handled by `ToolIcon`, so update `.tool-display.active .tool-name` to keep the blue color on the name text only (remove the `.tool-icon` selector from that rule).

- [ ] **Step 8: Verify type checking passes**

Run: `npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/SessionCard.svelte
git commit -m "feat: replace SessionCard Unicode icons with Lucide components"
```

---

### Task 7: Update Header.svelte to use SessionStatusIcon

**Files:**
- Modify: `src/lib/components/Header.svelte`
- Modify: `src/lib/stores/sessions.svelte.ts`
- Modify: `src/lib/components/Dashboard.svelte`

The Header currently shows a simple green/yellow dot. It needs to show the global highest-priority state icon, matching the tray. This requires the Header to know about all sessions, not just counts.

- [ ] **Step 1: Add globalState getter to SessionStore**

Add to `SessionStore` class in `src/lib/stores/sessions.svelte.ts`:

```typescript
get globalState(): 'approval' | 'input' | 'running' | 'idle' {
    if (this.sessions.length === 0) return 'idle';
    for (const s of this.sessions) {
        if (s.pending_approval) return 'approval';
    }
    for (const s of this.sessions) {
        if (s.current_tool === null && s.active_subagents === 0 && !s.processing) return 'input';
    }
    return 'running';
}
```

- [ ] **Step 2: Update Dashboard to pass globalState to Header**

In `src/lib/components/Dashboard.svelte`, change the Header usage:

```svelte
<!-- Old -->
<Header sessionCount={sessionStore.count} runningCount={sessionStore.runningCount} />

<!-- New -->
<Header sessionCount={sessionStore.count} globalState={sessionStore.globalState} />
```

- [ ] **Step 3: Update Header.svelte**

Replace the status dot with a global state icon. Update the Props interface and imports:

```svelte
<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ShieldAlert, MessageSquare, Play, Circle } from 'lucide-svelte';

  interface Props {
    sessionCount: number;
    globalState: 'approval' | 'input' | 'running' | 'idle';
  }

  let { sessionCount, globalState }: Props = $props();

  const stateConfig = {
    approval: { icon: ShieldAlert, colorClass: 'status-orange' },
    input: { icon: MessageSquare, colorClass: 'status-blue' },
    running: { icon: Play, colorClass: 'status-green' },
    idle: { icon: Circle, colorClass: 'status-gray' },
  } as const;

  let config = $derived(stateConfig[globalState]);

  // ... minimize/close functions unchanged
</script>
```

Replace the status dot in the template:

```svelte
<!-- Old -->
<span class="status-dot" class:active={runningCount > 0}></span>

<!-- New -->
<span class="header-status-icon {config.colorClass}">
  <config.icon size={12} strokeWidth={2} />
</span>
```

Remove old `.status-dot` CSS, add new:

```css
.header-status-icon {
    display: inline-flex;
    align-items: center;
}

.status-green { color: var(--green); }
.status-blue { color: var(--blue); }
.status-orange { color: var(--orange); }
.status-gray { color: var(--text-muted); }
```

- [ ] **Step 4: Clean up unused runningCount from SessionStore**

Check if `runningCount` is used anywhere else. If only used by the old Header prop, remove it from `SessionStore`. If used elsewhere, keep it.

Run: `grep -r 'runningCount' src/`

- [ ] **Step 5: Verify type checking passes**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/sessions.svelte.ts src/lib/components/Header.svelte src/lib/components/Dashboard.svelte
git commit -m "feat: replace Header status dot with global state Lucide icon"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: All pass.

- [ ] **Step 2: Run frontend type checking**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Run frontend tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Visual smoke test**

Run: `npm run tauri dev`

Verify:
- Tray icon changes appropriately when sessions start/stop/need approval
- Tooltip shows correct counts with non-zero-only format
- SessionCard header shows per-session state icon with pulse on running/approval
- Tool row shows correct Lucide icon per tool type with correct color
- History items show tool-specific icons instead of checkmarks
- Header shows global state icon matching tray priority

- [ ] **Step 5: Commit any final fixes if needed**
