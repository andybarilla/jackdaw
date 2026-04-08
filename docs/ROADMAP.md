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

## Up Next

- **Built-in diff viewer** — Show file changes per session without leaving the app
- **Merge/integration workflow** — Review diffs then merge agent work back to main from within the app
- **Agent status dashboard** — High-level view of what each agent is doing beyond raw terminal output
- **Embedded browser pane** — Preview localhost alongside terminals for web dev workflows
- **Workspace templates** — Declarative config file defining sessions, directories, layout, and startup commands
- **Lifecycle hooks** — Auto-run commands on session create/destroy (install deps, docker-compose, etc.)
- **CLI/socket API** — External tools can create sessions, send input, and query status programmatically
- **Port detection per session** — Detect and display listening ports per session in sidebar
- **IDE integration** — One-click open session's working directory in VS Code/Cursor/Zed
- **MCP server** — Expose session management to AI agents via MCP protocol
- **Command palette** — Searchable palette for all actions and user-defined commands
- **Create session from PR/branch URL** — Paste a PR URL, auto-setup worktree and session

## Workflow

1. Pick the next item (or propose a new one).
2. Write a plan in `docs/plans/` before starting implementation.
3. Implement on a feature branch, open a PR.
4. Update this file when work is completed.
