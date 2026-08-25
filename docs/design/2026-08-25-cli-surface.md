# The CLI surface

Resolves [#6](https://github.com/andybarilla/jackdaw/issues/6). Nouns are from
[the supervision domain model](./2026-08-24-supervision-domain-model.md); the adapter's half of
this surface is [the adapter contract](./2026-08-25-adapter-contract.md); the output contract is
shared with [the fleet console](./2026-08-24-fleet-console.md).

**The compatibility target, enumerated.** Every `herdr` invocation in
`~/.claude/agents/{supervisor,project-lead,lead-talostitle,ic-*}.md` and
`~/.claude/commands/{supervise,lead,status,groom}.md` — 14 distinct verbs across 3 nouns:

| Count | Verb | | Count | Verb |
|---|---|---|---|---|
| 25 | `agent prompt` | | 3 | `agent rename` |
| 17 | `agent list` | | 2 | `agent read` |
| 9 | `agent start` | | 2 | `agent get` |
| 8 | `agent wait` | | 2 | `pane send-keys` |
| 4 | `agent names` | | 2 | `pane current` |
| 3 | `worktree list` | | 1 | `worktree create` / `remove`, `pane split` |

The `jq` expressions those role files run against them are the real output contract:

```
.result.agents[] | [.pane_id, .agent_status, .cwd, .terminal_title_stripped]
.result.agents[] | [(.name // "-"), .agent_status, .cwd]
.result.agent.agent_status
.result.pane.pane_id
```

## 1. Output contract

**The envelope is herdr's**: `.result.<noun>` and `.result.<noun>s[]`. Those four `jq`
expressions keep working through a `herdr`→`jackdaw` search-and-replace, which is the migration
promise.

**Every response additionally carries `degraded`, always present, empty when nothing is
degraded.**

```json
{ "schema": 1, "result": { "agents": [ … ] }, "degraded": [] }
```

`degraded` is the console's *never render an empty set that could be an unknown set* rule in a
form a shell script can test. A human reads an explicit all-clear line; `jq` needs a key. An empty
`agents` array with an empty `degraded` means nothing is running; an empty `agents` array with a
machine in `degraded` means you do not know — and only one of those is safe to ignore.

**The CLI's output contract and the console's are one contract.** A `Finding` printed by
`jackdaw status` and the same finding rendered in the GUI are one record with two renderings.

### 1.1 Stability

`schema` is on every response. **Additive-only within a major**: fields may appear, never change
meaning and never vanish. `jackdaw schema` prints the current contract.

The version rides in the response rather than only on the binary because two machines can be on
different versions mid-migration, and a fanned-out answer must say so rather than blending them.

### 1.2 Exit codes

| | |
|---|---|
| `0` | success |
| `1` | usage error |
| `2` | not found |
| `3` | **timeout** |
| `4` | answered, but degraded |

**Timeout is not failure.** `supervisor.md` is explicit that a timeout from `agent wait` is
*information for your next pass, not grounds for a restart* — a supervisor that conflates them
restarts a lead running a 10-minute review and discards it. Code `4` exists for the same reason
`degraded` does: an answer computed over an unreachable machine is not an answer, and a script
testing only `if ok` must not treat it as one.

## 2. Compatible surface

Same verbs, same arguments, same envelope. Three deliberate changes.

### 2.1 `agent prompt` verifies by default

`herdr agent prompt` returns `agent_prompted` for a prompt that never landed. `supervisor.md`
carries a HARD-GATE about it: read the pane back and confirm the text appears, or you will report
a launch that never happened.

`jackdaw agent prompt` sends, reads back, confirms the text landed, and **exits non-zero if it did
not**. `--no-verify` opts out.

A guarantee you must opt into is a guarantee most callers will not have. This deletes a HARD-GATE
from a role file, which is the measure of whether Jackdaw earned its complexity.

### 2.2 `agent start` runs the whole choreography

Today this is four commands and a polling loop in prose:

```bash
herdr agent start lead-<p> --kind claude --pane <id>
herdr pane send-keys <id> enter                      # the trust prompt
until [ "$(herdr agent get … | jq -r '…agent_status')" = "idle" ]; do sleep 3; done
herdr agent prompt lead-<p> "/lead <p>"
herdr agent read lead-<p>                            # verify it landed
```

`jackdaw agent start <name> --role <role> --pane <pane> --prompt "<text>"` does all of it and does
not return until the agent is up, prompted and verified. `--no-prompt` stops after launch.

Every step in that ritual exists because something silently did not happen: the trust prompt that
leaves a restart stalled at a prompt nobody is watching, the `agent_name_taken` retry loop caused
by the blocked agent already holding the name, and the prompt that reports success and never
lands. Core owns the sequence; the adapter supplies the predicates and strings — the trust
prompt's exact shape is as harness-specific as a scrape rule.

### 2.3 `workspace`, and paths as identity

`worktree` becomes **`workspace`**, with `worktree` kept as a hidden deprecated alias that warns on
stderr. `herdr worktree list` cannot describe a TalosTitle effort tree; a `Workspace` covers both
kinds, which is why the noun exists.

**Path is the identifier. Opaque ids are not part of the surface.** `herdr worktree remove
--workspace <id>` becomes `jackdaw workspace remove <path>`. An id is a second identity for
something that already has one, and every use of an id in the role files got it by capturing the
output of the command that just printed it. `status.md` already discovers workspaces by globbing
the filesystem, because the id-based command fails outside a git work tree.

### 2.4 `agent list` fields

`agent_status` keeps its name and its value set — including `unknown`, which herdr already emits,
so role files that branch on it keep behaving correctly when an adapter answers `unavailable`.

Three siblings are added:

- **`since`** — when the current state began. This is the highest-value addition on the surface:
  `supervisor.md` tracks status across its own passes *solely* because there is no duration field,
  and that entire mechanism disappears.
- **`tier`** — how observable this pane is (adopted / launched / provisioned).
- **`confidence`** — the adapter's own answer, so a scraped `idle` and a native one are
  distinguishable.

`--until` keeps `idle` and `done`, and gains **`--until blocked`**. There is no point spending four
research tickets making a state observable if a caller cannot wait on it.

### 2.5 `pane send-keys`

Kept, because the trust-prompt sequence needs a raw write to a pane before any agent exists in it.
It **acquires a `Lease`** and **refuses a pane whose `focused` is true** unless `--force`.

The hazard is documented: agent text and human keystrokes concatenate, turning `/exit` into
`restart the session/exit`. tmux offers no interlock — `attach -r` is client-scoped and does not
block `send-keys` — so the lease is a convention among Jackdaw's own writers and `focused` is the
only real signal. `--force` exists because the supervisor sometimes must, and it should have to say
so.

## 3. New surface

Designed fresh. Named transitions, not generic setters — the state machine is the point.

```
jackdaw handoff open|hold|return|accept|list
jackdaw intervention file|list|resolve
jackdaw machine list|show
jackdaw event tail|since
jackdaw room post|read|members
jackdaw status
jackdaw config validate
jackdaw schema
jackdaw plugin install|list
jackdaw doctor
```

**There is no `handoff pass`.** Jackdaw records that a handoff was *returned* and never that a gate
*passed*. `return` earns a verb of its own because "the gate failed and it went back" is a
documented loop with no record today, and a lead escalates on it having happened **twice on the
same handoff** — a count only a rejection transition produces. A recorded pass invites trusting a
self-review, which every role file forbids.

`intervention file` keeps the closed `check` vocabulary — `path-absent`, `path-present`,
`process-gone`, `issue-closed`, `pr-merged`, `branch-gone` — **interpreted, never executed**, since
agents write these and the content is untrusted. The daemon evaluates on a timer, so entries clear
themselves whether or not anyone runs `/status`.

### 3.1 `jackdaw status`

Prints the attention query's findings, the interventions block, and the roster — the same records
the console renders.

`status.md` today is *five sections of gathering*: agents, issues, git state, the intervention
queue, and TalosTitle over SSH. Every one is a join the daemon already performs. What survives in
the skill is judgment — how to phrase things, what to lead with, when to say plainly that nothing
needs attention. What leaves is all of the gathering, including the SSH block and the hand-written
`jq` for unlabelled issues. The skill stops being a program written in markdown.

### 3.2 The room

`jackdaw room post|read|members`, replacing an absolute path into a plugin checkout.

That path is the thing worth deleting: `ic-generalist.md` invokes `post` through a hardcoded
checkout path, and the only reason agents can post at all is that a daemon hands each one that path
at startup — a mechanism that fails silently the moment the path moves.

Two properties carry over from the working implementation rather than being reinvented: the
**700-character cap**, enforced at post time with a clear error and measured rather than arbitrary
(median post is 216 words), and **read state as a per-member cursor**, so `room read` advances a
cursor and can report *you fell behind* instead of silently resuming at the tail.

### 3.3 Subscription is not the wake mechanism

`jackdaw event tail` streams NDJSON for interactive and scripted consumption. `agent wait` keeps a
bounded timeout. **Neither may be documented as how a lead learns its IC finished.**

Any subscription a shell holds dies with that shell, silently — that is exactly how an IC was
orphaned on 2026-08-24 when a lead's workspace closed with work in flight. Waking is the daemon's
job, via room delivery-on-idle, which survives a restart because the daemon holds it and the shell
does not. A backgrounded or daemonized watcher is the same trap wearing a flag.

## 4. `machine:name` addressing

**`machine:name` is accepted anywhere a name is**, and the local daemon fans out. A bare name is
local, so nothing existing changes meaning.

```bash
jackdaw agent list                          # this machine
jackdaw agent list --all                    # the mesh
jackdaw agent prompt apbmbp:lead-talostitle "…"
```

This is the largest ergonomic win over herdr and it deletes the most fragile prose in the role
files: the `ssh -o BatchMode=yes` wrapping, the `zsh -lc` login-PATH workaround, the macOS-keychain
trap where `gh auth status` reports an invalid token over SSH for a `gh` that works perfectly in
the agent's own pane, and the HARD-GATE forbidding remote diagnosis from an SSH session. It also
puts the unreachable-versus-empty verdict where the fan-out happens instead of in every caller.

The mesh transport underneath remains unspecified; this fixes the *surface*, which is what role
files migrate against.

## 5. Configuration

The config file is canonical and hand-editable. **The CLI reads and validates it; it does not write
it.**

Config is where a human states intent, and a file under version control is reviewable in a way a
mutated state store is not — `expected_roles` in particular *is* the roster, and its whole value is
being a declaration you can diff.

**`jackdaw config validate` is required, not optional.** The failure it prevents is documented: a
stale or missing role prompt file fails **silently**, because the lead `cat`s a file that is not
there, gets nothing, and starts work with no role. A config naming a prompt file must be checkable
against whether that file exists **on the machine the role runs on** — which `machine:name` makes
possible.

## 6. Migration

**A checker, not a rewriter.** `jackdaw doctor --roles <path>` finds remaining `herdr` invocations
and, where a Jackdaw verb subsumes a documented workaround, says so.

The rewrites are mechanical — `herdr `→`jackdaw `, `worktree`→`workspace`. What is *not* mechanical
is the prose, and a rewriter would leave all of it intact and looking correct: a migrated file still
carrying the workarounds is the worst outcome. Judgment stays with whoever edits the file.

### What each role file loses

**`supervisor.md`** — the restart choreography collapses to one `agent start` (§2.2). The
verify-the-prompt-landed HARD-GATE goes, because `agent prompt` verifies (§2.1). The entire
TalosTitle SSH section and its two HARD-GATEs go, replaced by `machine:name` (§4). Tracking status
across passes to infer duration goes, replaced by `since` (§2.4). The md5 role-file sync loop
belongs to config distribution, still fog.

**`project-lead.md`** — dispatch becomes `workspace create` plus one `agent start`. The
"nothing wakes you when an IC finishes" HARD-GATE keeps its *judgment* but loses its mechanism: the
handoff is a record with a state, and `handoff list --unheld` answers it directly instead of
inferring from an idle pane. The room paragraph loses its plugin path (§3.2).

**`status.md`** — sections 1–5 become `jackdaw status` (§3.1). The `check`-vocabulary table stays
as documentation of what the daemon evaluates.

**`lead-talostitle.md`** and the `ic-*.md` files — SSH wrapping and the room's absolute path.

## What this does not settle

- **The wire protocol** between CLI and daemon. This document fixes the *surface*; the framing,
  versioning and subscription transport underneath remain fog, and the map says they sharpen once
  this output contract is settled — which it now is.
- **Mesh transport and authentication** for the fan-out in §4.
- **Role-file distribution** — `config validate` can detect a missing prompt file; distributing it
  is still fog.
