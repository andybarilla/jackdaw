# Real Usage Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Make the existing pi-native workbench calmer, clearer, and more trustworthy for daily orchestration use by tightening ordering, pinning, attention signaling, summary presentation, and intervention feedback.
**Architecture:** Keep the current dashboard/registry/supervisor shape. Use the registry’s in-memory session order as the source of truth for stable overview ordering, keep persistence lightweight by reusing the existing persisted session array and minimal session metadata, and refine the text-first dashboard rendering rather than adding new panels or workflows.
**Tech Stack:** TypeScript, Vitest, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`

---

## Scope guardrails

This plan is intentionally limited to the five polish areas in `docs/superpowers/specs/2026-04-16-real-usage-polish-design.md`:

1. stable overview ordering
2. pinning semantics
3. needs-attention signaling
4. summary/detail presentation
5. intervention lifecycle feedback

Do **not** broaden into:
- changed-files panels
- review queue workflows
- handoff workflows
- graphs
- standalone app work
- shell expansion

---

## Codebase map for this slice

### Existing files to modify

- `src/orchestration/registry.ts:4-107`
  - Currently sorts sessions by `lastUpdateAt` on hydrate, list, patch, and activity updates.
  - This is the main reason overview ordering flickers under concurrent updates.
- `src/ui/overview.ts:1-99`
  - Currently re-sorts in render with `compareSessions()` and treats `failed` lower than `running`.
  - Also owns text treatment for attention vs running rows.
- `src/ui/session-detail.ts:4-100`
  - Currently conflates pinned/live summary by rendering `Summary: ${session.pinnedSummary ?? session.summary}`.
  - Needs clearer separation of live summary, pinned summary, current activity, latest update, and recent activity.
- `src/ui/dashboard.ts:40-473`
  - Owns key handling, pin toggling, notifications, and rendering composition.
  - Needs pin confirmation/no-op behavior and intervention feedback plumbing.
- `src/orchestration/supervisor.ts:31-390`
  - Owns `steerSession()`, `followUpSession()`, `abortSession()`, event handling, persistence timing.
  - Best place to track most-recent intervention lifecycle.
- `src/types/workbench.ts:1-63`
  - Needs small type additions for intervention lifecycle and possibly richer activity metadata.

### Existing tests to update

- `src/ui/overview.test.ts`
- `src/ui/session-detail.test.ts`
- `src/ui/dashboard.test.ts`
- `src/orchestration/supervisor.test.ts`
- `src/ui/persistence-behavior.test.ts`

### New tests likely needed

- `src/orchestration/registry.test.ts`
  - No registry-focused tests exist yet, but stable ordering belongs there.

---

## File responsibilities after the change

- `src/orchestration/registry.ts`
  - Preserve stable session order in-memory.
  - Move sessions only when they are created or change attention band.
- `src/ui/overview.ts`
  - Render sessions in registry order.
  - Apply band-aware visual language so “needs me” stands out from “is busy”.
- `src/ui/session-detail.ts`
  - Present live summary, pinned summary, current activity, latest meaningful update, and recent activity as distinct concepts.
- `src/ui/dashboard.ts`
  - Gate pin/unpin behavior, show lightweight confirmations, and surface the latest intervention state.
- `src/orchestration/supervisor.ts`
  - Record intervention submission/failed state, persist it, and mark it observed only when newer meaningful non-local session activity arrives.
- `src/types/workbench.ts`
  - Keep new metadata typed and explicit.

---

## Task 1: Stabilize overview ordering in the registry

**Outcome:** The overview stops flickering during concurrent updates because session order is no longer driven by every `lastUpdateAt` change.

**Deliverables:**
- Registry-level stable ordering logic based on attention bands.
- Overview rendering that respects registry order instead of re-sorting by recency.
- Tests proving same-band updates do not reshuffle rows, but band transitions do.

**Likely files:**
- Create: `src/orchestration/registry.test.ts`
- Modify: `src/orchestration/registry.ts:4-107`
- Modify: `src/ui/overview.ts:3-33`
- Modify: `src/ui/overview.test.ts:1-88`
- Modify: `src/orchestration/supervisor.test.ts` if a persistence/restart assertion is easier there

### Implementation notes

1. Make the registry’s internal `state.sessions` array the source of truth for overview order.
2. Remove unconditional `.sort(sortByRecentUpdate)` calls from:
   - `hydrate()`
   - `getState()`
   - `listSessions()`
   - `patchSession()`
   - `addActivity()`
3. Introduce a band helper in `registry.ts` matching the spec order exactly:
   - `awaiting-input`
   - `blocked`
   - `failed`
   - `running`
   - `idle`
   - `done`
4. Implement these movement rules in the registry:
   - **hydrate:** preserve persisted array order as loaded
   - **upsert new session:** insert at the top of its band
   - **patch existing session/addActivity:** if status stays in the same band, keep relative position
   - **status band change:** move session to the top of the new band
   - **multiple new sessions in same band:** newest first within the newly inserted items
5. Keep `lastUpdateAt` updates for timestamps and summaries, but stop using them as the default ordering mechanism.
6. Simplify `renderOverviewLines()` so it renders the sessions in supplied order.
7. Keep a comparison helper only if tests still need one for band ranking; otherwise remove dead code.

### Testing expectations

Run targeted tests first:

```bash
npm test -- src/orchestration/registry.test.ts src/ui/overview.test.ts
```

Expected:
- PASS for new registry ordering tests
- PASS for updated overview rendering tests

Then verify no regressions in persistence/supervisor behavior:

```bash
npm test -- src/orchestration/supervisor.test.ts src/ui/persistence-behavior.test.ts
```

Expected:
- PASS
- No restart-related reshuffle assertions fail

### Verification checklist

- Two running sessions updated repeatedly stay in the same relative order.
- A session moving to `awaiting-input`, `blocked`, or `failed` jumps above lower-priority bands.
- Restart/hydration preserves the stored session array order.

---

## Task 2: Clarify pinning semantics as a frozen summary snapshot

**Outcome:** Pinning becomes “freeze this exact live summary now,” not “track whatever text is currently changing.”

**Deliverables:**
- Pin action captures `session.summary`, not `latestText`.
- Pin is unavailable or no-ops with explicit feedback when there is no live summary text.
- Detail view clearly separates live vs pinned text.
- Re-pin replaces the prior snapshot for that session; unpin removes it.

**Likely files:**
- Modify: `src/ui/dashboard.ts:455-472`
- Modify: `src/ui/session-detail.ts:28-46`
- Modify: `src/ui/session-detail.test.ts:1-117`
- Modify: `src/ui/dashboard.test.ts:1-52`
- Modify: `src/orchestration/supervisor.test.ts:52-103` for persisted pin snapshot assertions if needed

### Implementation notes

1. In `togglePinnedSummary()`:
   - use `session.summary.trim()` as the pin candidate
   - do **not** use `session.latestText`
2. Preserve current one-pin-per-session behavior by continuing to store a single `pinnedSummary?: string`.
3. Decide and document the key semantics in the UI:
   - if pinned exists and user presses `p`, unpin it
   - if no pinned snapshot exists and `session.summary.trim()` is non-empty, pin it
   - if no live summary exists, show a lightweight `ctx.ui.notify(...)` info/error message and leave state unchanged
4. Add explicit notifications:
   - pin success: include a short clipped version of the frozen summary
   - unpin success: “Pinned summary removed”
   - no-op: “No live summary available to pin”
5. In `renderSessionDetailLines()`:
   - `Live summary:` should always show `session.summary`
   - `Pinned summary:` should render separately only when present
   - never replace the live summary line with the pinned one
6. Keep overview rows preferring `pinnedSummary ?? summary`, per spec.

### Testing expectations

```bash
npm test -- src/ui/session-detail.test.ts src/ui/dashboard.test.ts
```

Expected:
- PASS
- Tests show `Live summary:` and `Pinned summary:` as separate lines
- Tests confirm pinning uses the summary snapshot, not transient latest text

Then validate persistence coverage:

```bash
npm test -- src/orchestration/supervisor.test.ts src/ui/persistence-behavior.test.ts
```

Expected:
- PASS
- Pinned snapshot persists across load/save

### Verification checklist

- Live summary keeps changing after pinning without mutating the pinned text.
- Re-pinning replaces the old snapshot.
- Unpinning is explicit.
- Empty/no-summary pin attempts do not silently fail.

---

## Task 3: Strengthen “needs attention” signaling in overview rows

**Outcome:** A quick scan makes “needs me” visually and textually stronger than “currently busy.”

**Deliverables:**
- More explicit operator-facing labels for `awaiting-input`, `blocked`, and `failed`.
- Running rows still look active, but less urgent than attention states.
- Overview tests proving the wording and priority presentation.

**Likely files:**
- Modify: `src/ui/overview.ts:35-65`
- Modify: `src/ui/overview.test.ts:1-88`

### Implementation notes

1. Update the band order in overview-related constants to match the spec exactly:
   - `awaiting-input`
   - `blocked`
   - `failed`
   - `running`
   - `idle`
   - `done`
2. Refine status badges/text so attention states read as operator-facing, not just descriptive.
   Example direction:
   - `◉ needs input`
   - `◆ needs attention`
   - `✖ needs attention`
   - `● running`
   - `○ idle`
   - `✓ done`
3. Adjust row summary wording for attention states:
   - `awaiting-input`: preserve the question/request text where possible
   - `blocked`: prefer error/reason text
   - `failed`: prefer failure/error text
4. Keep this as a rendering-only refinement. Do **not** add new panels, filters, or sort modes.
5. Make sure the stronger wording works in plain text without depending on color alone.

### Testing expectations

```bash
npm test -- src/ui/overview.test.ts
```

Expected:
- PASS
- Attention rows contain explicit “needs” wording
- Running rows still render as active but not urgent

### Verification checklist

- Attention-state rows are recognizable even in monochrome terminals.
- “Needs me” rows stand out more than “running” rows.
- The overview alone is enough to spot the most urgent session.

---

## Task 4: Make the selected-session summary view more actionable

**Outcome:** The detail panel answers “what is it doing, does it need me, what changed, and what summary should I trust?” without opening transcript view.

**Deliverables:**
- Detail view split into stable, distinct concepts:
  - status
  - live summary
  - pinned summary
  - current activity
  - latest update
  - recent activity
- Helper logic that treats “latest update” as a meaningful operator-visible event, not just streaming churn.

**Likely files:**
- Modify: `src/ui/session-detail.ts:4-100`
- Modify: `src/ui/session-detail.test.ts:1-117`
- Modify: `src/types/workbench.ts` only if a small helper type is needed
- Possibly modify: `src/orchestration/activity.ts` if the recent-activity filtering needs a shared helper

### Implementation notes

1. Rework the detail header/body lines so they are explicit and stable. A good target shape is:

   - `STATUS · current tool`
   - `Name: ...`
   - `Task: ...`
   - `Live summary: ...`
   - `Pinned summary: ...` (only if present)
   - `Current activity: ...`
   - `Latest update: ...`
   - `Error: ...` (when blocked/failed)
   - metadata lines (`Model`, `Path`, `Tags`, `Files`, etc.)
   - `Recent activity:`

2. `Current activity` should come from:
   - `session.currentTool` when present
   - otherwise a compact status-derived phrase such as “waiting for input”, “blocked”, “idle”, etc.
3. `Latest update` should come from the most recent meaningful activity in `activities`, not blindly from `latestText`.
4. Exclude noisy entries from “Latest update” where they are clearly just streaming churn.
   - Current likely rule: ignore plain `message_streaming` entries unless a later task explicitly marks them as intervention-related.
5. Keep transcript/log modes unchanged except for any helper extraction that avoids duplication.

### Testing expectations

```bash
npm test -- src/ui/session-detail.test.ts
```

Expected:
- PASS
- Tests show separate `Live summary`, `Pinned summary`, `Current activity`, and `Latest update` lines
- Summary mode remains transcript-light and readable

Then run a broader UI pass:

```bash
npm test -- src/ui/overview.test.ts src/ui/session-detail.test.ts src/ui/dashboard.test.ts
```

Expected:
- PASS

### Verification checklist

- Pinned summary no longer obscures the live summary.
- The detail panel still works cleanly for historical sessions.
- A routine check can be done without opening transcript mode in the common case.

---

## Task 5: Add explicit intervention lifecycle feedback

**Outcome:** After `steer`, `follow-up`, or `abort`, the operator can tell whether the action was accepted locally, whether it is still pending observation, whether it has been observed in later session activity, or whether submission failed.

**Deliverables:**
- Lightweight persisted metadata for the most recent intervention per session.
- Supervisor logic for lifecycle states:
  - `sent`
  - `pending-observation`
  - `observed`
  - `failed`
- Detail panel rendering for the most recent intervention.
- Explicit notifications for success/failure.
- Tests covering lifecycle transitions and persistence.

**Likely files:**
- Modify: `src/types/workbench.ts:23-63`
- Modify: `src/orchestration/supervisor.ts:146-177, 231-242, 342-359`
- Modify: `src/ui/session-detail.ts:28-100`
- Modify: `src/ui/dashboard.ts:348-407`
- Modify: `src/orchestration/supervisor.test.ts`
- Modify: `src/ui/session-detail.test.ts`
- Modify: `src/persistence/schema.ts` if new session metadata is persisted and needs parsing coverage
- Modify: `src/persistence/schema.test.ts` if the new fields are added to persisted session shape

### Implementation notes

1. Add a small typed session field in `src/types/workbench.ts`, for example:

   - `lastIntervention?: {`
     - `kind: "steer" | "followup" | "abort"`
     - `text: string`
     - `status: "sent" | "pending-observation" | "observed" | "failed"`
     - `requestedAt: number`
     - `observedAt?: number`
     - `errorMessage?: string`
     - `summary: string`
   - `}`

   Keep it lightweight and per-session only.

2. In `steerSession()`, `followUpSession()`, and `abortSession()`:
   - on local submission start or immediate local acceptance:
     - write `lastIntervention.status = "sent"`
     - store the action text/summary and timestamp
   - after the local command returns success to the dashboard flow:
     - transition `lastIntervention.status` to `"pending-observation"`
     - show an explicit local confirmation notification
   - on local failure or thrown error:
     - write `lastIntervention.status = "failed"`
     - store the error message
     - show an explicit failure notification
3. Keep only the **most recent** intervention as special UI state.
4. Use the recent activity stream as the observation source of truth:
   - when `handleSessionEvent()` receives a newer meaningful non-local activity after `requestedAt`, mark the session’s `lastIntervention` as `observed`
   - do **not** let the local intervention log entry clear pending by itself
   - do **not** let streaming token churn or summary refreshes clear pending
5. If needed, extend `WorkbenchActivity` with a tiny metadata field like `origin?: "session" | "operator"` or `meaningful?: boolean` so the observation rule is testable and explicit.
6. In `renderSessionDetailLines()` add a section such as:

   - `Latest intervention: Steer — pending observation`
   - `Intervention text: ...`
   - `Observed after: ...` or `Failure: ...`

7. Do not invent backend queue guarantees. Wording should stay local and honest:
   - “accepted locally”
   - “pending observation”
   - “observed in session activity”
   - “failed locally”

### Testing expectations

Run the focused persistence + lifecycle suite:

```bash
npm test -- src/orchestration/supervisor.test.ts src/persistence/schema.test.ts
```

Expected:
- PASS
- Tests cover:
  - successful steer/follow-up/abort entering `sent` then `pending-observation`
  - later meaningful activity marking observed
  - failed submission surfacing explicit failed state
  - persistence round-trip for intervention metadata

Then verify rendering:

```bash
npm test -- src/ui/session-detail.test.ts src/ui/dashboard.test.ts
```

Expected:
- PASS
- Detail panel shows the latest intervention clearly
- Failure and observed states render differently

### Verification checklist

- Submitting an intervention immediately produces explicit local feedback.
- Pending does not clear until later non-local meaningful activity arrives.
- Old activity or local action logs do not incorrectly mark the intervention observed.
- Failed submissions do not disappear silently.

---

## Final verification pass

After all five tasks are complete, run the full project checks:

```bash
npm test
npm run check
```

Expected:
- All Vitest suites PASS
- TypeScript check PASS with no new type errors

### Manual verification pass in the dashboard

Use the real workbench and confirm:

1. Two concurrently running sessions no longer swap places on minor updates.
2. A session moving to `awaiting-input`, `blocked`, or `failed` rises above `running`.
3. Pinning freezes the exact current live summary and survives restart.
4. The overview clearly differentiates “needs me” from “running”.
5. The detail panel shows live summary, pinned summary, current activity, and latest update as separate concepts.
6. After `steer`, `follow-up`, and `abort`, the latest intervention visibly progresses from local acceptance to pending observation to observed when later session activity arrives.

---

## Suggested commit breakdown

Use one commit per task minimum:

1. `git commit -am "Stabilize workbench overview ordering by status band"`
2. `git commit -am "Clarify workbench pinned summary snapshot behavior"`
3. `git commit -am "Strengthen workbench needs-attention overview signaling"`
4. `git commit -am "Make workbench session detail summaries more actionable"`
5. `git commit -am "Add explicit intervention lifecycle feedback to workbench"`
