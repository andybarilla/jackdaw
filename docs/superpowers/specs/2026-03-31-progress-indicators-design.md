# Progress Indicators

Visual progress bars on SessionCard that show how far along a session is. Two modes: explicit progress set via the socket API (already supported by `set_metadata` with `MetadataValue::Progress`), and estimated progress derived from tool velocity and session patterns.

## What Already Exists

The `set_metadata` socket command already accepts `progress`-type entries, and `MetadataDisplay.svelte` renders them as thin progress bars inside the metadata section. This works but has limitations:

1. Progress bars only appear in the expandable metadata section, not prominently on the card
2. No estimation — if a client doesn't explicitly set progress, there's no indicator at all
3. No visual distinction between "10% done" and "90% done" on the card at a glance

## Approach

### 1. Primary progress bar on SessionCard

Add a thin progress bar directly below the card header (above metadata), visible without expanding. This bar reflects a single "primary progress" value derived from:

- **Explicit**: If any metadata entry has key `"progress"` with type `progress`, use its value directly. This is the authoritative source — clients that set it know best.
- **Estimated**: If no explicit progress exists and the session is active (`processing` or `current_tool` is set), show an indeterminate/pulse animation. No fake percentage.

The explicit path means tools like Claude Code skills, CI pipelines, or custom scripts can set meaningful progress via:

```json
{"command": "set_metadata", "session_id": "abc", "entries": [{"key": "progress", "value": 75.0, "type": "progress"}]}
```

### 2. Tool velocity indicator

Replace the indeterminate animation with something more useful: a tool count + rate display in the card header area.

Add a small "tools/min" metric next to the uptime display when a session is active. Calculated from the last 5 minutes of `tool_history` timestamps. This gives a sense of activity level without pretending to know completion percentage.

Format: `12 tools · 4/min` — total tool count and recent rate.

### 3. Completion flash

When a session transitions from `processing=true` to `processing=false` (the `Stop` event), briefly flash the card's accent bar green to signal "done". If explicit progress was at 100% at that point, show a checkmark icon briefly.

## Backend Changes

### state.rs

Add a computed method to `Session`:

```rust
impl Session {
    /// Returns the explicit progress percentage if a "progress" metadata entry exists.
    pub fn explicit_progress(&self) -> Option<f64> {
        self.metadata.get("progress").and_then(|entry| {
            if let MetadataValue::Progress(v) = &entry.value {
                Some(*v)
            } else {
                None
            }
        })
    }

    /// Returns (total_tools, tools_per_minute) based on recent tool history.
    pub fn tool_velocity(&self) -> (usize, f64) {
        let total = self.tool_history.len() + if self.current_tool.is_some() { 1 } else { 0 };
        let now = Utc::now();
        let window = chrono::Duration::minutes(5);
        let cutoff = now - window;
        let recent_count = self.tool_history.iter()
            .filter(|t| t.timestamp > cutoff)
            .count();
        let minutes_elapsed = if self.started_at > cutoff {
            (now - self.started_at).num_seconds() as f64 / 60.0
        } else {
            5.0
        };
        let rate = if minutes_elapsed > 0.0 {
            recent_count as f64 / minutes_elapsed
        } else {
            0.0
        };
        (total, rate)
    }
}
```

### Serialization

Add `tool_velocity` and `explicit_progress` to the serialized `Session` output so the frontend doesn't need to recompute:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    // ... existing fields ...
    // Computed, included in serialization:
}
```

Use `#[serde(flatten)]` with a helper struct, or compute in a custom `Serialize` impl. Simplest approach: add two methods and call them during event emission, packaging the results into the emitted JSON in `server.rs` where sessions are serialized.

Alternative (simpler): compute these on the frontend from the existing `tool_history` array. This avoids changing the Rust serialization at all.

**Recommendation**: Compute on the frontend. The `tool_history` (max 50 items with timestamps) is already sent. Adding derived fields to the Rust struct complicates serialization for no real benefit.

## Frontend Changes

### types.ts

No changes needed — `tool_history` with timestamps is already available.

### SessionCard.svelte

Add two new derived values:

```typescript
let explicitProgress = $derived(
  session.metadata['progress']?.value.type === 'progress'
    ? session.metadata['progress'].value.content
    : null
);

let toolVelocity = $derived(() => {
  const total = session.tool_history.length + (session.current_tool ? 1 : 0);
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const recent = session.tool_history.filter(
    t => new Date(t.timestamp).getTime() > fiveMinAgo
  ).length;
  const startTime = new Date(session.started_at).getTime();
  const windowMinutes = startTime > fiveMinAgo
    ? (now - startTime) / 60000
    : 5;
  const rate = windowMinutes > 0 ? recent / windowMinutes : 0;
  return { total, rate: Math.round(rate * 10) / 10 };
});
```

Add to the card template, between the header and the metadata section:

```svelte
<!-- Progress bar: only when explicit progress is set -->
{#if explicitProgress !== null}
  <div class="card-progress">
    <div
      class="card-progress-fill"
      style="width: {Math.min(100, Math.max(0, explicitProgress))}%"
    ></div>
  </div>
{/if}
```

Add tool velocity to the header stats area (near uptime):

```svelte
{#if isActive && toolVelocity.total > 0}
  <span class="tool-velocity">
    {toolVelocity.total} tools · {toolVelocity.rate}/min
  </span>
{/if}
```

### Styles

```css
.card-progress {
  height: 2px;
  background: var(--border);
  width: 100%;
}

.card-progress-fill {
  height: 100%;
  background: var(--active);
  transition: width 0.5s ease;
}

.tool-velocity {
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

### Completion flash

On the `Stop` event (detected by `processing` transitioning from true to false), add a brief CSS class to the card:

```typescript
let wasProcessing = $state(session.processing);
let showCompletion = $state(false);

$effect(() => {
  if (wasProcessing && !session.processing) {
    showCompletion = true;
    setTimeout(() => showCompletion = false, 2000);
  }
  wasProcessing = session.processing;
});
```

```css
.session-card.completion-flash {
  animation: flash-complete 2s ease-out;
}

@keyframes flash-complete {
  0% { border-color: var(--success); }
  100% { border-color: var(--border); }
}
```

## Testing

### Rust unit tests

- `explicit_progress()` returns `None` when no progress metadata exists.
- `explicit_progress()` returns `Some(75.0)` when progress metadata is set.
- `tool_velocity()` returns correct total and rate based on tool_history timestamps.
- `tool_velocity()` handles empty history (returns 0, 0.0).

### Frontend tests (Vitest)

- SessionCard renders progress bar when session has explicit `progress` metadata.
- SessionCard does not render progress bar when no progress metadata exists.
- Tool velocity displays correct count and rate.
- Tool velocity hidden when session is not active.
- Completion flash class applied when session transitions from processing to stopped.
