# The tracker-adapter contract

Resolves [#9](https://github.com/andybarilla/jackdaw/issues/9). The extension point is
[the adapter contract](./2026-08-25-adapter-contract.md); the nouns are
[the supervision domain model](./2026-08-24-supervision-domain-model.md); the consumers are
[the fleet console](./2026-08-24-fleet-console.md) and [the CLI surface](./2026-08-25-cli-surface.md).

**Why this exists.** [#4](https://github.com/andybarilla/jackdaw/issues/4) gave `Project` a
**tracker binding**, which made tracker adapters a second plugin kind in v1. The tracker stays
authoritative; Jackdaw holds a read-only, staleness-stamped **projection that is never written
back**.

**The shape is inherited, not invented.** A tracker adapter **declares** what it can answer and what
it may write, and **`unavailable` is a first-class answer** — the same contract a harness adapter
has.

## 1. The common issue model

| Field | Notes |
|---|---|
| `ref` | `<binding>:<key>` — see §4 |
| `title` | |
| `open` / `closed` | The tracker's own open/closed axis |
| `state_role` | The triage state as a **role**, never a label string — see below |
| `assignee?` | |
| `labels[]` | Raw, unmapped, for display and for conditions Jackdaw does not model |
| `created` / `updated` | |
| `url` | |

**The triage state is a role the binding maps.** The five roles are `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. GitHub maps them to labels, Jira to a workflow
status or custom field, Linear to workflow states.

This is not a new idea: `groom.md` already treats the mapping as per-repository, defaults to
identity, and **stops rather than guessing** when a role has no target, because a wrong mapping
mislabels an entire batch.

Two rules carry the weight:

- **`unclassified` is a sixth first-class value, not an absence.** `status.md` surfaces a fresh
  issue carrying no triage-state label precisely because it is *specified work no queue-depth query
  can see* — usually a lead filing straight from a review. A model that renders that as `null`
  loses the condition.
- **A role the adapter cannot resolve is `unavailable`, never a guess.**

## 2. Write scope is declared, and asymmetric with read

An adapter declares each write verb as `allowed`, **`via <named command>`**, or **`forbidden`**.
Anything undeclared is forbidden.

| Verb | |
|---|---|
| `comment` · `transition` · `set_labels` · `assign` | |
| `create` · `close` | The two that estates most often restrict |

**The `via` case is the one an API-shaped contract would miss.** In the TalosTitle estate, creating
an issue is not an API call: ids may be allocated **only** through `scripts/jira/le-alloc` or
`follow-alloc`, which refuse unless `max(LOOSENDS-*)` in Jira and `max(LE-*)` in the ledger already
agree — **that refusal is the integrity check**, and a raw `POST /issue` desyncs the ledger
silently. An adapter that could only say *I can create issues* would bypass it.

**The adapter declares its principal.** Every Jira write in that estate runs as
`tim@talostitle.com` with no scoped automation principal — *you are writing as Andy*. That is a
fact every consumer should be able to read from the contract rather than from a role file.

## 3. The projection boundary

**The adapter fetches and normalizes; core owns the store, the staleness stamp, and the trigger.**

Queries — queue depth, the attention conditions, the fresh-and-unclassified check — are written
**once against the model**, not once per tracker. That is the whole reason for having a common
model.

The adapter declares its own **refresh cadence**, which the console already required of tracker
adapters because only the adapter knows its refresh cost.

**Refresh-now must exist and must fail truthfully.**
[#14](https://github.com/andybarilla/jackdaw/issues/14) made this load-bearing: every lead
reconstructed after a reboot rebuilds its context from this projection, and an unreachable tracker
at that moment is **blind on a `Projection`** — rank 2 in the console — not a stale answer served
in silence.

### 3.1 Consistency and counting

**Every query declares a consistency class**: `authoritative` (a direct object read) or `indexed`
(eventually consistent, lag unbounded). Queue depth is `indexed` on every tracker worth binding.

- **A count taken inside a declared settle window after a write is stamped `degraded`, not
  trusted.** Jira's search index lags writes — nine successful 204s landed before it caught up.
  `groom.md` already re-measures after a batch rather than computing the delta it expected; this
  makes that instinct a contract.
- **Approximation is forbidden.** An adapter may never satisfy a count with an estimate:
  `/rest/api/3/search/approximate-count` was measured reading 10 where the exact count differed. If
  exact is unavailable, the answer is **`unavailable`**.

### 3.2 Backoff and rate limits

**The adapter owns backoff; core never retries into a rate limit** — core knowing how to retry
means core knowing every tracker's limits, which is the adapter's job by construction.

A rate-limited tracker is `degraded` with a reason and a retry hint, and **the projection keeps
serving its last snapshot with its staleness stamp rather than an empty set**. A stale answer that
says how stale it is remains usable; an empty answer that could be an unknown one is the failure
this map has now hit in five places.

### 3.3 An adapter never writes on its own initiative

Every write is core-initiated and traceable to a verb someone invoked.

This is the adapter contract's **pull with hints** rule with the arrow reversed: there, a hint
wakes the daemon and carries no data, so an adapter can never *assert* unverified state. Here, an
adapter can never *effect* an unrequested one. A tracker webhook is a hint. An adapter that could
write on its own would be an unsupervised agent living inside the supervision plane.

## 4. Work-item references

**`<binding>:<key>`** — `gh:andybarilla/jackdaw#9`, `jira:LOOSENDS-7`.

This reuses the shape the CLI already committed to for machines (`machine:name` works anywhere a
name does); a second syntax for the other cross-boundary identifier is a needless thing to
remember.

**A reference is an opaque string requiring no lookup to be valid**, so it survives the tracker
being unreachable. A `Handoff.subject` that cannot be rendered because Jira is down would be the
projection's blindness leaking into the durable record.

The local `issue-<n>` workspace convention is untouched: a `Workspace`'s identity is its **path**,
and its name is not a foreign key.

### 4.1 Three work-item kinds, because the intervention vocabulary needs them

`supervisor.md`'s self-clearing `check:` predicates include `issue-closed:<owner/repo>#<n>`,
**`pr-merged:<owner/repo>#<n>`** and **`branch-gone:<owner/repo>:<branch>`**, and `/status`
interprets them. The tracker adapter is therefore what makes an intervention clear itself — and two
of those predicates are not about issues at all.

So the model covers **issue**, **change request**, and **branch**, and the adapter declares which
kinds it can answer for. This is a widening of the ticket's framing, and it is forced rather than
chosen: an intervention whose `check` cannot be evaluated never clears, and the entire point of
that vocabulary is that nobody has to remember.

GitHub answers all three. A Jira binding answers `issue` and nothing about branches — so
`branch-gone:` is a **GitHub-shaped predicate**, and the honest form is a binding declaring it
cannot evaluate it, letting `/status` say *this intervention cannot self-clear here* instead of
holding it open forever looking like unfinished work.

*Change request* rather than *pull request*, so GitLab and Bitbucket are not special cases later.

## 5. Unexpressible roles

**Queue depth is defined over `ready-for-agent` alone, and a binding that cannot express that role
reports `unavailable` — never `0`.**

`project-lead.md` spawns a groom worker whenever depth is below target, so a binding answering `0`
instead of *unknown* produces an infinite grooming loop against a tracker nobody can read.

`unclassified` gets the same treatment. On a tracker where every issue necessarily carries a
status, `unclassified` is itself `unavailable`, and that must be **visible** rather than rendered
as *none found* — otherwise `status.md`'s fresh-unlabelled-issue condition reports a permanent
all-clear on Jira.

## 6. One project, one binding

A binding names a **scope**, not just a system: a repo, or a Jira project plus a filter.

Two bindings makes *file this issue* ambiguous with no principled tiebreak. A project that
genuinely spans two trackers is two `Project`s, which is honest about the seam rather than hiding
it inside an adapter.

## 7. Headless is a declaration, not a warning

**Every adapter declares its authentication method, and any capability that cannot be exercised
with no human present is `unavailable`.**

`lead-talostitle.md` bans the Atlassian MCP outright: interactively authenticated and absent in
headless runs, so anything depending on it works only while a human watches. An interactive
capability passes every test and fails at 3am on a cron.

The same incident gives a second rule, in its own words:

> **"It worked via the MCP" is evidence about the wrapper, never the API.**

The MCP silently converted Markdown to ADF — a body that created LOOSENDS-1..6 through it returned
400 *not valid ADF* through curl. So **an adapter's declared capabilities must be verified through
the same path it runs in production**, not through a convenience wrapper that reshapes payloads on
the way.

## 8. Configuration

The role→target mapping lives in the **binding config** and is validated by `config validate`.

**A mapping naming a role the tracker has no target for is a config-time failure, not a runtime
guess.** `groom.md` re-derives this before every batch with a `comm` against the repo's actual
labels because nothing else can, which means a repo whose labels drift is caught only when someone
next grooms it. `config validate` already detects a missing prompt file on the machine the role
runs on; this points the same check at the tracker.

That runtime `comm` then becomes redundant rather than load-bearing — which is the measure of
whether Jackdaw earned this.
