# Jackdaw

A desktop tray app that monitors your [Claude Code](https://claude.ai/code) sessions in real-time.

Jackdaw sits in your system tray, receives hook events from Claude Code, and displays a live dashboard showing what each session is doing — which tools are running, recent activity, and session status.

## Features

- **Live session monitoring** — See all active Claude Code sessions at a glance
- **Tool activity tracking** — Current tool, recent history, and extracted context (commands, file paths, patterns)
- **System tray integration** — Status-aware icon (green/yellow/gray), tooltip summary, click-to-toggle dashboard
- **One-click hook installation** — Automatically configure Claude Code to send events to Jackdaw
- **Start hidden** — Launches into the tray, close button hides the window instead of quitting

## Screenshot

<!-- TODO: add screenshot -->

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
git clone git@github.com:andybarilla/jackdaw.git
cd jackdaw
npm install
npm run tauri dev
```

### Connect Claude Code

Jackdaw needs Claude Code to send hook events to `http://localhost:9876/events`. You can set this up automatically:

1. Open Jackdaw (it starts in the tray)
2. Click the tray icon to show the dashboard
3. Click **Install Hooks** (installs to `~/.claude/settings.json`)

Or via the tray menu: **Right-click tray icon → Install Claude Hooks → User-level (global)**

Once installed, any new Claude Code session will appear in the dashboard automatically.

### Manual Hook Setup

If you prefer to configure hooks manually, add this to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "http", "url": "http://localhost:9876/events", "timeout": 5 }] }
    ]
  }
}
```

The hooks use a 5-second timeout and are non-blocking — if Jackdaw isn't running, Claude Code continues normally.

## Tech Stack

- **Frontend:** Svelte 5 (runes), SvelteKit, TypeScript
- **Backend:** Rust, Tauri v2, Axum (HTTP server), Tokio
- **Desktop:** System tray with dynamic icons, window management

## Architecture

```
Claude Code Hook Events
    → POST http://localhost:9876/events
    → Axum HTTP Server (server.rs)
    → AppState updated (state.rs)
    → Tauri event emitted + tray icon updated
    → Svelte frontend re-renders
```

Sessions are stored in-memory only — they reset when Jackdaw restarts.

## Building

```bash
npm run tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

## License

MIT
