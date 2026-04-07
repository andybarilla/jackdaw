# Jackdaw Roadmap

## Completed

- **Session re-attachment** — Relay subprocess per session holds the PTY and listens on a Unix socket; app reconnects on restart with scrollback replay
- **Theming & keybindings** — Dark/light themes, customizable keyboard shortcuts, config persistence
- **Session naming** — Inline rename in sidebar, persisted in manifests
- **Terminal search** — xterm.js SearchAddon with Ctrl+F keybinding

## Up Next

### Multi-session Layout
Split panes or tiling so multiple terminals are visible simultaneously. Tab bar for quick switching as session count grows.

### Session History
Persist terminal scrollback to disk so restarting the app doesn't lose output. Useful both standalone and as a building block for session re-attachment.

### Notifications
Surface alerts when a background session needs attention — process exit, error output patterns, or user-defined triggers.

## Workflow

1. Pick the next item (or propose a new one).
2. Write a plan in `docs/plans/` before starting implementation.
3. Implement on a feature branch, open a PR.
4. Update this file when work is completed.
