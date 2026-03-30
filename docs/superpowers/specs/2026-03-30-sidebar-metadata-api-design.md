# Sidebar Metadata API

External tools and scripts push custom metadata (status labels, progress bars, log lines) into Jackdaw via the existing bidirectional IPC API. Tools can enrich existing Claude Code sessions or register standalone sessions, making Jackdaw a general-purpose agent dashboard.

## API Actions

Three new actions on the existing bidirectional request/response protocol.

### `register_session`

Creates a standalone session visible in the dashboard.

```json
{
  "type": "action",
  "command": "register_session",
  "id": "req-1",
  "args": {
    "session_id": "my-build-123",
    "display_name": "CI Build #456"
  }
}
```

- `session_id` (required) — unique identifier for this session.
- `display_name` (required) — human-readable title shown on the card.
- If `session_id` already exists, updates the `display_name`.
- Creates a `Session` with `source: External`, empty `cwd`, no tools, not processing.

### `set_metadata`

Pushes metadata entries to any session (Claude Code or standalone).

```json
{
  "type": "action",
  "command": "set_metadata",
  "id": "req-2",
  "args": {
    "session_id": "my-build-123",
    "entries": [
      { "key": "status", "value": "compiling" },
      { "key": "coverage", "value": 87.5, "type": "progress" },
      { "key": "build_log", "value": "Running tests...", "type": "log" }
    ]
  }
}
```

- `session_id` (required) — target session. Returns error if session doesn't exist.
- `entries` (required) — array of metadata entries to set.

### `end_session`

Removes a session from in-memory state.

```json
{
  "type": "action",
  "command": "end_session",
  "id": "req-3",
  "args": {
    "session_id": "my-build-123"
  }
}
```

Works on both standalone and Claude Code sessions.

## Metadata Entry Model

Each entry has a `key`, `value`, and optional `type`.

| Type | `value` | Behavior | Rendering |
|------|---------|----------|-----------|
| `text` (default) | string | Last value wins | Key-value row: uppercase key left, value right |
| `progress` | number 0–100 | Last value wins | Key + percentage row with thin bar below |
| `log` | string | Appends to buffer, capped at 50 lines | Collapsed by default showing line count, expands to scrollable monospace block |

Setting `value: null` on any type removes that key.

## Backend Changes

### `Session` struct

Two new fields:

```rust
pub display_name: Option<String>,
pub metadata: IndexMap<String, MetadataEntry>,
```

`IndexMap` (from the `indexmap` crate) preserves insertion order so keys render in the order first set.

### `MetadataEntry` / `MetadataValue`

```rust
pub struct MetadataEntry {
    pub key: String,
    pub value: MetadataValue,
}

pub enum MetadataValue {
    Text(String),
    Progress(f64),
    Log(Vec<String>),
}
```

### Serialization

`MetadataValue` serializes as a tagged enum so the frontend can switch on type:

```json
{ "key": "status", "value": { "type": "text", "content": "compiling" } }
{ "key": "coverage", "value": { "type": "progress", "content": 87.5 } }
{ "key": "build_log", "value": { "type": "log", "content": ["line 1", "line 2"] } }
```

### State updates

- `set_metadata` acquires the sessions mutex, updates the `metadata` map, drops the lock, then emits `session-update`.
- `register_session` creates a new `Session` with `display_name` set and empty metadata.
- `end_session` removes the session from the map (same path as `dismiss_session`).

### No persistence

Metadata is in-memory only. Not written to the DB. Transient status info resets on restart.

## Frontend Changes

### TypeScript types

```typescript
interface MetadataEntry {
  key: string;
  value: MetadataValue;
}

type MetadataValue =
  | { type: 'text'; content: string }
  | { type: 'progress'; content: number }
  | { type: 'log'; content: string[] };
```

`Session` gets two new fields:

```typescript
display_name: string | null;
metadata: MetadataEntry[];
```

### SessionCard rendering

Metadata renders below the tool row (Claude Code sessions) or below the header (standalone sessions with no tools).

- **Text**: key-value row — uppercase key left, value right.
- **Progress**: key + percentage on top row, thin bar below. Bar color inherits the card's accent color.
- **Log**: collapsed by default showing line count. Click to expand into a scrollable monospace block. Max 50 lines.

Entries render in insertion order (preserved by `IndexMap`).

### Card title

Display logic: `display_name ?? last segment of cwd ?? session_id`.

## Standalone Session Lifecycle

1. Tool calls `register_session` with ID + display name → session appears in dashboard.
2. Tool calls `set_metadata` to push status updates → card updates in real time.
3. Tool calls `end_session` → session removed. Or user dismisses from UI.

Standalone sessions use `source: External` and show no tool row unless metadata is present. They do not have `git_branch`, `current_tool`, or `tool_history`.
