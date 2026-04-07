# Jackdaw

Desktop app that orchestrates Claude Code sessions. Spawns, manages, and displays Claude Code sessions via embedded xterm.js terminals.

## Stack

- **Backend:** Go + Wails v2
- **Frontend:** Svelte 5 (runes) + xterm.js v5
- **PTY:** `github.com/creack/pty`

## Commands

```bash
# Dev mode (opens window with hot reload)
GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41

# Build production binary
GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41

# Go tests
go test ./internal/...

# Frontend type check
cd frontend && npm run check

# Frontend build
cd frontend && npm run build

# Regenerate Wails JS bindings (after changing bound Go methods)
wails generate module
```

## Architecture

```
main.go              → Wails entry point, embeds frontend/dist
app.go               → App struct, Wails method bindings (CreateSession, ListSessions, KillSession), event bridge
internal/
  session/
    session.go       → PTY session: spawn process, read/write/resize, close
    manager.go       → SessionManager: CRUD, manifest integration, update callbacks
  manifest/
    manifest.go      → JSON manifest files for process survival (~/.jackdaw/manifests/)
frontend/src/
  App.svelte         → Root layout: sidebar + terminal area
  lib/
    Terminal.svelte   → xterm.js wrapper, Wails event binding for I/O
    Sidebar.svelte    → Session list with status indicators
    NewSessionDialog.svelte → Directory input + launch
```

## Go ↔ Frontend Communication

- **Method bindings:** `CreateSession(workDir)`, `ListSessions()`, `KillSession(id)` — auto-generated TS wrappers in `frontend/wailsjs/go/main/App.js`
- **Events (Go → Frontend):** `terminal-output-{id}`, `sessions-updated`
- **Events (Frontend → Go):** `terminal-input`, `terminal-resize`

## Process Survival

Sessions write manifests to `~/.jackdaw/manifests/`. On app restart, `Manager.Recover()` scans manifests, re-adopts sessions with alive PIDs, and cleans up stale ones. Recovered sessions appear in the sidebar but have no terminal I/O (can't re-attach to existing PTY).
