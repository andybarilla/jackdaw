# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jackdaw is a Tauri v2 + Svelte 5 desktop tray app that monitors Claude Code sessions in real-time. Claude Code sends hook events via a `command`-type hook that invokes `jackdaw-send`, which forwards JSON payloads over a Unix domain socket (or Windows named pipe) to the Jackdaw daemon. The daemon updates in-memory session state and pushes changes to the Svelte frontend via Tauri events.

## Commands

```bash
npm run tauri dev       # Full dev mode (Rust + Vite hot-reload on :1420)
npm run tauri build     # Production build (output: src-tauri/target/release/bundle/)
npm run check           # Svelte/TypeScript type checking
npm run check:watch     # Type checking in watch mode
npm test                # Run frontend tests (Vitest)
cd src-tauri && cargo test  # Run backend tests
```

## Development Practices

- **IMPORTANT**: all work should be done as TDD — write tests before implementation code.
- **Backend tests**: use Rust's built-in `#[cfg(test)]` modules and `cargo test`. Run with `cd src-tauri && cargo test`.
- **Frontend tests**: use Vitest. Run with `npm test`.
- **Be concise**: documentation, comments, PR descriptions, commit messages, and names should contain useful information and nothing more.
- **Deduplicate**: remove redundant code, tests, and explanations.

## Git Workflow

- **Merging to main**: squash merge for single-commit PRs; regular merge for multi-commit PRs

## Pre-Commit Verification

- **Backend changes**: run `cd src-tauri && cargo test` and `npm run check`
- **Frontend changes**: run `npm run check` and `npm test` (once configured)

## Architecture

```
Claude Code hooks (command type) → runs `jackdaw-send`
  → jackdaw-send reads stdin, connects to IPC socket, writes JSON + newline
  → Daemon reads from socket, updates AppState (state.rs, Arc<Mutex<HashMap>>)
  → Tauri "session-update" event emitted → Svelte frontend re-renders
  → Tray icon updated (tray.rs: green=running, yellow=waiting, gray=idle)
```

### Backend (src-tauri/src/)

- **lib.rs** — Tauri setup, spawns IPC listener, defines 4 commands: `dismiss_session`, `check_hooks_status`, `install_hooks`, `uninstall_hooks`. Window close hides instead of quitting.
- **server.rs** — IPC socket listener (Unix domain socket on Linux/macOS, named pipe on Windows). Accepts connections, reads NDJSON lines, handles 9 hook event types (SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd, UserPromptSubmit, Notification, SubagentStart, SubagentStop).
- **ipc.rs** — Platform-specific IPC socket path resolution. Unix: `~/.jackdaw/jackdaw.sock`. Windows: `\\.\pipe\jackdaw`. Handles socket dir creation and stale socket cleanup.
- **state.rs** — `AppState`, `Session`, `ToolEvent`, `HookPayload` structs. `extract_summary()` pulls human-readable context from tool_input by tool type (Bash→command, Read/Write/Edit→file_path, Glob/Grep→pattern, Agent→description). Tool history capped at 50.
- **tray.rs** — System tray with compile-time embedded icons. Menu handles hook install/uninstall directly.
- **hooks.rs** — Reads/writes Claude Code `settings.json` (user-level `~/.claude/` or project-level `.claude/`). Installs `command`-type hooks pointing to `jackdaw-send`. Detects both new command-type and old HTTP-type hooks. Atomic writes via temp file + rename.
- **bin/jackdaw-send.rs** — Thin CLI binary: reads JSON from stdin, connects to IPC socket, writes payload + newline. Used as Claude Code `command` hook and callable by other tools.

### Frontend (src/)

- **Svelte 5 with runes** (`$state`, `$derived`, `$props()`). No Svelte 4 stores.
- **stores/sessions.svelte.ts** — `SessionStore` class listens to Tauri "session-update" events, exposes reactive `sessions`, `count`, `runningCount`.
- **components/** — `Dashboard.svelte` (main layout, session list or HookSetup), `SessionCard.svelte` (status badge, current tool, history), `Header.svelte` (counts), `HookSetup.svelte` (hook install UI with scope toggle).
- **types.ts** — TypeScript interfaces matching Rust structs.
- **app.css** — Dark theme via CSS custom properties.

### Key patterns

- **Thread safety**: Lock mutex → update state → drop lock → emit event.
- **In-memory only**: No persistence. Sessions reset on restart.
- **SPA mode**: SSR disabled (`+layout.ts`), static adapter builds to `build/`.
- **IPC socket at `~/.jackdaw/jackdaw.sock`** (Unix) or `\\.\pipe\jackdaw` (Windows). Stale socket removed on startup.
- **Tray icons are embedded at compile time** — rebuild required after icon changes.

## Frontend-Backend Communication

**Commands** (frontend → backend via `invoke()`): `dismiss_session`, `check_hooks_status`, `install_hooks`, `uninstall_hooks`.

**Events** (backend → frontend via `listen()`): `"session-update"` emits full `Session[]` sorted by `started_at` descending.

**IPC** (Claude Code → backend): `command`-type hooks run `jackdaw-send`, which reads `HookPayload` JSON from stdin and sends it over the IPC socket. Payload contains `session_id`, `cwd`, `hook_event_name`, and optional `tool_name`/`tool_input`/`tool_use_id`/`agent_id`. Other tools can also pipe JSON to `jackdaw-send` or connect to the socket directly.
