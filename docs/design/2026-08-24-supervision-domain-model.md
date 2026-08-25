# Supervision domain model

Resolves [#4](https://github.com/andybarilla/jackdaw/issues/4). Vocabulary is defined in
[`CONTEXT.md`](../../CONTEXT.md); this document gives entities, lifecycles and events.

Inputs: `~/.claude/agents/{supervisor,project-lead,lead-talostitle,ic-*}.md` and
`~/.claude/commands/status.md`. Every constraint below traces to a documented failure in
one of those, cited inline.

## Shape

Three stores, deliberately separate, sharing one subscription mechanism.

| Store | Holds | Retention |
|---|---|---|
| **Fleet state** | machines, agents, sessions, roles, projects, workspaces, leases | current, plus session history |
| **Durable record** | rooms and posts, handoffs, interventions | kept |
| **Event log** | machine-observed facts | bounded window, cursor replay |

The split is load-bearing. A post has an author, an audience and per-member read state;
an event has none of those and is high-volume. Merging them makes events inherit delivery
semantics they do not need, or posts inherit a retention window they cannot survive.

## Entities

### Machine
`id`, `name`, `reachable_at`, `last_seen`, `daemon_version`.

One daemon each. Agents, workspaces and roles are all located on a machine, so `apbmbp`
is a first-class location rather than a mirror — the fix for herdr's mirrored panes, which
all report `cwd` as `.mirror-pane` and are therefore indistinguishable from each other.

### Project
`name`, `source_root`, `tracker_binding`, `workspace_root`, `room`, `expected_roles[]`.

The join key. `expected_roles` is what makes a roster checkable: `supervisor.md`'s roster
is currently "the leads that should be running", which exists only in the supervisor's head
and is lost on restart.

`tracker_binding` names a tracker adapter and a project id within it. GitHub is the first,
not the only one.

### Role
`name_pattern`, `prompt_file`, `machine`, `supervision_policy`.

The prompt file is read per turn, not once at startup — an edit lands mid-session. Jackdaw
distributes it; `~/.claude/` is not shared between machines, and hand-md5-syncing has
already failed silently once.

**Supervision policy** holds only what Jackdaw acts on:
- `idle_threshold` — minutes for an IC, days for an effort. `supervisor.md` warns the local
  threshold must not be applied to a TalosTitle effort.
- `restart` — whether to restart on death, and whether to require a handoff first.
- `startup` — the choreography. This is the largest chunk of the role files that should not
  be prose: the trust prompt and its `send-keys enter`, wait-until-idle, prompt, and
  **verify the prompt actually landed** because a remote `agent prompt` returns success for
  a prompt that never arrived.

Escalation triggers stay in markdown. Every one in `supervisor.md` is a judgment call about
whether something has moved.

### Agent and Session
**Agent**: `name`, `machine`, `role`, `project`, `current_session`.
**Session**: `id`, `agent`, `started_at`, `ended_at`, `pane_ref`, `inherited_from`.

Name is the **address**; session id is the **identity**. "The same lead has died twice in a
row" is a supervisor escalation trigger that a name-as-identity model cannot express.
`inherited_from` links a restarted session to its predecessor, which is where the
restart-with-handoff flow lives.

`pane_ref` is a Jackdaw-minted UUID, not a tmux pane id: tmux ids reset to `%0` and pane
options die on `kill-server` ([#3](https://github.com/andybarilla/jackdaw/issues/3)).

Agent state is **not a field**. It is derived from the event log, which is what gives idle
*duration* — herdr has no such field, so `supervisor.md` tracks status across its own passes
to tell a resting agent from a stuck one.

### Workspace
`path` (identity), `machine`, `kind`, `project`, `branch?`, `created_at`.

Path is the identity because it is the fact that survives an agent nobody named properly.
`supervisor.md` is explicit: an effort started by hand never learns the naming convention and
would otherwise vanish from the roster.

`kind` distinguishes a git worktree from an effort tree — lifespan and idle semantics differ,
and that is a field, not a separate entity. The TalosTitle flow is a *configuration* of this,
not the basis for it.

**Stranded** — no live agent whose cwd is under the path — is a derived state, not a stored
one. Three effort trees were sitting stranded when `supervisor.md` was written.

### Room and Post
**Room**: `project`, `members[]`, `cursors[]`.
**Post**: `id`, `room`, `author`, `body` (≤700 chars), `posted_at`.

> **Corrected 2026-08-25** against the working implementation, read in
> [#10](https://github.com/andybarilla/jackdaw/issues/10). `Post.read_by[]` is gone; read state
> is a **per-member cursor** on the room. Membership stays stored and explicit, which is where
> the model was already right and the implementation is wrong. Both changes are argued below.

Agent-to-agent, grouped by project. Leads, ICs and project-level skills talk through their
project's room; the supervisor is a member of every room, which is a membership fact rather
than a special case in delivery.

**Membership is stored, never derived.** Scuttlebutt derives it from an agent's cwd, and that
is a live defect rather than a shortcut: the supervisor sits at `~`, matches no group, and is
therefore in **no room on any daemon start in the whole log** — the exact opposite of the
guarantee above. An IC in a workspace the derivation does not recognise is silently in no room
either, which is the same failure wearing different clothes. A membership you cannot enumerate
is a membership you cannot check.

**Read state is a per-member cursor, not `read_by[]` on the post.** The implementation keeps a
high-water mark per member and is right to; a list on every post grows with every member on
every post, and — the reason that matters here — it cannot express *falling behind* at all,
which this document makes the load-bearing guarantee of the subscription mechanism. One cursor
per member per room answers "what have you not seen" and "have you aged out" with the same read.

**A cursor must survive its member's absence.** This is the mechanism of the 2026-08-24 orphan,
and it is a rule rather than an implementation note. Scuttlebutt purges a member ~6 seconds
after it stops appearing in the agent list and, on return, reseeds its cursor at the room's
**current tail** — so every post made while it was away is skipped in silence. Any real restart
exceeds six seconds, so the reset always wins. The log survived; the cursor did not. A member
that returns resumes from its cursor or is **told it fell behind**; those are the only two
outcomes, and silently advancing to the tail is neither.

Delivery-on-idle is a **subscription mode**, not a property of the store: a post is delivered
to a member when that member goes idle. That is what makes the room the backstop for
"nothing wakes a lead" — and why it survives a lead restart, where an `agent wait` shell
does not (it dies with the session that started it; an IC was orphaned this way on
2026-08-24).

### Handoff
`id`, `author`, `holder?`, `subject`, `state`, `history[]`.

States: `open` → `held` → `accepted`, with `held` → `returned` → `held`.

`returned` is the transition that earns its place: "the gate failed, findings sent back to
the IC that did the work" is a documented loop with no record today, and `project-lead.md`
escalates on *the gate having failed twice on the same handoff* — a count only a rejection
transition can produce.

Jackdaw does **not** record that a gate passed. The role files are explicit that the lead
runs the gate and never accepts a self-review claim; a recorded pass invites trusting it.

`open` with no holder is the queryable form of the failure this entity exists for.

### Intervention
`id`, `project`, `agent`, `what`, `run`, `check`, `created_at`, `resolved_at?`.

One queue, on one authoritative daemon — one human, one list. Today the file lives on
`apbfw16` and `lead-talostitle` SSH-appends to it from `apbmbp`, unlocked, with concurrent
writers.

`check` keeps its closed vocabulary — `path-absent`, `path-present`, `process-gone`,
`issue-closed`, `pr-merged`, `branch-gone` — and stays **interpreted, never executed**.
Agents write these entries; the content is untrusted input.

Evaluation moves to the daemon on a timer. Entries then clear themselves whether or not
anyone runs `/status`, which is the stated intent and is not achieved today. An entry whose
check cannot be evaluated is never dropped — it is kept and marked, so it reads as stale
rather than live.

### Lease
`resource`, `holder` (session id), `acquired_at`, `expires_at`, `last_renewed_at`.

One noun over three ad-hoc locks: the branch lane (`canonical-worktree claim/release`,
single-occupancy, refuses dirty-or-unpushed release), the claim-a-ticket-by-assignment
convention, and the pane write interlock.

They share the failure that matters — a holder that dies without releasing. `lead-talostitle`
puts it plainly: a lane you never release is a branch nobody else can use. Expiry plus a
holder that is a *session id* makes that detectable once instead of three times.

**Expiry advances detection; it never grants.** A live holder renews, and an expired lease
marks the resource as *suspect* rather than free. A branch lane is legitimately held for
hours — `canonical-worktree` has no expiry today for exactly that reason, and its `release`
refuses dirty-or-unpushed work by design. A lease that expired under a live holder and was
then reissued would produce the measured defect verbatim: on 2026-08-17 a session committed
onto another session's branch with **no error**, and the work landed in the wrong PR.
Reclaiming a suspect lease is a separate act with its own check that the holder is really
gone.

The pane interlock is the urgent one. [#3](https://github.com/andybarilla/jackdaw/issues/3)
proved tmux offers nothing here — `attach -r` is client-scoped and does not block
`send-keys` — and the hazard reproduces verbatim: agent text and human keystrokes concatenate,
turning `/exit` into `restart the session/exit`.

### Projection
Per record: `source`, `fetched_at`, plus the foreign payload.

Read-only, staleness-stamped, **never written back**. That discipline is what keeps the
tracker authoritative while still letting the console answer questions that require joining
against it.

Every attention condition in `/status` is such a join: a dirty workspace with no live agent;
commits ahead of upstream with no open PR; an `issue-<n>` workspace whose issue is already
closed; an open assigned issue with no workspace and no agent. None is answerable from fleet
state alone.

A live-query design was rejected: it makes the console as slow as its slowest tracker call,
runs into rate limits with several projects and a supervisor polling, and cannot answer
"what changed since my last pass" — which is the supervisor's actual question.

## Events

An event is `(id, seq, at, machine, subject, kind, payload)`. Subjects are agents, sessions,
workspaces, handoffs, leases.

Kinds, at minimum: `session_started`, `session_ended`, `agent_state_changed`,
`workspace_created`, `workspace_removed`, `handoff_opened`, `handoff_held`,
`handoff_returned`, `handoff_accepted`, `lease_acquired`, `lease_released`, `lease_expired`,
`intervention_filed`, `intervention_resolved`, `projection_refreshed`.

**Subscription:** each subscriber holds a cursor. Reconnect replays from it. Events age out
of a bounded window, and a subscriber whose cursor has aged out is **told it fell behind**.

That signal is the load-bearing part. Live-only delivery recreates the bug being fixed — a
supervisor that reconnects and cannot see the IC that finished while it was away is exactly
the orphaned-handoff failure. Silently missing events is worse than knowing you missed them.

The durable things worth keeping forever — posts, handoffs, interventions — are in the
durable record, which is why the event window can be bounded at all.

## What this model does not settle

- **Reboot reconstruction.** Nothing in tmux survives a reboot, so rebuilding the fleet from
  these stores is a correctness requirement. What is reconstructable and what a
  half-reconstructed fleet looks like are open.
- **Writer interlock in practice.** `Lease` gives the model; it does not give an enforcement
  point, since tmux has none.
- **The normalized session-artifact model**, which is a projection of a different kind.
