# Session History Design

Persist terminal scrollback to disk so that restarting Jackdaw restores output for live sessions.

## Scope

- **In scope:** Scrollback persistence for sessions with a live relay process. Configurable max history size. Cleanup on session kill and stale manifest recovery.
- **Out of scope:** History for dead sessions, long-term archival, crash forensics, compression.

## Storage

- **Path:** `~/.jackdaw/history/{session-id}.log`
- **Format:** Raw PTY output (includes ANSI escape sequences). No framing or metadata — just the byte stream as read from the PTY.
- **Size management:** The relay tracks cumulative bytes written. When the file exceeds 2x the configured max, the relay reads the last `max` bytes, truncates the file, and rewrites. This amortizes truncation cost.
- **Default max:** 1MB (matches the current in-memory ring buffer default).

## Relay Changes

### New CLI flags

- `-history <path>` — History file path. If empty, history is disabled (backward compatible).
- `-history-max <bytes>` — Maximum history file size. Default 1MB.

### `Server` struct additions

- `historyFile *os.File` — Open file handle for appending.
- `historyWriter *bufio.Writer` — Buffered writer wrapping the file.
- `historyBytes int64` — Running byte count (initialized from file size on open).
- `historyMax int64` — Configured max size.
- `historyPath string` — File path (needed for truncation rewrite).

### `readPTY()` changes

After `s.buffer.Write(data)` and broadcasting to clients, append the chunk to the history writer. Flush the writer on a tick (100ms) or when accumulated unflushed bytes exceed 32KB.

### Truncation

When `historyBytes` exceeds `2 * historyMax`:
1. Flush the buffered writer.
2. Read the last `historyMax` bytes from the file.
3. Truncate and rewrite the file with those bytes.
4. Reset `historyBytes` to `historyMax`.
5. Recreate the buffered writer.

### Replay changes

`handleClient()` currently replays from the in-memory ring buffer. Change this to replay from the history file instead:
1. Read the tail of the history file (up to the ring buffer size).
2. Send as `FrameData`, then `FrameReplayEnd`.
3. Continue with live streaming as before.

The ring buffer remains in use for broadcasting live output to connected clients — it is not removed.

### Shutdown

`Server.Close()` flushes and closes the history file. No history file deletion here — the relay doesn't own lifecycle decisions.

## Session Changes

### `session.New()`

Pass `-history` and `-history-max` flags when spawning the relay subprocess. The history path is `{historyDir}/{id}.log`.

### `session.Reconnect()`

No changes. The relay already has the history file open from when it was originally spawned.

## Manager Changes

### `NewManager(manifestDir, socketDir, historyDir string)`

Add `historyDir` parameter. Create the directory on startup if it doesn't exist.

### `Manager.Create()`

Construct history path as `{historyDir}/{id}.log` and pass it through to `session.New()`.

### `Manager.Kill()`

Delete the history file alongside the manifest.

### `Manager.Recover()`

Delete history files for stale sessions (dead PIDs) alongside manifest cleanup.

## Manifest Changes

Add `HistoryPath string` field to the `Manifest` struct:

```go
type Manifest struct {
    // ... existing fields ...
    HistoryPath string `json:"history_path,omitempty"`
}
```

Written at session creation time. Used during recovery to identify the history file for cleanup.

## Config Changes

Add `HistoryMaxBytes` to the `Config` struct:

```go
type Config struct {
    Theme          string            `json:"theme"`
    Keybindings    map[string]string `json:"keybindings"`
    Layout         json.RawMessage   `json:"layout,omitempty"`
    HistoryMaxBytes int              `json:"history_max_bytes,omitempty"`
}
```

Default: `1048576` (1MB). Passed to the relay via `-history-max` flag.

## Frontend Changes

None. The relay's replay mechanism is transparent to the frontend — `Terminal.svelte` already handles `FrameData` frames identically regardless of source.

## Data Flow

```
PTY
 ↓ (raw bytes, ~4KB chunks)
relay readPTY()
 ├─→ RingBuffer.Write()        (in-memory, for live broadcast)
 ├─→ historyWriter.Write()     (buffered append to ~/.jackdaw/history/{id}.log)
 └─→ broadcast to clients      (live FrameData frames)

On client connect:
 history file tail → FrameData → FrameReplayEnd → live stream
```

## Cleanup Rules

| Event | History file action |
|-------|-------------------|
| Session killed by user | Deleted by `Manager.Kill()` |
| Stale session on recovery (dead PID) | Deleted by `Manager.Recover()` |
| Relay shutdown (app exit, process ends) | Flushed and closed, NOT deleted |
| File exceeds 2x max | Truncated to max (oldest bytes removed) |
