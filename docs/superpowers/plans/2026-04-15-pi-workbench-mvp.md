# Pi Workbench MVP Plan

Date: 2026-04-15
Project: Jackdaw
Plan scope: Validate a pi-based session-first workbench as a better orchestration interface than Jackdaw’s current PTY/xterm desktop model
Related spec: docs/superpowers/specs/2026-04-15-pi-workbench-design.md

## Plan objective

Build a small but real prototype that proves three things:
1. multiple pi sessions can be managed as first-class entities
2. dashboard summaries/status/tool activity are more useful than watching terminal panes
3. shell access can remain a fallback instead of the primary UI

## Delivery strategy

Implement this in two milestones:
- **Milestone A:** pi-native prototype for fast validation
- **Milestone B:** decision point on whether to continue as a standalone pi SDK app

This plan covers Milestone A and the validation checkpoint that follows it.

### Locked implementation surface for this MVP
Milestone A is explicitly a **pi-native prototype**.

Concretely, build the MVP as one of:
- a project-local pi extension plus supporting TypeScript modules, or
- a thin pi-native TUI app built directly around pi runtime/session primitives

It is **not** a Wails rewrite and **not** the standalone SDK app yet. The point of this milestone is to validate the session-first orchestration model before investing in a richer shell.

## Assumptions
- The work starts under the existing Jackdaw project umbrella.
- The prototype can live in a new repository or new module without preserving the current Wails app architecture.
- Local-first persistence is sufficient for MVP.
- Persistent embedded PTY panes are out of scope.

## Architecture slice for MVP

### Runtime
- use pi session/runtime primitives to create and manage sessions
- subscribe to session events
- normalize a small subset of events into dashboard activity/state
- maintain a local registry of active and recent sessions

### UI
- overview panel for all sessions
- selected-session detail panel
- controls for steer, follow-up, abort
- summary-first presentation with transcript details behind it

### Persistence
- store local orchestration metadata only
- do not attempt HQ synchronization beyond roadmap/work tracking for now

## Work breakdown

### Task 1 — Establish the prototype shell and repository structure

#### Outcome
A runnable project skeleton exists for the pi-native workbench prototype.

#### Deliverables
- repository/module structure chosen
- package/runtime bootstrap works
- developer run command documented
- initial README describing the prototype goal

#### Notes
If this lives outside the current Wails app, prefer a clean prototype surface over incremental reuse.

### Task 2 — Build a session supervisor layer over pi

#### Outcome
A local supervisor can create, track, and dispose of multiple pi sessions.

#### Deliverables
- session registry abstraction
- create/list/select session flows
- editable session naming
- session tags
- session metadata capture: id, cwd, model, task label, last update, summary, status
- lifecycle hooks for active, idle, failed, done

#### Notes
This is the core replacement for the old PTY/session manager model.

### Task 3 — Normalize pi events into workbench activity/status

#### Outcome
The app can turn raw pi session events into a compact state model for the UI.

#### Deliverables
- event mapping table from actual pi session events to app activity records
- a clear normalization boundary module that translates pi runtime/session events into workbench state updates
- derived session statuses for MVP
- uncertainty fallback behavior (`idle` + recent summary)
- tests for status derivation and event normalization

#### Minimum implementation target
The normalization layer must prove that real pi sessions can be classified into:
- `running`
- `awaiting-input`
- `blocked`
- `idle`
- `failed`
- `done`

#### Notes
This is the critical semantic layer that makes the workbench feel better than terminals.

### Task 4 — Implement the overview dashboard UI

#### Outcome
The user can monitor multiple sessions without opening all details.

#### Deliverables
- session list / cards
- visible status badges
- last meaningful update
- current tool or recent activity preview
- attention indicators for sessions likely needing input

#### Notes
Optimize for “which session needs me?”

### Task 5 — Implement selected-session detail view

#### Outcome
The selected session view clearly shows what the agent is doing now.

#### Deliverables
- latest summary
- summary pin action
- pinned summary display/state
- live streamed text area
- current tool activity area
- metadata strip (cwd/worktree/model/session name)
- optional raw transcript expansion

#### Notes
The summary/tool-first layout matters more than exhaustive transcript rendering.

### Task 6 — Add intervention controls

#### Outcome
The user can steer or stop active sessions intentionally.

#### Deliverables
- steer action
- follow-up action
- abort action
- visible action affordances in both overview and detail contexts where appropriate

#### Notes
Keep the action model simple and obvious.

### Task 7 — Add local persistence for orchestration metadata

#### Outcome
Dashboard metadata survives app restarts in a lightweight way.

#### Deliverables
- local metadata store
- restore editable names/tags/pinned summaries/recent sessions/preferences
- documented behavior for sessions that cannot be reconnected
- preserve historical visibility when reconnection fails

#### Notes
Do not overbuild; historical visibility is more important than perfect restoration.

### Task 8 — Add shell fallback

#### Outcome
The user can temporarily drop into command execution when the structured UI is insufficient.

#### Deliverables
- required: one-off command execution in selected session context
- optional stretch: temporary interactive shell handoff if feasible in the chosen pi-native surface
- clear return path to structured dashboard view

#### Notes
This should feel like an escape hatch, not a return to terminal-first UX.

### Task 9 — Validate the prototype against explicit criteria

#### Outcome
There is evidence to decide whether to invest in a standalone pi SDK app.

#### Deliverables
- short validation checklist
- one-week usage notes or structured test log
- decision memo: continue, iterate, or stop

#### Notes
Measure reduced transcript checking and speed of intervention.

## Sequence

1. Task 1 — prototype shell
2. Task 2 — session supervisor
3. Task 3 — event normalization/status derivation
4. Task 4 — overview dashboard
5. Task 5 — selected-session detail
6. Task 6 — intervention controls
7. Task 7 — local persistence
8. Task 8 — shell fallback
9. Task 9 — validation and go/no-go decision

## Risks and checkpoints

### Checkpoint after Tasks 2-3
Question: Do we have enough signal from pi events to drive a useful status model?

Acceptance criteria:
- real pi sessions can be created, listed, selected, named, and tagged
- the normalization layer can derive `running`, `awaiting-input`, `blocked`, `idle`, `failed`, and `done` from real session behavior without manual annotation
- uncertainty cases degrade gracefully to `idle` + recent summary

If no:
- simplify the status taxonomy
- rely more heavily on explicit summaries
- reassess whether a standalone shell is justified before more UI investment

### Checkpoint after Tasks 4-6
Question: Is the dashboard already better than terminal panes for routine orchestration?

If no:
- improve summary/status/action clarity before adding more features
- avoid broadening scope into handoff/review/changed-files too early

### Final checkpoint after Task 9
Question: Should this become the primary successor direction for Jackdaw?

Decision options:
- continue with a standalone pi SDK app
- continue iterating as a pi-native tool
- stop and fold the learnings back into Jackdaw

## Out of scope for this MVP plan
- multi-user collaboration
- HQ-backed live session synchronization
- full review queue workflows
- structured handoff workflows
- changed-files panel
- visual branch/session graph
- embedded always-on PTY terminals

## Validation plan

### Success metrics
- 3-5 sessions can be monitored from one overview without watching raw terminal panes
- the user can identify the session needing attention in under 10 seconds
- at least 80% of routine status checks can be handled without opening raw transcript details
- steer/follow-up/abort are each reachable through an obvious path
- pinned summaries, editable session names, and session tags are usable in the prototype

### Evidence sources
- manual usage log over one week
- short before/after comparison against current Jackdaw habits
- notes on moments where shell fallback was required

## Recommended next action after approval

Start with Tasks 1-3 only, because they determine whether the rest of the UI is worth building.
