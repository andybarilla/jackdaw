# Jackdaw Roadmap

Inspired by [cmux](https://cmux.com/docs/getting-started) feature analysis and Jackdaw's identity as a lightweight agent monitoring tray app.

## High Priority

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

- **Configurable Sound/Visual Alerts** — per-event-type sounds, screen flash, icon animation with urgency tiers
- **HTTP API** — optional HTTP endpoint for remote session monitoring
- **Multi-Agent Orchestration View** — tree/graph visualization of parent→subagent relationships
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
- **Session History Browser**
- **Progress Indicators**
- **Custom Commands / Quick Actions**
