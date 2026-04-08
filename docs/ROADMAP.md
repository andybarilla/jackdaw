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

## Up Next

## Workflow

1. Pick the next item (or propose a new one).
2. Write a plan in `docs/plans/` before starting implementation.
3. Implement on a feature branch, open a PR.
4. Update this file when work is completed.
