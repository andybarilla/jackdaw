# The adapter contract

Resolves [#5](https://github.com/andybarilla/jackdaw/issues/5). Vocabulary is in
[`CONTEXT.md`](../../CONTEXT.md); the nouns an adapter plugs into are in
[the supervision domain model](./2026-08-24-supervision-domain-model.md).

Built on four studies, cited inline: [#2](https://github.com/andybarilla/jackdaw/issues/2)
(what eight harnesses expose), [#8](https://github.com/andybarilla/jackdaw/issues/8) (scraping
through tmux), [#18](https://github.com/andybarilla/jackdaw/issues/18) (OSC 9;4),
[#22](https://github.com/andybarilla/jackdaw/issues/22) (blocked detection). Where this document
states a cost or a latency, it was measured there.

## The shape in one paragraph

An adapter **declares** what it can observe rather than implementing a state getter. It declares
against a fixed vocabulary of six **observations**, each answered with a method, a cadence and a
confidence — or with `unavailable`, which is a real answer. What it can observe depends on the
**tier** the pane is at, which is a property of the pane rather than of the adapter. Most adapters
are **data**: a manifest of paths, selectors and rules. An adapter that needs real logic runs as a
long-lived subprocess. The daemon polls; adapters may **hint** to collapse latency but never assert
state. Everything an adapter writes goes through a lease it cannot see.

## 1. An adapter declares observations, not state

`getState() -> State` is ruled out by #2: partial coverage is the norm. `pi` has no approval
concept at all, `opencode` collapses awaiting-input and finished into a single `session.status:
idle`, and `cursor` can *decide* a permission without ever announcing that it is stuck.

The matrix is indexed by **observation** — a question the daemon asks — not by state and not by
transition.

| Observation | Question | Required |
|---|---|---|
| `liveness` | Does the process exist, does its start time match, is it not stopped or zombie? | **yes** |
| `activity` | Is it working? | **yes** |
| `blocked` | Is it waiting on a human, and on what? | no |
| `last_change` | When did the current state begin? | no |
| `session_artifact` | Where is this session's durable record, and in what dialect? | no |
| `addressing` | See §4. | no |

Each declared observation carries a **method** (`native` / `artifact` / `scraped` / `hinted`), a
**cadence** and **staleness threshold** (§6), and a **confidence**. An observation the adapter
cannot answer is declared `unavailable` — never omitted.

**Why observations rather than transitions.** The ticket proposed per-transition declaration and it
is the wrong index. The strongest signal found anywhere in the four studies is a **level**, not an
edge: you read `$CLAUDE_CONFIG_DIR/sessions/<pid>.json` and the `status` field says `waiting`
(#22). Indexing by transition would force every adapter to synthesise edges, which the daemon must
derive anyway to timestamp events — #4 already established that agent state is derived from the
event log rather than stored.

**`liveness` is required, and it is not a formality.** A killed harness leaves its last status on
disk **with no tombstone** (#22), so a dead agent reads as whatever it was doing when it died.
Every status read is paired with a liveness predicate or it is not a status read.

**`unavailable` is a first-class answer.** This is the fleet console's blind-versus-empty rule
(#11) one layer down: a harness that cannot report `blocked` must be *known* not to report it, so
the console renders a blind spot rather than an all-clear. An adapter that declares
`blocked: unavailable` is describing `pi` correctly.

**The floor is `liveness` + `activity`.** Requiring all six would exclude two of eight harnesses
from having an adapter at all, which is worse than admitting they are partial.

## 2. Tiers are a property of the pane

Three tiers. A tier describes **this pane**, not this adapter — the same adapter observing a pane a
human started and one Jackdaw launched has genuinely different capabilities.

| Tier | How the pane came to be | What it unlocks |
|---|---|---|
| **0 — adopted** | A human launched it; Jackdaw found it | Read-only observation only |
| **1 — launched** | Jackdaw chose the launch arguments | `--port`/`--hostname`/`--mdns` for `opencode`, `--json-fd` for `qwen` (#2) |
| **2 — provisioned** | Jackdaw also owns the harness config dir | Hooks, settings, the hint path (§5) |

The rungs are #2's measured cost axis, not an invention.

**A `blocked` observation must be satisfiable read-only at tier 0.** Adopted panes were launched by
a human, so no signal requiring a config write may be a baseline requirement — a baseline that
assumes one silently excludes every pane Jackdaw did not start. This is affordable because the best
`claude` signal is read-only: on a stock pane with no environment surgery, no settings change, no
hooks, no `pipe-pane` and `$TMUX` intact, `status=waiting` was stamped **before** an independent
100 ms poller first saw the dialog (#22).

**An adapter may write only into a config scope Jackdaw provisioned and owns — never `~/.claude`.**
Config-dependent signals are opt-in enhancements for tier 2, not requirements.

The console must render a pane's tier, because "tier 0, adopted" is a sentence a human can act on
where "less observable" is not.

## 3. Most adapters are data

**Manifest-first**, with a subprocess escape hatch.

A **manifest adapter** is declarative: identification predicates (§7), artifact paths and field
selectors, scrape rules, launch arguments, cadences, a verified version range. This covers the
common case — the strongest signal in the whole series is *"read this JSON file at this path and
look at this field"*, which is a selector, not a program. The incumbent's detection layer is
likewise a TOML catalog rather than a plugin API.

A **subprocess adapter** is for adapters that need real logic: `qwen`'s answerable approval channel
(`control_request`/`can_use_tool` ↔ `confirmation_response`) and `opencode`'s HTTP server running
inside a Worker behind in-process RPC are programs, not selectors.

Data adapters are inspectable, diffable, pinnable and safe, and they let someone contribute a
harness without writing or trusting code. This also keeps the whole contract independent of
[#7](https://github.com/andybarilla/jackdaw/issues/7), which is the property that ticket most
needs.

### 3.1 Subprocess lifecycle

**One long-lived process per adapter — not per pane** — speaking line-delimited JSON over stdio,
restarted on death.

Per-observation invocation would pay a process spawn on every read: the whole-fleet registry read
is **0.40 ms** against **5.25 ms** for a single `capture-pane` (#22), and a fork is an order of
magnitude above the cheap path. Per-pane multiplies that by the fleet. One process per adapter also
gives the hint path (§5) somewhere to live.

Stdio keeps it transport-free — no ports, no sockets, no auth story — and it composes with the
consent rule in §8, because you can see exactly what was launched. An adapter subprocess dying is
an ordinary supervision problem; its observations go `unavailable` while it is down, a shape the
contract already has.

### 3.2 Scrape rules

Adopt the incumbent's rule **predicates** — `contains`, `regex`, `line_regex` over a named region —
and **not** its state names.

`visible_blocker` conflates *blocked on approval* with *blocked on anything*, and this entire chain
exists to establish that `blocked` carries a reason where the harness has one. Importing the names
would import the ambiguity. Scraping is also tier-3 fallback here where in herdr it is the only
path.

## 4. Addressing is a separate surface

`prompt`, `read` and `interrupt` are **writes**, and they get their own surface rather than more
capability entries.

Symmetry with observation is the trap: it makes a write look like a read in the contract. The one
thing four studies never found is anything that can stop a human typing into a pane — #3 proved
tmux offers no write interlock, and `attach -r` is client-scoped and does not block `send-keys`.

- **Every addressing verb is gated on a `Lease` the adapter cannot see or acquire itself.** The
  daemon holds the lease and calls the adapter; an adapter that could acquire its own lease could
  write around the interlock.
- **`interrupt` declares whether it is safe mid-tool-call.** `esc` will not interrupt work inside a
  subagent, and a supervisor that believes otherwise restarts a live review — `supervisor.md` has a
  HARD-GATE about exactly this, because the gate takes 10+ minutes and restarting discards it.
- Core cannot own addressing outright: `qwen` can *answer* an approval over its sidecar, and
  interrupt semantics differ per harness, so writes are not uniformly `send-keys`.

## 5. Pull, with hints

The daemon polls. Adapters may **hint**: a hint wakes the daemon to observe immediately and carries
**no data of its own**.

`qwen`'s hook system has an `http` executor that POSTs straight to a daemon with no shell shim, and
`claude`'s hooks can do the same (#2) — so the push shape is real and it fires *at* the transition
rather than up to a poll interval late.

But an adapter that could emit observations directly could assert state the daemon never verified,
and this design has been burned by that exact shape: a remote `agent prompt` returns success for a
prompt that never landed, which is why `supervisor.md` has a HARD-GATE requiring the pane be read
back. One source of truth: the daemon reads and the daemon stamps.

Hints degrade cleanly. Lose them and you lose latency, not correctness — which is what tier 0
already looks like.

## 6. Cadence and staleness belong to the observation

**Each observation declares its own cadence and staleness threshold**, and the daemon schedules
accordingly.

One global interval is wrong when the cheap read is 0.40 ms and a `capture-pane` is 5.25 ms. Nor is
per-*method* enough: `claude` sends no keepalive where `pi` sends one at 1 Hz (#17, #18), so *how
long silence stays meaningful* is a per-harness fact. Two observations of the same method on the
same harness can differ too — liveness is cheap enough to check constantly, a scrape is not.

This matches what #11 already required of tracker adapters, where the adapter owns its threshold
because it knows its own refresh cadence.

## 7. Identification and correlation

### 7.1 Which adapter observes this pane

**Each adapter declares identification predicates**, run in declared priority order.

Executable name alone is not enough: four `claude` versions live side by side on this machine, the
launcher is a symlink that moved twice in two days, and `pi`'s binary says nothing about whether
its progress channel is on. An adapter knows the strongest fingerprint for its own harness —
`claude`'s is a registry entry whose `pid` matches the pane's process, which identifies the harness
*and* hands over the session in one read.

- **Ambiguity is `unavailable`, never a guess.** A pane two adapters both claim is reported
  unidentified rather than assigned to whichever ran first.
- **Identification is re-run, not cached forever** — a pane's process can be replaced under it.

### 7.2 Which session is in this pane

**Core owns correlation via the process tree** (`#{pane_pid}` → `/proc` children); a
harness-supplied field **corroborates and never leads**.

The process tree survives what this map keeps getting bitten by: a tmux server restart (ids reset
to `%0`, #3), a harness that cannot see `$TMUX` and therefore omits its own pane field (#22, and
the live fleet's entries were observed missing it), and a pane nobody named properly. This is the
same argument that made a `Workspace`'s identity its **path** rather than the name of the agent
sitting in it.

The harness field is still read, because a **disagreement is diagnostic**: it means the process
tree and the harness disagree about what session is in that pane. Silently preferring either one
hides that.

## 8. Distribution and trust

Plugins are local files under a Jackdaw config root. An explicit
`jackdaw plugin install <url>` **pins a content hash**.

A runtime fetch — the incumbent's model, a catalog pulled over HTTP — means a third party can
change how the fleet interprets *blocked* between two passes, with no diff and no review, and the
scrape rules it delivers are the fragile part. Local-only would leave every user hand-writing eight
manifests. Hash-pinning makes an update an explicit, reviewable act.

**A subprocess adapter requires separate, louder consent than a manifest.** A manifest is inert
data; an executable is not, and the daemon must be honest that it is running someone's binary next
to the user's credentials.

## 9. Version ranges and downgrade

An adapter declares a **verified harness version range**. Outside it, the affected observations
become `unavailable`, the pane drops a tier, and the console says why.

Refusing to observe outside the range turns a routine auto-update into a fleet outage — and this
fleet auto-updated its harness three times in two days, twice into a build nobody chose, once into
one that segfaulted on startup fleet-wide. Failing soft with no declaration is how a schema change
becomes a silent wrong answer, the most expensive failure in this design. Downgrade makes the *loss
of confidence* the visible event.

A registry schema is a **private interface**. So an adapter also declares a **probe** — a cheap
check that the declared shape is still there — run at adapter load rather than trusting a version
string.

## 10. One host, two capability schemas

Harness adapters and tracker adapters share a **host**: discovery, manifest format, versioning,
lifecycle, trust, and the subprocess protocol. They do **not** share a capability surface.

A harness adapter answers *is it blocked*; a tracker adapter answers *what issues are open*
([#9](https://github.com/andybarilla/jackdaw/issues/9)). A generic interface spanning both degrades
to `call(method, params)`, which is not a contract. Two separate plugin systems would mean two
discovery mechanisms and two trust stories for no gain.

**The test to apply:** a notification adapter should need a new capability schema and **no change
to the host**.

---

## Worked example: `cursor`, the hardest harness

`cursor` is the case where the tier structure has nothing to climb, and it is the reason the
degraded tier is real rather than a footnote.

| | |
|---|---|
| `liveness` | `native` — process tree. **The only thing that works.** |
| `activity` | `scraped` — tier 3, untested (never installed across four studies) |
| `blocked` | **`unavailable`** |
| `last_change` | `unavailable` — derived from `activity` only, so only as good as the scrape |
| `session_artifact` | **`unavailable`** — a transcript exists but its path is documented nowhere first-party; runtime-only via `transcript_path` / `CURSOR_TRANSCRIPT_PATH` |
| `addressing` | `prompt`/`read` via `send-keys`; `interrupt` **not declared safe mid-tool-call** |

**`blocked` is `unavailable` even though `cursor` has permission hooks.** This is #2's
*deciding is not observing*: `session/request_permission` exists only on `cursor-agent acp`, a
JSON-RPC channel that **replaces the TUI**, so it is unusable under tmux. Its hooks can *decide* a
permission and never announce that the agent is stuck. A capability matrix built on "has permission
hooks" scores `cursor` wrongly — this contract scores it correctly because the question asked is
*can you observe that it is blocked*, not *do you have hooks*.

Consequences, which is the point of the exercise:

- It never rises above **tier 0** in any way that matters. Tier 1 and 2 unlock nothing, because the
  only channel that would help replaces the interface Jackdaw supervises through.
- Its `session_artifact` being `unavailable` means the harness-agnostic session layer — the bet the
  whole map rests on — **does not cover `cursor`**, and the contract says so out loud rather than
  discovering it during implementation.
- A `cursor` pane on the console is a permanent, labelled blind spot for `blocked`. That is the
  honest rendering, and it is only possible because `unavailable` is a first-class answer.
- Everything above is **declared from documentation**, so its version range is narrow and its probe
  fails immediately on a real install. That is correct behaviour, not a defect.

## Worked example: `pi`, which fails differently

`pi` is not unobservable. It is **actively misleading**, and the contract must be able to say so.

| | |
|---|---|
| `liveness` | `native` |
| `activity` | `native` at tier 1 — OSC 9;4 → `#{pane_pb_state}`, 22 ms, one clean ON/OFF per turn including across tool calls; requires `terminal.showTerminalProgress` on and **tmux ≥ 3.7** |
| `blocked` | **`unavailable`** — no approval gate exists to observe |
| `last_change` | `native`, from the same channel |
| `session_artifact` | `artifact` — JSONL |
| `addressing` | `prompt`/`read`; `interrupt` per harness |

Three things this example exists to demonstrate:

1. **The trap the contract must prevent.** `pi` prints `Working...` in its own reply text and is
   non-alt-screen, so a scrape reads it as working **forever**, with no idle or blocker rule to
   recover from (#8). A naive adapter would declare `activity: scraped` and be confidently wrong.
   The version-range-plus-probe rule (§9) and the requirement to declare a *method* are what stop
   that being invisible.
2. **A tier-1 native signal with a substrate precondition.** OSC 9;4 needs a launch-time setting
   *and* tmux ≥ 3.7 — so `activity: native` is conditional on facts about the machine, not only the
   harness. On tmux 3.2–3.6 this observation downgrades, exactly as §9 describes.
3. **`blocked: unavailable` is not a failure of the adapter.** `pi` has no approval concept, so
   blocked and idle are genuinely the same state there. The `pi` adapter is complete and correct;
   the harness is partial.

Also settled and worth recording against the OSC 133 marks `pi` emits: they are a **render
artifact**, not a channel — no `D` mark exists, `B`/`C` are byte-adjacent 30 of 30 so they span no
interval, they are absent exactly on tool-running turns, and they vanish in fullscreen mode (#17).
An adapter must not declare them.

## What this does not settle

- **The tracker-adapter capability schema** — [#9](https://github.com/andybarilla/jackdaw/issues/9),
  which this unblocks. The host is settled here; the surface is not.
- **The manifest's concrete syntax.** The contract fixes what a manifest must express, not its
  serialisation.
- **Push instead of poll at the harness's own layer.** `claude` opens a per-session unix socket
  that may offer a status subscription; polling at 0.40 ms already clears the bar, so this stays
  fog.
- **`cursor` in reality.** Its entire row is declared from documentation and has never been
  executed.
