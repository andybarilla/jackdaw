# Jackdaw Roadmap

Inspired by [cmux](https://cmux.com/docs/getting-started) feature analysis and Jackdaw's identity as a lightweight agent monitoring tray app.

## High Priority

### Markdown File Preview
Clickable file paths in tool output (Read, Write, Edit) that point to `.md` files open a rendered markdown preview modal. Builds on the Embedded Browser Preview infrastructure — reuses the modal chrome but renders markdown locally instead of loading a URL in a webview.

**Spec**: None yet

### Monitoring Profiles
Predefined configurations for which projects to watch, notification settings per project, and dashboard layout preferences. Equivalent to cmux's workspace layout templates.

**Spec**: None yet

## Completed

- **Embedded Browser Preview** — clickable URLs in tool output open a native webview preview modal with navigation
- **Cross-Tool Agent Support** — stable wire protocol and adapters for other agents (Codex, Aider, Gemini CLI, OpenCode)
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
