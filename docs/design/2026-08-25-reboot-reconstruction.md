# Reboot reconstruction

Resolves [#14](https://github.com/andybarilla/jackdaw/issues/14). Nouns are from
[the supervision domain model](./2026-08-24-supervision-domain-model.md); launch is the adapter's
per [the adapter contract](./2026-08-25-adapter-contract.md); the verbs are
[the CLI surface](./2026-08-25-cli-surface.md); the attention conditions extend
[the fleet console](./2026-08-24-fleet-console.md).

**The problem.** [#3](https://github.com/andybarilla/jackdaw/issues/3) established that nothing in
tmux survives a reboot — sessions, panes, pane options and pane ids are all gone, and ids reset to
`%0`. Reconstruction is therefore a correctness requirement, not a nicety.
[#4](https://github.com/andybarilla/jackdaw/issues/4) established the only three things left to
reconstruct *from*: fleet state, the durable record, and the bounded event log.

**The one thing that makes a reboot different from a restart.** `supervisor.md` requires a lead to
write a handoff before any restart. A reboot destroys that opportunity for every agent at once,
simultaneously.

## 1. Reboot is not a daemon crash

The daemon persists the boot id (`/proc/sys/kernel/random/boot_id`) in fleet state.

| Boot id | What happened | Path |
|---|---|---|
| Unchanged | The daemon died under a live fleet | **Re-adopt** the surviving panes — tier 0, correlation via the process tree (§7.2 of the adapter contract) |
| Changed | The machine rebooted | **Reconstruct** — there is nothing to adopt |

Confusing the two in the crash direction is the expensive error: reconstructing a fleet that never
died launches a second lead into a pane that already has one.

## 2. What comes back, and how

The daemon relaunches the roster. It does **not** come back stopped with a queue of confirmations —
an IC's context is its issue and its workspace, and both survive on disk.

**A session started by reboot reconstruction comes up quarantined**: prompted to rebuild, and
forbidden to dispatch or write until it has. This is `supervisor.md`'s rule — a restarted lead with
no handoff must rebuild from the tracker before it touches anything — enforced by the daemon
instead of by prose. The intervention queue gets the agents whose rebuild failed, never the whole
fleet.

**Quarantine is lifted by the agent, not by the daemon.** `jackdaw session ready` is an explicit
claim, and the daemon records only that it was called. Jackdaw records that a handoff was returned
and never that a gate passed; it cannot tell a real rebuild from a confident summary of nothing,
and pretending otherwise would be the same error. A session still quarantined past a duration is a
`Finding` meaning *this agent has not claimed to be ready* — never *this agent is broken*.

### 2.1 Session identity

A reboot-born session is a new `Session` with `inherited_from` set — the same lifecycle a restart
already uses. `Session` gains a `cause` field (`manual` · `supervisor_restart` · `reboot`) rather
than a reboot-specific state; a parallel lifecycle would fork every query that touches sessions.
Quarantine is a property of the session, not a kind of session.

### 2.2 The daemon rebuilds the panes

One tmux session per `Project`, one pane per `Agent`, pane cwd set to that agent's
`Workspace.path`. Path is already the workspace's identity, so the roster holds everything needed
to place a pane correctly.

This is load-bearing twice over:

- **cwd is where reconstruction silently goes wrong.** A remote agent starts in *the pane's* cwd,
  not a cwd passed to the start command. `supervisor.md` records a restart into a pane sitting
  elsewhere that left a loop firing every five minutes against a path that did not exist. A daemon
  that places the pane cannot make that mistake.
- **A reconstructed fleet is more observable than the one it replaced.** Every pane in it was
  launched by Jackdaw with Jackdaw's own arguments, so it is tier 1 or 2 rather than tier 0. This
  is the one thing a reboot gives back.

### 2.3 Choreography at scale

`supervision_policy.startup` is specified for one dead lead. For a whole roster:

- **Leads before ICs.** An IC finishing into a fleet with no live lead produces exactly the
  unheld-handoff rot `supervisor.md` escalates on.
- **Bounded concurrency, not serial.** `agent start` does not return until the agent is up,
  prompted and verified — tens of seconds each, and a serial roster is a long blind window.
- **No agent stalls the queue.** One that never reaches idle hits `agent start`'s timeout, which is
  exit code `3`, deliberately distinct from failure: information for the next pass and not grounds
  for a restart. It becomes an intervention; reconstruction moves on and never retries in place.
- **Reconstruction may only prompt panes it created in this reconstruction.** If a human attached
  and started their own work after the boot, the daemon must not adopt-and-prompt into it. A
  reconstructing daemon is the worst possible violator of the never-write-to-a-pane-a-human-is-using
  gate, because it writes to many panes fast.

## 3. Leases

Every holder is a dead session id, so after a reboot every lease is suspect at once. The rule stays
[#4](https://github.com/andybarilla/jackdaw/issues/4)'s — expiry marks a resource **suspect** and
never grants it — and reclaim splits by locality:

- **Local**, held by a session whose pid is gone: provably free. A reboot is the one moment where
  *the holder is really gone* is both cheap and certain. The lease releases automatically, and the
  release is an event rather than a silent mutation.
- **Remote**: stays suspect. This machine rebooting is no evidence about `apbmbp`.

There is no mass reclaim operation. Releasing a lease does not imply the work is safe: a workspace
with uncommitted changes and no live agent is **stranded**, which the console already ranks.
Release the lease, raise the finding.

## 4. Read cursors survive the reboot

The cursor is keyed to the **`Agent`**, never the `Session`, so reconstruction does not touch
cursors at all. Every reconstructed agent comes back to its backlog.

A fleet-wide reboot therefore delivers a backlog to everyone at once. That is the correct outcome
and must not be "fixed" by reseeding at the room's tail — reseeding at the tail is the mechanism of
the 2026-08-24 orphan ([#10](https://github.com/andybarilla/jackdaw/issues/10)), and the stated
rule is that a cursor survives its member's absence. A reboot is the maximal absence.

**A reboot long enough to age a cursor out of retention is the canonical *falling behind* trigger** —
the first real one this design has. Being told is the guarantee; silently resuming at the tail is
the failure.

## 5. What a half-reconstructed fleet looks like

`reconstructing` is an explicit, timestamped machine state and a flavour of **blind**. Its clock
starts at **daemon start, not at boot** — the daemon cannot honestly report on time it was not
running for.

It ends when roster reconciliation completes: every agent in the roster has been launched,
quarantined, or turned into an intervention. **Finishing reconstruction is not the same as being
healthy.** The machine goes from blind to visible-and-full-of-findings, and the console renders
that transition rather than hiding it behind a spinner that ends in an all-clear.

**Console.** A machine-level banner carrying `reconstructing`, *N of M agents placed*, and `since`.
The all-clear is **suppressed** for that machine while it holds — the all-clear is the one element
on the screen that means *you may stop looking*. Individual findings stay ranked underneath: the
banner says the machine is coming back, the findings say these three agents are not.

**Two additions to the console's fixed condition catalogue**, both materialized with history and
emitting `attention_raised` / `attention_cleared`:

| Condition | Subject | Placement |
|---|---|---|
| Session quarantined past its duration | Session | Below blind, above the ordinary idle conditions — a known-bad state with a known cause |
| Reconstruction incomplete past its threshold | Machine | Sibling to blind |

Everything else a reboot produces already has a home; **stranded** covers the workspaces, and a
reboot is simply its largest producer.

## 6. The projection a rebuilding lead reads

Every reconstructed lead rebuilds from the tracker before it touches anything, and the projection
is read-only and staleness-stamped. A machine down for three days holds a three-day-old projection.

**Reconstruction refreshes the projection before it lifts any lead out of the launch sequence.** The
staleness stamp is the entire reason a surviving projection is safe, and the one moment that stamp
is guaranteed to be bad is the moment a whole fleet rebuilds its context from it. If the tracker is
unreachable, that is **blind** on a `Projection`, and the lead is told so explicitly rather than
started into a confident rebuild against data nobody can vouch for.

## 7. The mesh

Observe yes, act never.

Each machine reconstructs its own roster. A peer must never launch into another machine's tmux —
two daemons choreographing into one machine's panes is split-brain with keystrokes.

While the rebooted machine's daemon is down, peers report it **blind**. Never render an empty
roster from a failed probe: an outage and *nothing is running* look identical downstream, and only
one of them is safe to ignore. Once its daemon is back, peers read its `reconstructing` state, so
the fleet-wide view distinguishes *coming back* from *back*.

Leases follow the same rule: the rebooted machine's own daemon is authoritative for releasing its
own local leases, and peers learn by event rather than by inferring death across the network.

## 8. CLI additions

| Verb | Purpose |
|---|---|
| `jackdaw session ready` | The agent's own claim that its rebuild is done; lifts quarantine |
| `jackdaw machine reconstruct` | Idempotent, so a human can re-run a half-finished reconstruction without tearing anything down |

Idempotence is what makes the second one safe to reach for when you are not sure what state the
machine is in, which is the only state anyone reaches for it in.

Everything else rides existing surface: `cause` and quarantine surface through `agent list`, and
the always-present `degraded` already carries *this answer is from a machine still coming back* in
a form a shell can test.
