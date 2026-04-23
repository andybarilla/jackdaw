# Pi workbench prototype decision memo

Date opened: 2026-04-15  
Plan: `docs/superpowers/plans/2026-04-15-pi-workbench-mvp.md`  
Spec: `docs/superpowers/specs/2026-04-15-pi-workbench-design.md`

Use this after the one-week trial to make a clear call on the next investment.

## Decision

Choose one:

- [ ] **Continue** — invest in a standalone pi SDK app now
- [x] **Iterate** — keep improving the pi-native prototype before making the SDK jump
- [ ] **Stop** — do not continue this direction; fold learnings back into Jackdaw

## Short answer

- Final recommendation: Iterate
- One-sentence reason: Early real usage says the session-first model is better than transcript-first Jackdaw for routine monitoring, but the rough edges are still polish issues that should be fixed before making the SDK jump.

## Evidence summary

### Success metrics

| Metric | Target | Result | Notes |
| --- | --- | --- | --- |
| Monitor 3-5 sessions from one overview | yes | yes | Two early usage days covered 3 sessions at a time without falling back to terminal panes for routine checks. |
| Identify the session needing attention in under 10 seconds | yes | yes | Early usage notes indicate the right session was identifiable quickly from structured state. |
| Routine checks handled without transcript details | at least 80% | 6 / 6, 100% in the first two days | Strong early signal, small sample size. |
| `steer`, `follow-up`, and `abort` each reachable through an obvious path | yes | mixed | Steering was clearly validated. Follow-up and abort exist, but were less directly exercised in the real-usage notes so far. |
| Pinned summaries, editable session names, and session tags usable in practice | yes | mixed | Useful enough to keep, but pinning semantics were confusing enough to trigger a polish cycle. |

### Before vs. current Jackdaw

- How current Jackdaw usually works for routine status checks: scan terminal panes, guess which session looks suspect, then open raw transcript or terminal output to confirm what is happening.
- What was faster or calmer in the prototype: the overview made routine monitoring mostly transcript-free, and steering felt faster because the action path was explicit instead of hidden inside terminal context.
- What was worse than current Jackdaw: concurrent updates caused list flicker, pinning semantics were muddy, and the overview still needed better separation between active work and genuine operator attention.
- Did the prototype reduce raw transcript checking? yes
- Did the prototype improve speed of intervention? yes

### Shell fallback

- Number of shell fallback moments: 0 in the first two real usage days
- Which fallback moments were acceptable escape hatches: none were needed yet
- Which fallback moments reveal a product gap: none observed so far, though that is still early and should not be oversold

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

- 3 of 3 routine checks were handled without transcript details on both initial trial days.
- The prototype generated specific, grounded follow-on feedback about list flicker, pinning clarity, and attention signaling. That is what real use looks like. The work stopped being hypothetical and started getting annoyingly specific.

### Strongest evidence against the prototype

- Pinning was not yet trustworthy enough during fast-moving state.
- Overview ordering flickered when multiple sessions updated close together, which undercuts the whole point of having a calm summary-first dashboard.
- Real usage evidence for follow-up and abort is still thinner than for steering.

### Moments where shell fallback was required

- None in the first two real usage days.

## Final memo

- The core bet looks right. A session-first workbench is already better than transcript-first Jackdaw for routine monitoring.
- Early usage was strong enough to show 6 of 6 routine checks handled without opening transcript details. Small sample, yes. Still real.
- Steering already feels like a better operator action than the old terminal-first loop.
- The main failures were not model failures. They were UI trust failures: list flicker, muddy pinning behavior, and not enough separation between "active" and "needs me".
- Shell fallback was not needed in routine monitoring, which is a very good sign for the whole premise.
- This does not justify jumping straight to a standalone SDK app yet.
- It does justify another polish cycle inside the current pi-native surface.

## Provisional note before the one-week trial

Current status: **early validation complete, broader validation still optional**. Tasks 1-8 created the prototype surface, and the first two real usage days were enough to support an iterate decision. More usage would improve confidence, but the decision is no longer based on theory alone.
