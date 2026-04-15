# Pi Workbench Design Spec

Date: 2026-04-15
Project: Jackdaw
Topic: Reframe Jackdaw from a terminal-orchestration desktop app into a pi-based multi-agent workbench

## Summary

Instead of continuing to optimize Jackdaw as a desktop app that spawns terminal-backed Claude Code sessions and renders them through xterm.js, build a new workbench on top of `pi` as the agent runtime. The workbench should treat sessions, tools, tasks, and state as first-class concepts rather than inferring them from PTY output.

The recommended approach is a staged migration:

1. Build a **pi-native orchestration prototype** first to validate the interaction model.
2. If validated, build a **standalone app using the pi SDK** for a richer UI.
3. Preserve shell access as an escape hatch, not as the primary abstraction.

## Problem

Current Jackdaw strengths:
- easy to launch and view multiple coding-agent sessions
- clear session/process ownership
- desktop framing feels more deliberate than a single terminal tab

Current Jackdaw limitations:
- each session is fundamentally just a PTY
- the frontend mostly renders terminal output rather than agent state
- higher-level concepts like "current task", "blocked", "awaiting review", or "recent files changed" are not native UI primitives
- terminal panes become noisy and visually flat at scale
- orchestration UX is constrained by xterm.js instead of the agent model

## Goals

### Product goals
- Replace the terminal-first metaphor with a **session-first workbench**.
- Make multi-agent orchestration feel legible and calm.
- Surface meaningful state: current task, latest summary, current tool, worktree, model, blocked state, files changed.
- Support steering, follow-ups, abort, handoff, and review flows as explicit actions.
- Make it easy to compare multiple active agents without watching raw terminal scrollback.

### Technical goals
- Use `pi` as the core agent runtime.
- Reuse pi’s strengths: sessions, tools, commands, streaming events, extensions, and SDK embedding.
- Avoid coupling core UX to PTY rendering.
- Keep an interactive shell escape hatch for tasks that truly need terminal control.

### Non-goals
- Perfect visual polish in the first milestone.
- Full feature parity with every Jackdaw desktop behavior before validating the new model.
- Re-creating terminal multiplexing as the primary UX.

## Users and Jobs

### Primary user
Andy running multiple local coding-agent sessions across projects/worktrees.

### Core jobs
- launch several agent sessions with distinct goals
- understand what each agent is doing at a glance
- intervene mid-flight with steering or course corrections
- review outputs, changed files, and status without reading every token
- move work between sessions or spawn a new specialist session

## Options considered

### Option A: Keep evolving Jackdaw’s PTY desktop model

#### Description
Continue improving the Wails + Go + xterm.js architecture.

#### Pros
- leverages existing implementation
- keeps direct compatibility with terminal-native tools
- simpler mental model for shell-oriented sessions

#### Cons
- still terminal-first
- hard to expose agent semantics cleanly
- UI quality remains constrained by PTY rendering
- orchestration features become increasingly bolted on

### Option B: Build a pi-native TUI workbench

#### Description
Use pi extensions, custom widgets, overlays, commands, and session/runtime support to create a richer workbench inside pi’s terminal UI.

#### Pros
- fastest path to validation
- low infrastructure cost
- directly reuses pi’s extension and session systems
- enough UI primitives for structured dashboards and overlays

#### Cons
- still a terminal app
- visual polish ceiling is lower than a full desktop/web app
- multi-session dashboard ergonomics may need careful design

### Option C: Build a standalone app on the pi SDK

#### Description
Use the pi SDK as runtime infrastructure while building a custom desktop or web UI.

#### Pros
- highest UX ceiling
- best fit for session cards, dashboards, approvals, and richer layout
- removes PTY/xterm dependence from the core experience

#### Cons
- highest engineering cost
- more state management and event plumbing to own
- requires designing session persistence and orchestration UX explicitly

## Recommendation

Adopt **Option B first, with Option C as the planned follow-on**.

This yields the best sequence of learning:
- validate the session-first workbench model quickly inside pi
- prove that structured state and summaries beat terminal panes
- only then invest in a standalone shell if the concept earns it

## Proposed architecture

## Phase 1 architecture: pi-native workbench prototype

### Runtime model
- one orchestration layer manages multiple pi sessions
- each session has:
  - session id
  - display name
  - cwd/worktree
  - model
  - thinking level
  - latest prompt/task
  - current status
  - recent tool activity
  - latest summary

### UI model
- **left rail:** active sessions and filters
- **main panel:** selected session timeline, current activity, latest summary, actions
- **overview mode:** cards for all running sessions
- **command/actions:** spawn, steer, follow-up, abort, fork, compact, handoff, review

### State model
Store lightweight orchestration metadata above raw conversation history:
- session registry
- friendly labels
- project/worktree metadata
- derived status (`idle`, `running`, `blocked`, `awaiting-input`, `failed`, `done`)
- last meaningful update timestamp
- pinned summary
- unread/activity markers

### Persistence boundary
For the prototype, persistence should be **local-first** and intentionally lightweight.

Prototype persistence rules:
- pi remains the source of truth for session transcripts/history
- the workbench stores orchestration metadata locally per machine
- metadata includes labels, pinned summaries, last meaningful update, derived status cache, and overview preferences
- HQ sync is optional and out of scope for MVP
- restart behavior should restore the dashboard state and reconnect to known sessions where possible; if not possible, historical sessions should still appear as historical entries rather than silently disappearing

### Shell strategy
- interactive shell remains available as an escape hatch
- shell access is secondary to structured agent state
- terminal panes should not be the default view

#### MVP shell fallback
The prototype does **not** need persistent embedded PTY panes.

MVP shell behavior:
- support one-off command execution for the selected session context
- optionally allow a temporary interactive shell handoff when a task truly needs full terminal control
- returning from the shell should bring the user back to the structured session view
- preserving terminal output as the primary UI is explicitly out of scope

## Phase 2 architecture: standalone app on pi SDK

### Backend/runtime responsibilities
- create and manage pi sessions
- subscribe to session events
- normalize events into app-level state
- persist lightweight orchestration metadata
- expose commands/actions to the UI

### Frontend responsibilities
- render session list/cards
- render streaming assistant output and tool activity
- display summaries, changed files, and status badges
- provide steering, follow-up, and handoff controls
- show blockers and review queues

## Core domain model

### Session
Represents one active or historical pi agent session.

Fields:
- id
- name
- cwd
- worktree/branch
- model
- task
- status
- lastUpdateAt
- summary
- unread/activity marker

### Activity
Normalized event emitted by a session.

Examples:
- user prompt submitted
- assistant summary updated
- tool started
- tool finished
- file edited
- review requested
- blocked on user input

### MVP event contract
The workbench should consume pi session events and normalize them into a small app-level activity model.

Primary event sources from pi:
- assistant text stream updates
- tool execution start/update/end events
- agent start/end events
- prompt submission / queued message actions
- session metadata such as cwd, model, and session id

Minimum normalized activity records:
- `message_streaming`
- `tool_running`
- `tool_finished`
- `awaiting_user`
- `session_idle`
- `session_failed`
- `session_completed`

### Status derivation rules for MVP
- `running`: assistant is actively streaming and/or a tool is currently executing
- `awaiting-input`: assistant explicitly asks for user input or a queued intervention is required before continuing
- `blocked`: a tool failure or explicit agent message indicates work cannot proceed without an external action
- `idle`: no active streaming or tool execution and the session is not in a terminal state
- `failed`: the session ends in an unrecovered error state
- `done`: the latest task has been completed and the session is no longer working

If automatic classification is uncertain, prefer `idle` with a recent activity summary rather than over-claiming semantic state.

### Action
User-initiated control event.

Examples:
- spawn session
- send steering message
- queue follow-up
- abort
- fork
- compact
- handoff to another session

## UX principles
- default to **summary over raw logs**
- keep recent tool activity visible
- make cross-session comparison cheap
- make intervention obvious and low-friction
- preserve raw details when needed, but not as the main information density

## Functional requirements

### Must have for MVP
- create and list multiple pi sessions
- name and tag sessions
- show per-session status
- show live streamed text for selected session
- show current tool activity for selected session
- allow steer/follow-up/abort
- show cwd/worktree/model metadata
- maintain overview across active sessions
- support session summary pinning

### Explicitly out of MVP
- structured handoff flow
- review queue
- changed-files panel
- visual branch/session graph
- persistent embedded terminal panes

### Should have soon after MVP
- fork session
- session templates / launcher presets
- changed-files panel
- review queue for sessions asking for input
- structured handoff flow

### Later / exploratory
- visual branch/session graph
- cross-session search
- team/shared sessions
- deployment or CI actions as first-class controls
- HQ-native portfolio rollups

## Risks
- pi-native TUI may improve structure but not fully solve the desire for desktop-level polish
- multi-session orchestration may still need a bespoke supervisor layer even when using pi
- summary quality must be high enough that users trust the dashboard over raw transcript scanning
- shell-heavy workflows may still occasionally pull the UX back toward terminal views

## Mitigations
- stage the investment: prototype first, standalone second
- keep shell as fallback only
- derive explicit statuses from session/tool events
- bias the MVP toward a small set of actions done well

## Success criteria
- Andy can monitor 3-5 concurrent agents without relying on raw terminal panes
- the selected session view answers "what is it doing now?" in under 3 seconds
- intervention actions are faster and clearer than interacting with raw PTYs
- during a one-week prototype trial, the dashboard reduces the need to inspect raw transcript/log output for routine status checks

### Prototype evaluation metrics
- time to identify which session needs attention should be under 10 seconds from the overview screen
- at least 80% of routine check-ins should be satisfiable from summary + status + tool activity without opening raw transcript details
- the user should be able to steer or abort any active session in one obvious interaction path

## Open questions
- Should the standalone shell eventually be desktop-first, web-first, or both?
- How much raw transcript should be visible by default versus collapsed behind summaries?
- Should session orchestration metadata live only locally, or also sync to HQ?
- What is the minimum shell escape hatch needed for comfort without regressing into terminal-first UX?

## Decision

Proceed with a pi-based session-first workbench prototype and treat a standalone SDK app as the likely second phase if the prototype validates the model.
