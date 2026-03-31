# Jackdaw Roadmap

Inspired by [cmux](https://cmux.com/docs/getting-started) feature analysis and Jackdaw's identity as a lightweight agent monitoring tray app.

## High Priority

### Session History Browser
Expose the existing `db.rs` history in the UI — a "Recent Sessions" view with search/filter by project, date, and branch. Positions Jackdaw as an audit/review tool.

**Spec**: None yet (builds on `docs/superpowers/specs/2026-03-21-session-persistence-design.md`)

## Medium Priority

### Progress Indicators
Visual progress bars on SessionCard. Accept explicit progress events via socket, or estimate from tool count against a known plan length.

**Spec**: None yet

### Custom Commands / Quick Actions
Per-project actions defined in a config file (e.g., "run tests", "restart agent", "open in terminal") that appear as buttons on session cards or in a context menu.

**Spec**: None yet

### Multi-Agent Orchestration View
Tree/graph visualization of parent→subagent relationships with status propagation. Leverages existing `spawned_session` and `active_subagents` tracking. Unique differentiator — no other tool visualizes agent spawn trees.

**Spec**: None yet

### HTTP API
Optional HTTP endpoint alongside the Unix socket for remote monitoring — check agent status from a phone, or aggregate multiple developers' Jackdaw instances into a team dashboard.

**Spec**: None yet

### Configurable Sound/Visual Alerts
Per-event-type sounds, screen flash, menubar icon animation for different urgency levels. Goes beyond the current boolean notification prefs.

**Spec**: None yet

## Lower Priority

### Cross-Tool Agent Support
Document a stable wire protocol and build adapters for other agents (Codex, Aider, Gemini CLI, OpenCode). The IPC protocol is already generic enough — this is mostly documentation and community outreach.

**Spec**: None yet

### Embedded Browser Preview
Lightweight version of cmux's browser panes: clickable links in tool output open a small preview pane via Tauri's webview. Useful for reviewing agent-generated web content without leaving Jackdaw.

**Spec**: None yet

### Monitoring Profiles
Predefined configurations for which projects to watch, notification settings per project, and dashboard layout preferences. Equivalent to cmux's workspace layout templates.

**Spec**: None yet

## Completed

- **Git Branch Metadata** — tracks branch per session
- **Accent Bar + State Labels + Unread Tracking**
- **Session Persistence**
- **Desktop Notifications**
- **Embedded Terminals**
- **Auto-Update**
- **Tray Session Icons**
- **Sidebar Metadata API**
- **Notification Commands**
- **Project Grouping**
- **Notification Panel & History**
- **Bidirectional Socket API**
- **Quick Terminal Launch**
