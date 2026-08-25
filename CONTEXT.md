# Jackdaw

Jackdaw supervises fleets of AI coding-agent sessions across machines. It holds the
state that today dies when a session ends, so a human does not have to hold it.

## Language

### The fleet

**Machine**:
A host running one Jackdaw daemon. First-class: agents, workspaces and roles are all
located on one.
_Avoid_: host, node, box

**Agent**:
A named, long-lived supervised worker — a role incarnated in a pane. `lead-alare` is
an agent; the Claude Code process currently backing it is not.
_Avoid_: worker, bot, pane

**Session**:
One incarnation of an agent, from start to death. An agent that is restarted is the
same agent and a new session. Carries a **cause** — how it came to be started — because a
session born of a reboot needs handling a hand-started one does not.
_Avoid_: run, instance, process

**Quarantine**:
A session that may observe but may not dispatch or write, until it **claims** it has rebuilt
its context. The claim is the agent's own; Jackdaw records that it was made, never that it
was deserved.
_Avoid_: probation, unverified, cold start

**Role**:
The configured shape an agent takes — a name pattern, a prompt file, a machine, and a
supervision policy. `lead`, `ic-generalist` and `supervisor` are roles.
_Avoid_: agent type, persona, template

**Supervision policy**:
The part of a role Jackdaw itself acts on: idle thresholds, restart behaviour, and
startup choreography. Never judgment — that lives in the role's prompt file.

**Project**:
A named unit of work with a source root, a tracker binding, a workspace root, a room,
and the roles expected to be running for it. The join key for everything else.

**Workspace**:
A directory tree an agent works in, outliving any one session. Identified by its
**path**, never by the name of an agent sitting in it. A git worktree is one kind; a
TalosTitle effort tree is another.
_Avoid_: worktree, checkout, effort tree

**Effort**:
A kind of workspace whose lifespan is days rather than hours. A configured variation,
not a separate concept.

**Stranded**:
A workspace with no live agent under it, holding work nobody is on.

### Communication

**Room**:
A durable, project-scoped channel carrying agent-authored posts. Membership is **stored**,
never derived from where an agent happens to be working, and the supervisor is a member of
every room.
_Avoid_: channel, chat, scuttlebutt

**Read cursor**:
One member's position in one room — the last post it has been delivered. Per member — keyed to
the **agent**, never the session — and the only read state a room keeps. Survives the member
being absent: a member that comes back resumes from its cursor, never from the room's tail. A
reboot is the maximal absence and changes nothing about this.
_Avoid_: read receipt, high-water mark, last-seen

**Post**:
One short agent-authored message in a room. A wake signal and a pointer — never the
thing it points at.

**Event**:
One timestamped machine-observed fact about the fleet. High-volume, unaddressed, and
aged out; the opposite of a post in every respect.

**Falling behind**:
The state of a subscriber whose cursor has aged out of the retention window. Being
told you fell behind is the guarantee; silently missing events is the failure.

### Work in flight

**Handoff**:
A first-class record of finished work passed from its author to a holder. Unheld work
is a queryable state rather than something a supervisor infers from an idle pane.

**Gate**:
The review a handoff must pass before acceptance. Jackdaw records that a handoff was
returned; it never records that a gate passed.

**Intervention**:
One entry in the queue of things only the human can do, carrying a `check` predicate
that resolves it. Interpreted, never executed.
_Avoid_: blocker, todo, needs-andy

**Lease**:
A renewable exclusive claim on a thing — a pane, a branch lane, a ticket — held by one
holder. Its purpose is detecting a holder that died without releasing; expiry marks a
lease **suspect**, never free.
_Avoid_: lock, claim, reservation

### Attention

**Finding**:
One condition the fleet currently meets that a human should look at, carrying a subject, a
fixed rank, and how long it has been true. Absences count: no live agent, no open PR, no
holder.
_Avoid_: alert, warning, issue

**Acknowledgement**:
A finding muted until its **material** evidence changes — the fields that condition declares
it is watching, not every field it reports. Expires; never permanent.
_Avoid_: dismiss, snooze, ignore

**Blind**:
Not knowing a source's state, as distinct from knowing it holds nothing. An unreachable
machine is blind; a machine with no agents is empty. Rendering the first as the second hides
an outage behind an all-clear.
_Avoid_: unavailable, offline, stale

**Reconstructing**:
A machine rebuilding its fleet after a reboot — a flavour of **blind**, timestamped from when
the daemon started rather than from the boot, because a daemon cannot report on time it was
not running for. It ends at roster reconciliation, which is not the same as being healthy.
_Avoid_: booting, recovering, starting up

### Foreign state

**Adapter**:
A plugin binding Jackdaw to something outside it. A **harness adapter** covers one
coding harness; a **tracker adapter** covers one issue tracker. It **declares** what it can
observe rather than answering for the state of things.
_Avoid_: integration, driver, connector

**Observation**:
One question the daemon asks an adapter about a pane, from a fixed vocabulary. Answered with a
method and a confidence, or with **unavailable** — which is an answer, not a gap.
_Avoid_: probe, check, signal

**Tier**:
How observable a **pane** is, set by how that pane came to exist: adopted by Jackdaw, launched
by it, or launched with a config Jackdaw also owns. A property of the pane, never of the
adapter.
_Avoid_: level, capability class

**Hint**:
An adapter's notice that something has changed, carrying no state of its own. It makes the
daemon look now instead of later; losing hints costs latency, never correctness.
_Avoid_: push, event, callback

**Projection**:
Jackdaw's read-only, staleness-stamped local copy of foreign state — issues, git
status. Never written back; the foreign system stays authoritative.
_Avoid_: cache, mirror, sync
