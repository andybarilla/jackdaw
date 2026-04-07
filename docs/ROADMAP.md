# Jackdaw Roadmap

## Completed

- **Theming & keybindings** — Dark/light themes, customizable keyboard shortcuts, config persistence

## Up Next

### Session Re-attachment
Recovered sessions currently show in the sidebar but have no terminal I/O. Explore re-attaching to existing PTYs (or replaying saved output) so sessions fully survive an app restart.

### Session Naming
Let users rename sessions in the sidebar. Currently sessions display the directory basename, which is ambiguous when multiple sessions share the same working directory.

### Terminal Search
Integrate xterm.js `SearchAddon` for find-in-terminal (Ctrl+Shift+F or configurable keybinding).

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
