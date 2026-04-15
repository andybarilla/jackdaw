# jackdaw-revisited

A pi-native prototype scaffold for a session-first multi-agent workbench.

## Goal

Validate whether a `pi`-based orchestration UI feels better than Jackdaw's current PTY/xterm desktop model.

This scaffold intentionally starts small but now supports real in-process prototype sessions:
- project-local pi extension
- `/workbench` dashboard command
- `/workbench-spawn` session launch command
- real pi session supervision and event normalization
- lightweight local metadata persistence for labels, pinned summaries, recent files, selected session, and detail-view preference

## Getting started

```bash
npm install
pi
```

Inside pi, from this project directory:

```text
/reload
/workbench
```

From the dashboard:
- `n` spawns a new tracked session
- `j` / `k` or arrow keys move selection
- `e` renames the selected session
- `t` edits selected session tags
- `p` pins or unpins the current selected-session summary
- `s` sends a steering message
- `f` queues a follow-up
- `!` runs a one-off shell command in the selected session context
- `a` aborts the selected session

Or launch directly:

```text
/workbench-spawn implement a tiny file inventory summary for this repo
```

## Current scaffold

- `.pi/extensions/jackdaw-workbench.ts` — project-local pi extension entrypoint
- `src/index.ts` — extension registration and bootstrapping
- `src/commands/workbench.ts` — `/workbench` dashboard command
- `src/commands/spawn-session.ts` — `/workbench-spawn` command
- `src/orchestration/supervisor.ts` — multi-session manager using real `createAgentSession()` sessions
- `src/orchestration/activity.ts` — pi event normalization into workbench activity/status signals
- `src/orchestration/registry.ts` — in-memory tracked session state
- `src/ui/` — interactive dashboard overlay
- `src/persistence/` — local JSON metadata store

## Persistence behavior

Workbench metadata is stored locally at `.jackdaw-workbench/state.json`.
The entire `.jackdaw-workbench/` directory is gitignored so repo-local session metadata does not get committed accidentally.

Persisted data stays intentionally lightweight:
- editable session names and tags
- pinned summaries
- recent file context and last meaningful update
- last shell fallback command preview
- selected session and detail-view preference
- recent session entries, including sessions that are no longer live in-process

Shell fallback commands run through a local non-recording path in the selected session cwd. Their preview stays in memory only and is not written into workbench state or pi session history.

pi remains the source of truth for transcript/history. On restart, the workbench attempts to reconnect to known sessions from their saved session files. If reconnection fails, the session still appears in the dashboard as a `historical` entry with its saved metadata. Historical entries remain visible instead of disappearing silently, but steer/follow-up/abort/shell fallback only work after a session is reattached or respawned.

## Next steps

1. improve session naming/tag editing inside the dashboard
2. distinguish `blocked` vs `failed` with stronger real-world heuristics
3. persist pinned summaries and richer session metadata edits
4. add changed-files and richer tool detail views
5. decide whether to keep iterating in-pi or move to a standalone pi SDK shell
