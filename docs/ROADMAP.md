# Jackdaw Roadmap

## Completed

- **Session re-attachment** — Relay subprocess per session holds the PTY and listens on a Unix socket; app reconnects on restart with scrollback replay
- **Theming & keybindings** — Dark/light themes, customizable keyboard shortcuts, config persistence
- **Session naming** — Inline rename in sidebar, persisted in manifests
- **Terminal search** — xterm.js SearchAddon with Ctrl+F keybinding
- **Multi-session layout** — Split panes with drag-to-resize, tab bar for quick switching, flexible tiling
- **Session history** — Persist terminal scrollback to disk with configurable size limits; relay replays from history file on reconnect

- **Notifications** — Surface alerts when a background session needs attention — process exit, agent waiting for input (permission prompts, questions)
- **Notification actions** — Quick-approve permission prompts and other actionable responses directly from toast notifications
- **Error detection** — Pattern-match terminal output to detect errors, failures, or anomalies in background sessions
- **Git worktree isolation per session** — Each session gets its own worktree so parallel agents don't clobber each other
- **Built-in diff viewer** — Show file changes per session without leaving the app
- **Merge/integration workflow** — Review diffs then merge agent work back to main from within the app
- **Agent status dashboard** — High-level view of what each agent is doing beyond raw terminal output
- **Embedded browser pane** — Preview localhost alongside terminals for web dev workflows
- **Lifecycle hooks** — Auto-run commands on session create/destroy (install deps, docker-compose, etc.)
- **CLI/socket API** — External tools can create sessions, send input, and query status programmatically
- **Command palette** — Searchable palette for all actions and user-defined commands

## Up Next
- **Port detection per session** — Detect and display listening ports per session in sidebar
- **IDE integration** — One-click open session's working directory in VS Code/Cursor/Zed
- **Create session from PR/branch URL** — Paste a PR URL, auto-setup worktree and session
- **Workspace templates** — Declarative config file defining sessions, directories, layout, and startup commands
- **MCP server** — Expose session management to AI agents via MCP protocol

## Known Issues / Follow-ups

- **Duplicate WebSocket connections per session** — Trace logs showed two `flush-enter`s per output frame for some long-lived sessions, indicating stale WS connections weren't being cleaned up when a client reconnected. Reproduce by letting a session run through several reload/HMR cycles, then grep `TRACE ... flush-enter` per session ID. Fix likely lives in `Terminal.svelte`'s effect cleanup or `wsserver.handleWS`'s disconnect path.
- **Relay server buffer/fanout race** — In `internal/relay/server.go` `readPTY`, the ring-buffer write and the client-fanout loop are not atomic with `handleClient`'s snapshot+register. A client connecting at the exact moment a frame arrives can either duplicate or miss that frame. Fix: write to `s.buffer` and snapshot `s.clients` under a single `s.mu` critical section, and have `handleClient` take the same lock around `buffer.Bytes()` + `clients[conn] = …`. Low impact (small window, unlikely to cause visible corruption) but worth closing.

## Workflow

1. Pick the next item (or propose a new one).
2. Write a plan in `docs/plans/` before starting implementation.
3. Implement on a feature branch, open a PR.
4. Update this file when work is completed.
