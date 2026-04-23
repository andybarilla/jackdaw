# Pi Workbench Real-Usage Polish Design Spec

Date: 2026-04-16
Project: Jackdaw
Topic: Improve the pi workbench for real day-to-day orchestration use after the initial MVP validation days

## Summary

The first two days of prototype use show that the pi-native workbench is already directionally better than transcript-first orchestration for routine monitoring. The next phase should focus on the specific friction points observed in real use, not on broadening the feature surface.

The recommended next slice is a real-usage polish cycle with five tightly scoped improvements:

1. stabilize overview ordering so concurrent updates do not cause session-list flicker
2. clarify pinning semantics so pinned summaries feel trustworthy during fast-changing state
3. strengthen "needs attention" signaling so attention-worthy sessions stand out immediately
4. make selected-session summaries more actionable for routine checks
5. improve intervention feedback so steer/follow-up/abort feel explicit and reliable

## Why this work now

Early validation signal is strong:
- routine checks were handled without transcript inspection
- attention-needing sessions were identifiable quickly
- intervention controls already felt faster than current Jackdaw
- shell fallback was not needed for routine use

The main issues discovered were not fundamental model failures. They were UI and interaction clarity issues:
- overview ordering flickered when multiple sessions updated concurrently
- pinning was confusing when state changed quickly
- the dashboard can still do more to highlight true attention states over simple recency churn

That makes this a good moment to improve the current surface rather than branching into larger features like handoff flows, changed-files panels, or a standalone SDK app.

## Goals

### Product goals
- Make the overview feel calm and trustworthy under concurrent session activity.
- Make it obvious which session needs operator attention first.
- Make pinning a reliable way to preserve the most useful summary state.
- Keep routine monitoring transcript-light.
- Reinforce intervention controls as a core strength of the workbench.

### Technical goals
- Keep implementation inside the current pi-native prototype surface.
- Reuse the existing workbench registry, supervisor, persistence, and dashboard UI.
- Avoid introducing large new subsystems or persistent terminal surfaces.
- Preserve lightweight local persistence and existing security constraints.

### Non-goals
- changed-files panel
- review queue workflows
- structured handoff workflows
- visual session graph
- standalone pi SDK app migration
- persistent interactive shell panes

## User insights driving this spec

### What already worked
- 3 of 3 routine checks were handled without transcript details on both initial trial days
- intervention felt faster than current Jackdaw
- steering was especially well-liked
- shell fallback was not needed

### What was confusing or weak
- overview rows flickered between top positions when multiple sessions updated at once
- pinning was confusing because it was not always clear what exact state was being frozen
- the overview could do more to separate "active" from "needs me"

## Proposed changes

## 1. Stabilize overview ordering

### Problem
The current overview appears to reorder too eagerly based on recent updates. When two active sessions update near the same time, they can alternate positions and create visual churn.

### Design
Move from a primarily recency-driven overview to a more stable priority model:
- first order by attention band
- then use a stable within-band ordering strategy
- avoid repositioning on every minor update when the session remains in the same semantic band

### Attention bands
Highest to lowest:
1. `awaiting-input`
2. `blocked`
3. `failed`
4. `running`
5. `idle`
6. `done`

### Stability rule
Within a band, preserve the existing relative order unless one of these happens:
- the session changes status band
- the session is newly created
- the user manually selects another ordering trigger in a future feature (out of scope here)

This means routine streaming updates should refresh content without constantly reshuffling rows.

### Ordering source of truth
For this cycle, ordering should remain lightweight and mostly in-memory.

Rules:
- on first load, use the current persisted session order from the registry state if available; otherwise derive order from the existing session list order as hydrated from persisted state
- do not introduce a new heavy persistence model just for sort history
- if a session enters a different attention band, place it at the top of its new band
- if multiple new sessions enter the same band, break ties by `lastUpdateAt`, newest first
- if two sessions remain in the same band, minor updates must not reorder them
- restoring after restart should preserve the hydrated session order closely enough that the dashboard does not feel freshly shuffled

### Acceptance checks
- two running sessions with frequent updates no longer alternate positions constantly
- a session that becomes `awaiting-input`, `blocked`, or `failed` moves above less urgent bands
- restarting the app does not cause the overview to reshuffle in a surprising way

### Expected outcome
The session list should feel calmer, and attention-finding should remain fast even during concurrent activity.

## 2. Clarify pinning semantics

### Problem
Pinning is useful in principle, but during fast-moving state it is unclear what exact summary is being pinned.

### Design
Treat pinning as freezing a specific summary snapshot.

When the user pins:
- capture the exact current summary string for the currently selected session at that moment
- store one pinned snapshot per session
- replace the existing pinned snapshot when the user pins again for that same session
- continue showing live summary updates separately

### Persistence and lifecycle
- pinned summaries remain lightweight metadata and persist across restart
- no multi-pin history is needed in this cycle
- if no live summary exists yet, pinning should be unavailable or no-op with clear user feedback
- if the session later enters an error or terminal state, the pinned snapshot stays unchanged until explicitly unpinned or replaced
- pinned summaries affect displayed text only; they do not affect attention ordering or status derivation

### UI behavior
The selected-session view should distinguish clearly between:
- `Pinned summary`
- `Live summary`

The overview should prefer the pinned summary when present, but the detail view must make the relationship explicit.

### Feedback
When pinning or unpinning:
- provide a lightweight confirmation
- make the pinned state visually obvious
- avoid ambiguity about whether the pin tracks future updates

### Acceptance checks
- the user can tell exactly what summary text was pinned
- re-pinning replaces the prior pinned snapshot for that session
- restart preserves the pinned snapshot
- the live summary can continue changing without mutating the pinned snapshot

### Expected outcome
Pinning becomes a trustworthy "freeze this useful state" tool rather than a vaguely sticky label.

## 3. Strengthen needs-attention signaling

### Problem
The overview already shows status, but it can still emphasize raw activity over operator-relevant urgency.

### Design
Increase visual and textual emphasis for states that need operator attention:
- `awaiting-input`
- `blocked`
- `failed`

Reduce the risk that "currently busy" feels more important than "needs a decision from me".

### Minimum required UI change
Within the existing overview row rendering:
- `awaiting-input`, `blocked`, and `failed` rows must receive stronger visual treatment than `running`, `idle`, and `done`
- each of those three attention states must include explicit operator-facing wording that it needs attention, not just a generic status badge
- `running` rows should remain visually active but must not look more urgent than attention states

This does not require a brand-new layout. It should be achievable as a refinement of the existing overview rendering.

### Acceptance checks
- a user scanning the overview can distinguish "needs me" from "is busy" immediately
- attention-state rows stand out more strongly than running rows
- the overview does not require opening the selected-session detail to know which row is most urgent

### Expected outcome
The answer to "which session needs me?" becomes even more obvious than it is today.

## 4. Make summaries more actionable

### Problem
Summaries already help reduce transcript checking, but the selected-session view can better distinguish stable state from in-flight activity.

### Design
Clarify the session detail model into separable concepts:
- live summary: the current session summary string already stored on the session record
- pinned summary: an optional frozen snapshot captured by the user for that session
- current activity: the current tool name or running-state indicator derived from existing supervisor/session activity fields
- latest update: the newest operator-visible activity summary already captured in the recent activity stream

Per-surface contract:
- overview row: show the pinned summary if present; otherwise show the live summary
- detail view: always show the live summary
- detail view: if a pinned summary exists, show it as a separate `Pinned summary` field rather than replacing the live summary
- latest update remains a separate recent-activity concept, not a replacement for either summary

For this cycle, do not introduce a new summarization subsystem. Prefer re-presenting existing fields more clearly.

### Meaningful change rule
A meaningful latest update is any newly recorded activity that would matter to the operator, such as:
- tool start or finish
- awaiting-input transition
- blocked or failed event
- completion event
- operator actions like steer, follow-up, abort, or shell fallback

### UI direction
The selected-session panel should make it easier to answer:
- what is this session doing?
- does it need me?
- what changed recently?
- what summary should I trust right now?

This should stay lightweight and text-first, not turn into a transcript-heavy view.

### Acceptance checks
- the detail view shows a clearer distinction between summary, current activity, and recent update context
- the user can understand the session state without opening transcript view in routine cases
- implementation stays inside existing registry/supervisor data where possible

### Expected outcome
Routine checks remain transcript-light and feel even more decision-oriented.

## 5. Polish intervention feedback

### Problem
Intervention controls are already promising, but more explicit feedback would make them even more confidence-building in daily use.

### Design
When the user sends `steer`, `follow-up`, or `abort`, the dashboard should clearly indicate:
- that the action was accepted locally
- what action was sent most recently
- whether it is still pending observation or has already become part of recent history

### Simple intervention lifecycle
For this cycle, use a lightweight lifecycle:
1. `sent` — the user submitted the action and the local command accepted it
2. `pending observation` — the dashboard has not yet shown a newer meaningful activity after the intervention timestamp
3. `observed` — the recent activity stream records the first meaningful entry with a timestamp newer than the intervention timestamp
4. `failed` — the action could not be submitted locally

Rules:
- only one most-recent pending intervention needs special treatment in the UI
- older interventions can remain visible only as recent history
- use the recent activity stream as the source of truth for observation
- the local confirmation that an intervention was accepted, queued, or logged must not clear pending by itself
- an intervention becomes `observed` only when a later non-local session activity entry appears after the intervention timestamp
- a meaningful activity for this purpose is any non-heartbeat operator-visible session activity already shown in recent activity, such as tool start/finish, awaiting-input, blocked, failed, or completed
- pure streaming-token churn, minor summary refreshes, or the locally generated operator-action log entry must not clear pending by themselves
- do not claim backend queue semantics beyond what the current implementation actually knows
- failures should surface as explicit local feedback rather than silent disappearance

### UI direction
Without overbuilding, add clearer operator-action visibility such as:
- lightweight confirmation messaging
- a recent intervention line or section in selected-session detail
- clearer wording around queued operator actions

### Acceptance checks
- after sending an intervention, the user can tell it was accepted locally
- the detail view shows the most recent operator action clearly
- once later session activity arrives, the intervention no longer looks ambiguously pending
- failed submissions show explicit feedback

### Expected outcome
The user does not need to wonder whether an intervention "took".

## Persistence considerations

This polish cycle should keep the current persistence boundary:
- persist lightweight metadata only
- do not expand into transcript persistence
- preserve current hardening around malformed state, file permissions, and shell-output handling

Likely persisted additions should remain minimal and only be introduced if needed for the improved UI behavior.

## Risks

- Over-correcting overview stability could hide genuinely important recency changes.
- Stronger attention signaling could become noisy if the status model is not reliable enough.
- Pinning clarification could add UI clutter if the distinction between live and pinned state is too verbose.
- Intervention feedback could become redundant if confirmations overwhelm the existing detail view.

## Mitigations

- prefer minimal UI refinements over new panels or large workflows
- keep status semantics unchanged unless real usage proves they are insufficient
- test the updated behavior directly in real multi-session use rather than abstract examples
- preserve the current shell-fallback philosophy as an escape hatch only

## Success criteria for this cycle

- concurrent session updates no longer cause distracting top-of-list flicker
- the overview feels calmer without making attention-finding slower
- pinning behavior is understandable during live updates
- attention-needing sessions stand out more clearly than merely active ones
- intervention feedback feels explicit and reliable in normal use
- routine checks remain possible without transcript inspection in most cases

## Recommended next step

Write a focused implementation plan with five tasks matching the five design areas above, keeping scope inside the current pi-native prototype.