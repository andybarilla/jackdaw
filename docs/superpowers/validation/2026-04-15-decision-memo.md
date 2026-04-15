# Pi workbench prototype decision memo

Date opened: 2026-04-15  
Plan: `docs/superpowers/plans/2026-04-15-pi-workbench-mvp.md`  
Spec: `docs/superpowers/specs/2026-04-15-pi-workbench-design.md`

Use this after the one-week trial to make a clear call on the next investment.

## Decision

Choose one:

- [ ] **Continue** — invest in a standalone pi SDK app now
- [ ] **Iterate** — keep improving the pi-native prototype before making the SDK jump
- [ ] **Stop** — do not continue this direction; fold learnings back into Jackdaw

## Short answer

- Final recommendation:
- One-sentence reason:

## Evidence summary

### Success metrics

| Metric | Target | Result | Notes |
| --- | --- | --- | --- |
| Monitor 3-5 sessions from one overview | yes |  |  |
| Identify the session needing attention in under 10 seconds | yes |  |  |
| Routine checks handled without transcript details | at least 80% |  |  |
| `steer`, `follow-up`, and `abort` each reachable through an obvious path | yes |  |  |
| Pinned summaries, editable session names, and session tags usable in practice | yes |  |  |

### Before vs. current Jackdaw

- How current Jackdaw usually works for routine status checks:
- What was faster or calmer in the prototype:
- What was worse than current Jackdaw:
- Did the prototype reduce raw transcript checking? yes / mixed / no
- Did the prototype improve speed of intervention? yes / mixed / no

### Shell fallback

- Number of shell fallback moments:
- Which fallback moments were acceptable escape hatches:
- Which fallback moments reveal a product gap:

## Recommendation rubric

### Choose **Continue** if most of these are true

- the under-10-second attention test was met consistently
- at least 80% of routine checks stayed out of transcript details
- shell fallback was occasional rather than routine
- the remaining gaps look like presentation/polish problems, not model problems
- the prototype clearly feels better than terminal-pane monitoring

### Choose **Iterate** if most of these are true

- the direction feels right, but one or two key metrics were inconsistent
- the overview is useful, but summaries/statuses/actions still need tuning
- shell fallback happened often enough to matter, but not so often that the concept failed
- the main blockers appear fixable inside the current pi-native surface

### Choose **Stop** if most of these are true

- the prototype did not reliably beat current Jackdaw habits
- transcript checking remained necessary for routine monitoring
- the user still had to think in terminal panes rather than structured session state
- intervention actions were not materially clearer or faster
- shell fallback became a normal requirement instead of an escape hatch

## Key examples

### Best proof that the prototype worked

-

### Strongest evidence against the prototype

-

### Moments where shell fallback was required

-

## Final memo

Write 4-8 bullets only.

-
-
-
-

## Provisional note before the one-week trial

Current status: **pending validation**. Tasks 1-8 created the prototype surface, but this memo should not be finalized until the usage log and checklist are filled with real session evidence.
