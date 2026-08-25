# The fleet console

Resolves [#11](https://github.com/andybarilla/jackdaw/issues/11). Vocabulary is defined in
[`CONTEXT.md`](../../CONTEXT.md); the entities this builds on are in
[the supervision domain model](./2026-08-24-supervision-domain-model.md).

Inputs: `~/.claude/commands/status.md` (a hand-written version of this screen),
`~/.claude/agents/{supervisor,project-lead}.md`. Every condition and every rule below traces
to a documented failure in one of those, cited inline.

## Shape

**The daemon owns one attention query.** The console, `/status`, `supervise` and `lead` are
all clients of it, differing only by filter — project scope, machine scope, and a since-cursor
— and by rendering.

Three prose reimplementations of "what needs attention" is what the role files already are,
and their drift is the reason they read as a battle log. Every condition is a join across
fleet state, the durable record, the event log and projections; the daemon does that join
anyway.

The query returns **findings**.

### Finding

`id`, `condition`, `subject`, `rank`, `since`, `evidence`, `acknowledged?`

- **`subject`** is polymorphic over fleet nouns — `Agent`, `Session`, `Workspace`, `Handoff`,
  `Lease`, `Machine`, `Project` — **and over a projection record**, addressed by
  `source` + foreign id. Three conditions have no fleet subject at all (an assigned issue with
  no workspace, a fresh unlabelled issue, a closed issue whose workspace lives). Attaching
  those to their `Project` would bury three real conditions under a project row where they
  cannot be acknowledged or drilled into individually — and `status.md` argues the
  unlabelled-issue case is *invisible to every queue-depth query*, so the tracker's own views
  are exactly where it cannot be seen.
- **`since`** — how long this has been true. The ranking tiebreak rests on it, and it is why
  a finding is a record rather than a filtered event view.
- **`evidence`** — the facts that triggered the condition. Rendered in finding-detail, and the
  basis for acknowledgement (below).

Findings are **not** a view over the event log. Most conditions are the *absence* of something
— no live agent, no open PR, no holder — and absences emit no events.

### Derived, or computed

Conditions split, and the split is by whether history is in the condition:

| | Held how |
|---|---|
| Pure functions of current state — *stranded*, *unheld handoff*, *suspect lease*, *ahead with no PR* | Computed at query time |
| Anything with a duration or a count — *idle past threshold*, *dead twice in a row*, *gate failed twice*, *unheld past its duration* | **Materialized** by the daemon |

A condition with history in it cannot be computed from a snapshot. `supervisor.md` tracks
exactly these by hand across its own passes, because nothing stores them.

Materialized conditions emit **`attention_raised`** and **`attention_cleared`** events — a
delta to the kind list in the domain model, not a reopening of it. The since-cursor is then an
ordinary event subscription with the fall-behind guarantee already specified. A client-side
diff of two result sets, or a `first_seen > cursor` filter, both silently drop a finding that
appeared *and cleared* between two reads — which is precisely how a transient stuck agent goes
unnoticed.

### Passes are durations

Three conditions in the role files are defined in terms of the supervisor's polling cadence:
blocked work unmoved *between two passes*, a handoff unheld *across two passes*, an effort
idle and unmentioned *across two passes*. Jackdaw is continuous; there are no passes.

Each becomes a **duration**, taken from the role's `supervision_policy`. The pass was always a
proxy for elapsed time and a poor one — a supervisor on a slow loop and one on a fast loop
mean different things by "two passes", which is why `supervisor.md` needed a hand-written
warning not to apply the local idle threshold to a TalosTitle effort. Per-role policy gives an
effort and an IC different numbers with no special case.

## The catalogue

Ranked, top to bottom. The order is **fixed and hardcoded**, with `since` as the tiebreak
within a rank. A computed severity score invites arguing with the number and hides *why*
something is top; a fixed list is auditable, and "uncommitted work with nobody on it" outranks
"fresh issue with no label" permanently rather than situationally. Per-project configurable
order was rejected: it is a knob nobody tunes, and it makes two consoles disagree about
severity.

| # | Condition | Subject | Source |
|---|---|---|---|
| 1 | Uncommitted work with no live agent — stranded | Workspace | `status.md` |
| 2 | Machine or source blind past its blindness threshold | Machine / Projection | new (#11) |
| 3 | Agent not `working` while its workspace is dirty | Agent | `status.md` |
| 4 | Commits ahead of upstream with no open PR | Workspace | `status.md` |
| 5 | Unheld handoff past its duration | Handoff | `supervisor.md` |
| 6 | Gate failed twice on one handoff | Handoff | `project-lead.md` |
| 7 | Suspect lease — expired, holder unverified | Lease | #4 |
| 8 | Agent dead twice in a row | Agent | `supervisor.md` |
| 9 | Effort tree with no live session | Workspace | `supervisor.md` |
| 10 | Expected role missing from the roster | Project | #4 (`expected_roles`) |
| 11 | Blocked work unmoved past its duration | Agent | `supervisor.md` |
| 12 | Subscriber fell behind | Agent | #4 |
| 13 | `issue-<n>` workspace whose issue is closed | Workspace | `status.md` |
| 14 | Open assigned issue with no workspace and no agent | Projection | `status.md` |
| 15 | Fresh issue with no triage-state label, bounded to 7 days | Projection | `status.md` |

Two are new against the prose version. **Expected role missing** is what `expected_roles` was
added for — a lead that never came back is otherwise invisible, since a roster that lives in
the supervisor's head cannot be checked after the supervisor restarts. **Subscriber fell
behind** ranks low because it degrades a client, not the work.

**Rank 2 above rank 3 is the load-bearing placement.** A known-bad state is bounded; a blind
spot is not. `apbmbp` unreachable for an hour is stranded work you cannot see, and
`status.md`'s most emphatic rule exists because that outage once read as an all-clear.

## Not knowing

**The console never renders an empty set that could be an unknown set.** Absence is displayed
as absence only when the source was actually reached.

`status.md` states this for one case — a failed SSH probe and an empty agent list must read
differently, because an outage and "nothing is running" look identical downstream and only one
is safe to ignore. #4 added two more unknowns: a projection stale by its `fetched_at`, and a
subscriber that fell behind.

It renders **both ways**:

- **Inline** — unknown is a first-class value. A machine's agent list, a projection's payload,
  an agent's derived state can each be `unknown`, and the row says so where the value would be.
- **A banner** — when a whole source is down, listing every degraded source above the screen.

A *momentary* degradation stops there. A degradation past its **blindness threshold**
additionally raises a finding at rank 2, because at that point it is a fault someone must fix
rather than a caveat on the reading. The threshold has an owner per subject kind:

- **`Machine`** — daemon config, alongside the mesh's peer settings. `supervision_policy` does
  not cover it; a machine has no role.
- **`Projection`** — a multiple of the adapter's own declared staleness threshold (below), so
  a source that refreshes in seconds and one that refreshes in minutes are not held to one
  number.

A subscriber that fell behind is subjected to the **`Agent`** holding the cursor — the
supervisor or lead whose view has a hole in it. `Subscriber` is not a noun; it is a role an
agent plays against the event log.

### Staleness

Every projection record carries `fetched_at`. The console **always renders the age**, and
additionally marks the record stale past a **per-source threshold**. A boolean and a raw age
answer different questions and the console is cheap enough to show both. Per-source is
necessary: a 60-second-old tracker projection is fine, a 60-second-old git status during active
work is not.

The threshold belongs to the **adapter**, which knows its own refresh cadence. Recorded here as
a requirement on [#9](https://github.com/andybarilla/jackdaw/issues/9), not settled here.

## Acknowledgement

A finding can be **acknowledged** — muted until its material evidence changes, then it returns
unmuted.

`status.md` has no such tool: every pass re-reports a finding you have already judged, which is
how a report trains its reader to skim. The deliberate long-lived case is real — an effort tree
parked for a week, a branch lane legitimately held for hours, which is why
`canonical-worktree` has no expiry today.

Each condition declares which `evidence` fields are **material** — a branch's head commit, the
dirty-file count, a handoff's state. Only a change in those unmutes. Hashing the whole evidence
payload unmutes on noise (a `fetched_at` bump, one file's churn in a workspace you parked) and
puts the reader straight back to skimming; the declaration doubles as documentation of what the
condition actually watches. An acknowledgement also carries a **max age**, so nothing is muted
forever.

## The screen

**Attention-first.** The ranked finding list is the top of the screen; the per-project roster
sits below it. `status.md` calls its Needs-attention section "the point of the whole command"
while placing it last — an ordering that made sense for a linear text report and does not for a
surface that is always on screen.

Above both, and above the attention list: **Needs you** — the intervention queue. Interventions
stay a separate block and always outrank findings. They are a different kind of claim on the
reader: a finding says the fleet is in a bad state, an intervention says *you personally are
the blocker*. Merging them produces one list nobody but the human can act on. `status.md`'s
rule carries over verbatim — an entry whose `check` cannot be evaluated is kept and marked, so
it reads as stale rather than live, never dropped.

### The all-clear

With no findings, the attention region **collapses to one explicit all-clear line** and the
roster expands to fill the screen.

`status.md` insists on saying "nothing needs attention" plainly rather than padding — advice a
dashboard cannot take literally by skipping a section, because it is always on screen. The
intent is that *the absence of findings is stated, not inferred from empty space*: an empty
region is indistinguishable from a console that failed to load, which is the not-knowing rule
applied to the console's own output. A tab with a count badge hides the all-clear behind a
number you have to trust.

### Drill-down

Five detail views:

- **Finding** — the evidence, and why it ranks where it does. *This is the one that must not be
  cut.* Without it the ranking is a black box the reader either trusts blindly or ignores.
- **Agent** — session history, the `inherited_from` chain, its events.
- **Workspace** — git state, branch, the agent on it, its issue.
- **Handoff** — author, holder, and the `returned` history.
- **Project** — live roster against `expected_roles`, the room's posts, queue depth. The room
  lives here rather than needing a surface of its own
  ([#10](https://github.com/andybarilla/jackdaw/issues/10)).

## The console does not write

Read-only, **plus acknowledgement**. Nothing else.

Every further write collides with the interlock the map calls a correctness problem and that
[#3](https://github.com/andybarilla/jackdaw/issues/3) proved tmux cannot enforce: a restart
button is a write to a pane a human may be typing in, and agent text concatenated with human
keystrokes turns `/exit` into `restart the session/exit`.

Attach renders as the exact `tmux attach` command to run — prefixed with the `ssh` invocation
for a remote machine.

## Across the mesh

The console connects to **one daemon, which fans out to its peers and merges**.

`status.md`'s TalosTitle section is this problem solved badly by hand over SSH. The fan-out
must live somewhere that can attach a per-machine reachability verdict to the merge; a
client-side merge makes every client reimplement the unreachable-vs-empty rule that has already
produced false all-clears. Which daemon is "the" one is a mesh-topology question, left to the
mesh work.

## Constraints this places on other tickets

- **[#6, the CLI](https://github.com/andybarilla/jackdaw/issues/6).** `/status` is a client of
  this query, and the console renders commands for the human to run — those commands are
  Jackdaw CLI invocations. The CLI's output contract and the console's are one contract.
- **[#9, the tracker adapter](https://github.com/andybarilla/jackdaw/issues/9).** An adapter
  declares its own staleness threshold. A projection record must be addressable as a finding
  subject by `source` + foreign id.
- **The domain model.** Two event kinds added: `attention_raised`, `attention_cleared`.
