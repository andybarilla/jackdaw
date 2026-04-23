# Workspace GUI Successor Design Spec

Date: 2026-04-17
Project: Jackdaw successor direction
Topic: Design a new pi-based GUI workbench app informed by the Pi Workbench MVP findings
Related specs:
- docs/superpowers/specs/2026-04-15-pi-workbench-design.md
- docs/superpowers/specs/2026-04-16-real-usage-polish-design.md
- docs/superpowers/validation/2026-04-15-decision-memo.md

## Summary

The Pi Workbench MVP validated the core product bet: a session-first interface built around pi runtime state is better than transcript-first terminal orchestration for routine monitoring and intervention. The next phase should not keep polishing the MVP as the main product surface. It should define the real app.

The recommended direction is a new desktop workbench with a local web UI, packaged as a desktop app, backed by a local pi runtime service. The app should be workspace-centered, optimized for live operations, and designed so the local-first v1 can later support remote and multi-machine workflows without rewriting the core architecture.

This app is not a TUI extension with more panels, and it is not just a generic Pi GUI. It is a session-first operator workbench for running real multi-agent work across multiple repos, worktrees, and active sessions inside a single workspace umbrella.

## Decision inputs from the MVP

### What the MVP validated
- structured session state beat transcript-first monitoring for routine checks
- the right session could be identified quickly from overview state
- steering and intervention felt faster than current Jackdaw
- shell fallback was not needed for routine monitoring
- the model problems were mostly solved well enough to move forward

### What the MVP exposed as weak
- overview trust can break when concurrent updates make the session list feel unstable
- summaries and pinned summaries need clear semantics to stay trustworthy
- attention signaling must clearly separate "active" from "needs me"
- the operator needs understanding and action in the same view

### Implication
The successor should preserve the MVP's session-first semantics while moving to a GUI surface with a higher UX ceiling and cleaner architecture boundaries than a pi-native TUI can provide.

## Product goals

- Build a GUI-first workbench that feels materially better than working inside TUI surfaces alone.
- Keep sessions as the primary operational attention objects.
- Organize work around workspaces that can span multiple repos, worktrees, and sessions.
- Make the workspace home screen answer: what needs me right now?
- Balance understanding and intervention in the same operator flow.
- Support plans, specs, reviews, artifacts, and branch context as first-class supporting context around sessions.
- Stay local-first in v1 while keeping the runtime and transport boundaries clean enough for later remote and multi-machine support.

## Technical goals

- Use pi as the underlying agent/session runtime.
- Separate UI concerns from orchestration/runtime concerns.
- Avoid re-coupling the product to PTY rendering or transcript-first interaction.
- Keep shell access as fallback, not primary UI.
- Make architecture choices that do not trap the app in single-machine in-process assumptions.

## Non-goals for v1

- multi-user collaboration
- HQ as the system of record
- remote execution as a launch requirement
- perfect feature parity with every historical Jackdaw idea
- persistent embedded terminal panes as the main workflow
- building a general-purpose Pi IDE replacement

## Users and jobs

### Primary user
Andy running multiple coding-agent sessions across multiple repos and worktrees inside a broader project umbrella.

### Core jobs
- monitor many active sessions without reading raw transcripts constantly
- understand which session needs attention first and why
- intervene immediately when needed
- connect sessions back to workspace context: repos, branches, work items, specs, plans, reviews, artifacts
- keep shell access available for edge cases without turning the UI back into terminal management

## User-decided product constraints

These were chosen explicitly during design discussion:
- GUI-first, not TUI-first
- desktop app in v1
- local-first, but designed for later remote and multi-machine use
- full agent workbench, not just a session monitor
- workspace-centered, not session-centered or task-centered
- workspace may span multiple repos and worktrees
- home screen optimized for live operations
- sessions are the primary attention objects
- understanding and intervention should have equal weight
- HQ integration is optional and secondary, because HQ is personal infrastructure rather than a product requirement

## Options considered

### Option A: Native desktop shell with the pi runtime embedded directly into the UI process

#### Description
Build a desktop app where the UI shell and orchestration logic are tightly coupled in one process boundary.

#### Pros
- simplest first-run mental model
- fewer moving parts at the start
- easy to get a local desktop app working quickly

#### Cons
- makes later remote and multi-machine support harder
- mixes presentation concerns with runtime/session concerns
- encourages in-process shortcuts that become architectural debt
- not a great fit for a workspace that spans multiple repos and potentially multiple machines later

### Option B: Local web app plus separate pi orchestration service

#### Description
Build a browser-based local app backed by a dedicated local runtime/service layer.

#### Pros
- excellent UI flexibility
- clean boundary between UI and runtime
- good path toward future remote access
- easy to test and iterate on the frontend

#### Cons
- weaker desktop feel out of the box
- local service + browser split can feel bolted together
- desktop integration becomes a second step rather than a first-class feature

### Option C: Hybrid desktop app with packaged web UI over a local pi runtime service

#### Description
Build a desktop app shell that hosts a web UI, while the actual orchestration logic lives in a local service/runtime boundary. Package both as one local-first application.

#### Pros
- highest UX ceiling without committing to heavy native UI code
- clean architectural boundary between UI and runtime
- strong fit for local-first desktop use
- good migration path toward remote and multi-machine support later
- supports a workspace-centered, multi-repo operator console better than a TUI or tightly coupled in-process shell

#### Cons
- more architecture up front than a pure in-process app
- requires explicit decisions about service lifecycle, state model, and transport
- slightly more build and packaging complexity

## Recommendation

Adopt **Option C**.

Build a hybrid desktop app with:
- a packaged web UI for the operator experience
- a local pi-backed orchestration service as the runtime boundary
- local-first workspace state in v1
- explicit APIs/events between UI and runtime

This is the best match for the validated model and the chosen constraints.

## Product model

## Core product framing
The app is a **workspace-centered operator workbench**.

A workspace is a project umbrella that can contain:
- multiple repos
- multiple worktrees or branches
- multiple active and historical Pi sessions
- plans and specs
- reviews and handoffs
- artifacts and summary snapshots
- local workspace preferences and saved layout state

The home screen is a **live operations dashboard**.

It should answer, in order:
1. which sessions need me right now
2. what changed recently
3. what action can I take immediately
4. what project context surrounds that session

## Primary objects

### Workspace
The top-level container.

Fields should include:
- id
- name
- description
- local roots or registered repos
- known worktrees
- active sessions
- recent artifacts
- local preferences and layout state
- optional external links or IDs, including HQ if configured

### Session
Primary operational attention object.

Fields should include:
- id
- workspace id
- repo/worktree/cwd context
- branch
- agent/model/runtime info
- current status
- live summary
- pinned summary
- latest meaningful update
- current activity/tool
- intervention state
- linked work item, spec, or plan when present
- timestamps

Canonical v1 status set:
- `awaiting-input`
- `blocked`
- `failed`
- `running`
- `idle`
- `done`

These statuses should be treated as operator-facing states, not raw runtime event names.

### Work item
Supporting project object rather than the main dashboard unit.

Fields should include:
- id
- workspace id
- title
- status
- plan/spec linkage
- owning session or session set
- review state
- branch/worktree context

### Artifact
Any operator-relevant durable output.

Examples:
- spec
- plan
- decision memo
- review report
- summary snapshot
- changed-files snapshot

### Attention event
Normalized event the dashboard can rank and present.

Examples:
- awaiting input
- blocked
- failed
- review requested
- handoff waiting
- intervention observed
- session done

In v1, sessions remain the top-level attention objects. Attention ranking should primarily derive from the session status set above, while attention events explain why a session is in that state and what changed recently. In other words: status decides urgency, events provide evidence and context.

## UX architecture

## Workspace home: live operations dashboard

The default home should be a three-part command surface:

### 1. Session attention rail
Purpose: rank sessions by urgency and clarity.

Must show:
- status and urgency
- why this session needs attention
- current activity
- latest meaningful update
- repo/worktree/branch context
- linked work item or plan when available

### 2. Selected session command center
Purpose: balance understanding and action.

Must show:
- live summary
- pinned summary if present
- current activity
- latest update
- recent attention events
- branch/repo/worktree context
- linked spec/plan/work item/review state
- primary actions: steer, follow-up, abort, resume, spawn specialist, open files/branch context

This view should make understanding and intervention equally easy.

### 3. Workspace context panel
Purpose: provide nearby project context without replacing the session-centric operator loop.

Should show:
- related work items
- open plans/specs
- review state
- changed files or branch context
- recent artifacts or decisions

## Secondary screens

### Workspace explorer
For browsing repos, worktrees, files, artifacts, and historical sessions.

### Review queue
For sessions or work items waiting on explicit review/handoff states.

### Artifact viewer
For specs, plans, decision memos, summaries, and generated outputs.

### Settings / connections
For local runtime config, workspace registration, model/runtime options, optional external integrations.

## State model

## v1 source of truth
The source of truth in v1 should be **local app state plus live pi runtime state**.

That means:
- live session/runtime data comes from the local pi orchestration service
- workspace metadata is stored locally by the app
- HQ is optional and additive, not foundational
- transcripts remain owned by pi/session history rather than duplicated wholesale into the workspace store

## Persistence boundary
Persist locally:
- workspace definitions
- registered repos/worktrees
- session metadata and layout state
- summary snapshots and pins
- attention/history cache needed for the dashboard
- links between sessions and work items/artifacts
- user preferences

Do not make v1 depend on:
- HQ availability
- cloud sync
- remote session execution
- durable transcript duplication beyond what the runtime already owns

## Runtime architecture

## High-level shape

### UI layer
Responsibilities:
- render the desktop workbench UI
- maintain view state and interaction state
- subscribe to workspace and session updates
- issue operator commands

### Local orchestration service
Responsibilities:
- create and manage Pi sessions
- normalize runtime events into dashboard state
- maintain workspace/session registry
- persist local workspace metadata
- expose commands and event streams to the UI
- enforce the session-first attention model

### Runtime adapters
Responsibilities:
- talk to pi runtime/session primitives
- surface session events, tool activity, summaries, status transitions, and shell fallback hooks
- preserve room for later alternate transports or remote execution targets

## Future-ready boundaries
To keep later remote and multi-machine support possible, the design should assume:
- UI and orchestration service can be separated by a stable transport boundary
- session and workspace APIs should not assume same-process calls forever
- persistence should be structured so a future sync layer can replicate or merge workspace state intentionally

## Interaction model

## Session-first attention loop
1. operator opens workspace home
2. dashboard ranks sessions by urgency
3. operator selects a session
4. command center explains state and recent changes
5. operator intervenes or defers
6. workspace context panel shows surrounding task/review/artifact context

## Core actions in v1
Required:
- spawn session
- steer
- follow-up
- abort
- open repo/worktree context
- inspect linked plan/spec/work item
- pin or refresh summary snapshot
- shell fallback for edge cases

Likely next-tier actions:
- spawn specialist from current context
- request review
- mark handoff
- attach artifact to session
- compare summaries across sessions

## Error handling and resilience

- if a session becomes unavailable, keep its metadata visible as historical context
- if a repo/worktree cannot be found, preserve links and surface the broken state clearly
- if the local service restarts, restore the workspace and reconnect sessions where possible
- reconnectable sessions are sessions with enough local runtime metadata to reattach to a live pi session cleanly; sessions without that path should remain visible as historical-only entries
- if reconnection fails, keep the workspace legible instead of dropping objects silently, and show that the session is historical-only until manually resumed or replaced
- shell fallback failures should be explicit and bounded, not treated as normal workflow noise

## Testing strategy

### Product validation tests
- can the operator identify the most urgent session quickly from the dashboard
- can the operator understand and act without opening transcripts for routine cases
- can a workspace with multiple repos and sessions remain calm and legible
- does the app preserve trust when state is changing quickly

### Technical tests
- session event normalization
- stable attention ordering under concurrent updates
- persistence/reconnect behavior
- session-to-work-item and session-to-artifact linkage
- intervention lifecycle feedback
- local service restart and recovery

## Open questions for planning

These should be resolved in the implementation plan, not by changing the product direction:
- exact desktop packaging choice
- exact frontend stack
- exact transport between UI and local orchestration service
- whether changed-files context ships in v1 or first lands as a linked artifact view
- how much review/handoff state becomes native in the first release versus linked metadata

## Suggested milestone structure

### Milestone 1: Runtime and workspace foundation
- workspace registry
- repo/worktree model
- local orchestration service
- session/event normalization
- local persistence

### Milestone 2: Live operations dashboard
- session attention rail
- selected session command center
- workspace context panel
- intervention controls
- summary/pin model

### Milestone 3: Workbench context objects
- plans/specs/artifacts linkage
- work item linkage
- review/handoff state
- branch and changed-files context

### Milestone 4: Hardening and future transport readiness
- reconnect/recovery
- service lifecycle
- API boundary cleanup
- remote-readiness constraints and abstraction cleanup

## Acceptance criteria for planning readiness

This design is ready for planning when the user agrees that:
- the app should be a packaged desktop GUI over a local pi-backed orchestration service
- workspaces should span multiple repos/worktrees/sessions
- the home screen should be a live operations dashboard
- sessions remain the primary attention objects
- understanding and intervention share the same main view
- HQ is optional rather than foundational
