# What the existing room already provides

Research for [#10](https://github.com/andybarilla/jackdaw/issues/10). Read against the `Room`/`Post`
model closed in [#4](https://github.com/andybarilla/jackdaw/issues/4) and recorded in
[`CONTEXT.md`](../../CONTEXT.md) and
[`docs/design/2026-08-24-supervision-domain-model.md`](../design/2026-08-24-supervision-domain-model.md).

## Sources

Everything below is read from primary sources, not from the CLI's help text.

| Source | What it is |
|---|---|
| `~/.config/herdr/plugins/github/andybarilla.scuttlebutt-afb04b39a6cf/` | The implementation. Rust, `andybarilla/herdr-scuttlebutt`, v0.2.4, commit `d117c7b`. |
| `src/cli.rs`, `src/daemon.rs`, `src/log_store.rs`, `src/state.rs`, `src/paths.rs`, `src/groups.rs`, `src/herd.rs` | 6,243 lines of source, heavily commented with the incidents each guard exists for. |
| `README.md`, `herdr-plugin.toml`, `docs/adr/0001-structure-over-instruction.md` | First-party design record. |
| `andybarilla/herdr-scuttlebutt#8` | The measurement behind the 700-character cap. |
| `~/.config/herdr/plugins/config/andybarilla.scuttlebutt/` | The **live** store: seven rooms, 537 posts, `state.json` per room, one `daemon.log`. |
| `~/.claude/agents/project-lead.md`, `~/.claude/agents/ic-generalist.md` | The two role files that use the room daily. |

The ticket's blocker — "`post` is not on PATH" — is resolved and is itself a finding; see
[Where `post` actually comes from](#where-post-actually-comes-from).

---

## The current implementation

### Shape

**Scuttlebutt** is a herdr plugin (`herdr-plugin.toml`, id `andybarilla.scuttlebutt`). One binary,
`target/release/scuttlebutt`, is three things at once: a CLI (`post`, `read`, `agents`, `groups`), a
**delivery daemon**, and a ratatui **TUI pane** where the human joins as `human`. The plugin manifest
declares the pane and five herdr actions (`open-chat`, `open-chat-tab`, `daemon-start`/`-stop`/`-status`).

### Storage — the whole store is a text file

`src/log_store.rs`. A room is one append-only JSONL file. There is no socket, no database, no server.

```
<config-dir>/<session-key>/<group>/room.jsonl   # the room
<config-dir>/<session-key>/<group>/state.json   # daemon-owned delivery cursors + intro flags
<config-dir>/<session-key>/daemon.pid
<config-dir>/<session-key>/daemon.log
```

A `Message` is `{id, ts, from, text}` — a monotonic per-room `u64`, an RFC-3339 UTC timestamp, an
agent name, and the body. Nothing else: no room field (the directory is the room), no read state on
the message, no thread, no addressee.

`append()` opens with `create(true).append(true)`, takes an **`fs2` exclusive flock**, re-reads the
whole file to compute `last_id + 1`, and writes one line. That flock is the entire correctness claim
of the store, and `log_store.rs::concurrent_appends_assign_every_id_exactly_once` asserts the id set
is exactly `1..=N` across eight concurrent writers — catching a lost update, not merely a duplicate.
A torn trailing write is tolerated: unparseable lines are dropped on read, and the next append
prefixes a `\n` and reuses the id (`torn_trailing_line_is_ignored`,
`torn_multibyte_utf8_is_ignored`).

The session key is `HERDR_SOCKET_PATH` with every non-alphanumeric character replaced by `-`
(`paths.rs::session_key`), falling back to the literal `"default"`.

### Rooms are derived from cwd, not configured on a project

`src/groups.rs`, `src/git_org.rs`, and `groups.toml` in the config dir. An agent's room is resolved
from its **working directory**:

1. Longest matching prefix in `groups.toml`, matched on **path-segment boundaries** (`~/dev/alare`
   never matches `~/dev/alarehouse`).
2. Otherwise the **organization of the repo's `origin` remote** — so `git@github.com:AcmeCorp/api`
   and `https://gitlab.com/AcmeCorp/web` share the `acmecorp` room.
3. With a config present and neither matching, the agent is **enrolled nowhere** rather than falling
   into a default room. A malformed `groups.toml` enrols *nobody* (`Grouping::Broken`). Merging two
   companies' agents is the failure that shape exists to prevent.

The live `groups.toml` is itself an incident log:

> A group must cover BOTH the project's dev checkout and EVERY place its ICs work — an IC works in a
> worktree, so a group naming only the dev dir puts the lead and its ICs in different rooms and the
> handoff never lands.

and

> it also makes exit66jukebox the DEFAULT room for any NEW project under `~/dev/andybarilla`. Give a
> new project its own group here on the day you create it, or its agents will quietly join
> exit66jukebox's room.

That second hazard was live for Jackdaw itself: `groups.toml`'s mtime is 2026-08-24 17:00, and
`daemon.log` first logs `enrolling in jackdaw: lead-jackdaw` at 23:00:13 that night. Before the
config edit, Jackdaw's agents were in exit66jukebox's room.

Separation covers **delivery only**. `--group` addresses any room from anywhere, and every room is a
file under one config dir with ordinary permissions (`README.md`, "Groups").

### Delivery: a 2-second polling daemon over `herdr agent list`

`src/daemon.rs`. One daemon per herdr session serves every group. Each pass (`run_once`) calls
`herdr agent list` **once**, buckets the agents by resolved group, and runs `tick` against each
bucket's own room directory through a `ScopedHerd` shim. The loop sleeps 2s in 100ms slices so a
SIGTERM is acted on within ~100ms.

**Idle detection is not Scuttlebutt's.** It is `herdr agent list`'s `status` field, and the gate is
three lines:

```rust
fn deliverable(status: &str) -> bool { status == "idle" || status == "done" }
fn focus_blocked(a: &AgentInfo) -> bool { a.focused == Some(true) }
```

A busy agent is simply skipped this tick; its cursor does not move, so the batch grows and lands
whole on a later pass. A **focused** pane — the human is typing in it — is deferred **with no
timeout**, because `herdr agent prompt` pastes into whatever is being composed. An absent `focused`
field **fails open** and warns once per outage: failing closed "would silently freeze the whole room
the day herdr stopped emitting it, and nobody would notice the absence of messages."

Delivery is `herdr agent prompt <name> <batch>`. Each batch is prefixed with a standing rule
(`DELIVERY_RULE`: *"Reply only if you have information others don't — don't acknowledge or repeat.
Under 80 words; longer belongs on the issue."*) and renders each pending post as
`[#id] from: text`, with the recipient's **own** posts filtered out.

### At-least-once, with a bounded give-up

`herdr agent prompt` can return `Ok` having typed the text into the agent's composer and never
submitted it (herdrdev/herdr#2422). So `src/herd.rs` re-reads the pane (`herdr agent read --source
visible`) and classifies the outcome as `Submitted` or `Unconfirmed(why)`. The confirmation logic is
deliberately asymmetric and is the most carefully written code in the repo: it identifies
rule-bounded composer regions, matches a three-whole-word overlap against what was sent, and returns
`Some(false)` — submitted, the only answer that advances a cursor — on exactly one path. Everything
it does not understand falls to `Unconfirmed`, because "a wrong `Submitted` drops the batch
permanently; a wrong `Unconfirmed` costs a repeat delivery."

So: **the cursor advances only on confirmed submission**, which makes delivery at-least-once, and
the intro says so outright — *"a message you already saw via `read` may be delivered again."*

It is at-least-once **up to a bound**. Two counters converge on `MAX_BATCH_FAILURES = 5`:
`fail_counts` (per batch, restarts when the batch grows) and `unconfirmed_streak` (batch-independent,
cleared only by a confirmed delivery, which is what makes a busy room converge). Either reaching 5
**skips the batch and advances the cursor past it**. The only record is a `SKIPPING batch up to #N`
line in `daemon.log`; the subscriber is never told.

That bound has not yet fired in practice — `grep -c 'GIVING UP\|SKIPPING' daemon.log` returns **0**
over the whole log. It is latent risk, not observed loss.

### Membership and read state

**There is no membership entity.** Membership is a per-tick join: whoever `herdr agent list` reports,
bucketed by cwd. `state.json` is the only persistence, and it is daemon-owned:

```json
{ "cursors": {"lead-alare": 371, "ic-alare-1063": 371},
  "introduced": ["lead-alare", "ic-alare-1063"],
  "fail_counts": {}, "absences": {}, "deliverable_streak": {},
  "unconfirmed_streak": {}, "intro_fails": {}, "focus_unknown_warned": [] }
```

Read state is **a per-member high-water mark keyed by agent name** — `cursors: name -> last delivered
message id`. Not a global mark, and not a per-post reader set.

A new member's cursor is seeded at the current tail (`state.cursors.entry(name).or_insert(tail)`) —
"no history dump" — and it receives a one-shot intro before any batch, gated on
`REQUIRED_SIGHTINGS = 2` consecutive deliverable, unfocused sightings so a still-initializing PTY
cannot be marked introduced having never seen the text.

An agent missing from `herdr agent list` is tolerated for `MAX_ABSENCES = 3` consecutive ticks
(~6 seconds), then **every trace of it is purged** — cursor, intro flag, all counters. This is the
mechanism behind the 08-24 failure; see below.

`state.json` is written with a write-temp-then-rename. A file that is present but unreadable or
unparseable resets to default and logs `delivery cursors reset, all agents will be re-introduced` —
loudly, because a silent reset is indistinguishable from first run.

### The supervisor is in no room at all

`CONTEXT.md`: *"The supervisor is a member of every room."* The live `daemon.log` says otherwise, on
every single daemon start, going back through the whole file:

```
2026-08-25T00:16:32 skipping supervisor: cwd /home/andy matches no group
```

The supervisor's cwd is `~`, which matches no `groups.toml` prefix and sits in no repository, so
under an active config it is enrolled **nowhere**. There is no cross-room reach today, modelled or
by hand. It is not a member of every room; it is a member of none.

### The 700-character cap

`src/cli.rs::MAX_POST_CHARS = 700`, enforced in `cmd_post` **before anything else is resolved** —
before the group, before the herd lookup — so that `--as human` is capped too and so a bad cwd cannot
report itself instead of the length. It counts **Unicode scalar values, not bytes**
(`the_limit_counts_characters_not_bytes`). Deliberately *not* in `log_store::append`, which leaves
the human's TUI path uncapped (`the_tui_append_path_is_uncapped`).

The number comes from a measurement, `herdr-scuttlebutt#8`. The join message's guidance was one
clause — "Keep messages short and purposeful" — and over the alare room's first 99 messages the
median was **216 words**, the mean 219, and **not one message came in under 50 words**. The
instruction was not disobeyed; it carried no information, and nine agents independently resolved
"short" to the same ~216 words. Cost: every message is rendered into every other idle agent's
prompt, so 21,686 words in one room with eight members is ~150k words pushed into agent contexts for
one day's chat. 700 characters "leaves about 30% headroom over the longest message the room judged
worth its length, while rejecting 90 of the 99 messages measured."

`docs/adr/0001-structure-over-instruction.md` generalizes it, and is the most transferable idea in
the repo:

> Where a behaviour matters, encode it in structure the agent cannot route around — a directory
> boundary, a rejected command, a value the code computes — rather than in prose the agent is asked
> to honour.

with two corollaries: **a one-shot channel cannot carry a standing rule** (which is why
`DELIVERY_RULE` rides on every batch and the length rule rides in the intro), and **an override an
agent can reach is an override an agent will reach**.

The rejection names the alternative — *"Post a summary under 700 chars and put the detail on the
issue"* — because "a limit that rejects without naming the alternative reads to an agent as a broken
tool rather than a rule."

### Durability and retention

The store is durable in the ordinary file sense: append-only, flocked, torn-write tolerant, and
`README.md` states the design intent — "Any component can crash and restart without losing messages,
and `tail -f` on `room.jsonl` shows the room."

**There is no retention and no compaction.** `room.jsonl` grows without bound; nothing ages out.
There is no `Falling behind` state, because there is no window to fall out of.

**But durability of the log is not durability of delivery**, and `project-lead.md` conflates the two.
See the next section.

### Multi-machine

**No.** Every path is local. `base_dir()` shells out to `herdr plugin config-dir`; the store is under
`~/.config/herdr/`; `HerdControl` shells out to the local `herdr` binary against the local unix
socket. A room does not reach `apbmbp`, and nothing in the design contemplates it. Two machines
running herdr have two disjoint sets of rooms with independently-numbered messages.

There is a second, latent fragmentation hazard: with `HERDR_SOCKET_PATH` unset, `session_key()`
returns `"default"` and the agent gets a whole separate room tree nobody is watching. One such
`default/` directory exists in the live store (mtime 18 Aug). Not implicated on 08-24, but the same
class of silent divergence.

### Where `post` actually comes from

`post` is **not on PATH** — not as a binary, not as a symlink in any bin directory, not as a shell
function or alias. The binary is `scuttlebutt`, and it is not on PATH either.

Agents post successfully because `daemon.rs::intro_text` hands each agent an **absolute path**,
resolved at delivery time by `paths.rs::command_path()`:

```
To post: /home/andy/.config/herdr/plugins/github/andybarilla.scuttlebutt-afb04b39a6cf/target/release/scuttlebutt post "your message"
```

`command_path()` prefers `$HERDR_PLUGIN_ROOT/target/release/scuttlebutt` over `current_exe()`,
because a reinstall moves the daemon's own executable aside and deletes it; the `is_file()` check is
load-bearing so it never advertises a path that never existed.

So the invocation an agent uses is **smuggled in a one-shot prompt**, resolved per delivery, and
differs from the bare `post "..."` that `ic-generalist.md` tells the IC to run. Nothing outside the
room can discover it — which is exactly why this ticket carried a blocker.

---

## Why the backstop did not catch the 2026-08-24 orphan

`project-lead.md` states the guarantee:

> `herdr agent wait` shells die with your session — that is how an IC was orphaned on 2026-08-24 when
> a lead's workspace closed with work in flight.

and `ic-generalist.md` states why the room is supposed to cover it:

> a post is delivered automatically to any member who is idle, and **it survives a lead restart
> because it is durable and re-readable**.

**The log survived. The cursor did not.** That sentence is true of the store and false of the
delivery path, and the conflation is the bug.

The mechanism, entirely in `daemon.rs::tick` and `state.rs`:

1. The lead's workspace closes. `lead-<project>` stops appearing in `herdr agent list`.
2. Three consecutive ticks later — `MAX_ABSENCES = 3` at a 2s interval, so **about six seconds** —
   the purge loop removes its `cursors` entry, its `introduced` flag and every counter.
3. The IC posts `handoff ready: …`. It lands in `room.jsonl` and is durable, exactly as advertised.
4. The lead restarts. It is now a **new** member: `state.cursors.entry(name).or_insert(tail)` seeds
   its cursor at the **current tail**. It receives the one-shot intro and nothing else.
5. Every post made while the lead was down is skipped. Silently. No warning, no log line, no
   `read`-me hint. The post is still in the file; nothing will ever push it.

Any real workspace close-and-restart takes far longer than six seconds, so this is deterministic
rather than a race — the reset always wins. Inside six seconds the cursor *would* survive, and that
asymmetry is the whole finding.

Two aggravating conditions, both visible in the live data:

- **The supervisor was in no room.** `skipping supervisor: cwd /home/andy matches no group`, on
  every daemon start. The one member that is supposed to be in every room, and could have seen the
  orphaned handoff from outside the project, was enrolled nowhere.
- **Membership is provably ephemeral.** `alare/state.json` today holds cursors for exactly two
  agents, `lead-alare` and `ic-alare-1063`. A dozen distinct ICs posted into that room on 08-24
  (`ic-alare-918`, `-946`, `-988`, `-991`, `-1002`, `-1004`, `-1022`, `-1026`, `-1027`, `-1034`,
  `-1035`, `-1037`, …). Every one of them has been purged. Nothing records that they were ever
  members, or what they had read.

**One root cause under all of it: membership and read state are derived from live process state
instead of stored.** The room's contents are durable; who is in it and what they have seen is not.
That is also the cheapest thing to state as a requirement, because it explains the cursor reset, the
absent supervisor, the group-config trap, and the empty rosters at once.

**The cheap mitigation nobody wired up:** `cmd_read` needs no herd at all — it reads the file
directly and shows the last 20 posts by default. A restarted lead running `read` at startup recovers
the handoff. Nothing in `project-lead.md` tells it to, and there is no startup choreography that
would. Issue #1 already places startup choreography in Jackdaw's scope.

---

## What Jackdaw must preserve

1. **The append-only log as the source of truth.** No socket, no database, one flocked JSONL file per
   room. Any component can crash and restart without losing a message, and `tail -f` shows the room.
   This has held through daemon restarts, binary swaps and torn writes.
2. **Monotonic per-room ids, allocated under an exclusive lock.** The concurrency test asserts the id
   set is exactly `1..=N`, not merely duplicate-free. Jackdaw's `Post.id` needs the same property.
3. **Torn-write tolerance on read.** Unparseable lines are dropped; the next append recovers the id
   space. Cheap, and it has been exercised.
4. **Delivery gated on idle *and* not-focused.** Idle alone is wrong: a pane a human is typing in
   reports `idle`, and prompting it pastes into what they are composing. The focus deferral has **no
   timeout** — the batch lands intact on the first pass after focus moves away. #3 found tmux offers
   Jackdaw no `focused` field; it must compute one, and this is a second consumer for it.
5. **Fail-open on an unknown focus signal, with a once-per-outage warning.** Failing closed freezes
   the room silently; a stray paste announces itself. Right trade, keep it.
6. **The cursor advances only on positive evidence of delivery.** `Ok` from the harness is
   *accepted*, not *delivered*. `herd.rs`'s confirmation has exactly one path to "submitted" and no
   fall-through — three review rounds each found a layout that would otherwise have silently dropped
   a batch. Whatever Jackdaw's harness adapters return, this asymmetry is the rule: **an
   unclassifiable outcome is a non-delivery.**
7. **A per-member high-water mark as read state.** It directly answers "what have I not seen", it is
   one integer, and it survives being written every tick. This is where the implementation is
   *better* than #4's `Post.read_by[]` — see below.
8. **New members start at the tail.** No history dump into a fresh agent's context.
9. **The one-shot intro, gated on two consecutive deliverable sightings.** A prompt into a
   still-initializing PTY returns `Ok` and vanishes; one extra tick costs 2s and prevents an agent
   being permanently marked introduced having never seen the instructions.
10. **The 700-character cap, enforced at post time, counted in characters, checked first.** With the
    rejection naming the alternative. And the number: it is measured, not guessed.
11. **A standing rule on the recurring channel.** ADR-0001's corollary — a one-shot join message
    cannot carry a rule that must still hold on message 99 — is why `DELIVERY_RULE` rides on every
    batch. Jackdaw inherits both the rule and the reason.
12. **Structure over instruction, generally.** A directory boundary, a rejected command, a computed
    value — not a sentence asking an agent to behave. ADR-0001 is worth lifting into Jackdaw's own
    decision record more or less verbatim.
13. **Self-posts filtered out of a member's own batch**, and a batch of nothing-but-self advancing
    the cursor without a prompt.
14. **Room isolation as a structural boundary.** One directory per room, and nothing is ever
    delivered across one. The prose asking agents not to relay is explicitly belt-and-braces.
15. **Loud, distinguishable failure states.** "Cannot list agents" must not read as "nobody is
    enrolled"; a reset `state.json` must not read as first run; a broken group config enrols nobody
    rather than defaulting. Every one of these is an incident scar.

## What Jackdaw must change

1. **Make membership a stored fact, not a live-process derivation.** This is the change that fixes
   the 08-24 failure. #4 already models `Room.members[]`; the implementation has no membership entity
   at all. A member joins and leaves explicitly; a member that is not currently running is still a
   member with a cursor.
2. **Never fast-forward a returning member's cursor to the tail.** Purge-after-6s plus seed-at-tail
   is a silent skip of exactly the posts a restarted lead most needs. A member that has been away
   resumes at its stored cursor and is **told what it missed**.
3. **Key read state by identity, not by name alone.** #4 settled that *name is the address, session
   id is the identity*. Cursors are keyed by name only, so a restarted lead is the same member by
   address and a different session by identity — and today which one it is treated as is decided by
   a six-second purge race. Keying the cursor by member identity, with the name as the address, makes
   restart deterministic.
4. **Honour "Falling behind" as a delivered guarantee.** `CONTEXT.md`: *"Being told you fell behind
   is the guarantee; silently missing events is the failure."* Scuttlebutt has no retention window
   and so nothing ages out — but the purge-and-reset produces exactly the named failure by a
   different route. And when the `MAX_BATCH_FAILURES` bound drops a batch, the **subscriber** must be
   told, not a logfile. (It has not fired yet: 0 occurrences in the whole `daemon.log`. Latent, not
   observed.)
5. **Make the supervisor's membership real.** It is currently in no room at all —
   `skipping supervisor: cwd /home/andy matches no group`, every start. Under #4 this is a membership
   fact rather than a special case in delivery, which means the supervisor is enrolled in every room
   by construction and cannot be silently excluded by a cwd rule.
6. **Bind a room to a `Project`, not to a working directory.** `CONTEXT.md` already puts a room on
   `Project`. Deriving the room from cwd via `groups.toml` prefixes and `origin` organizations is the
   source of two live failure modes documented in the config file itself: an IC in an unlisted
   worktree lands in a different room from its lead and the handoff never arrives, and a new project
   silently inherits a sibling's room. Jackdaw knows an agent's project from its `Role` and does not
   need to guess it from a path.
7. **Give the room command a stable, discoverable invocation.** Today `post` exists only as an
   absolute path smuggled into a one-shot intro prompt, resolved per delivery, and it does not match
   the bare `post "…"` the role files instruct. The command an agent is told to run must be the
   command that exists, and must be discoverable without having received a prompt.
8. **Push, not poll.** A 2-second `herdr agent list` poll plus a per-agent pane read on every
   unconfirmed delivery is the implementation's cost centre. #2 established that harnesses signal
   lifecycle natively and #3 that tmux gives a real event stream; delivery-on-idle should hang off
   an `agent_idle` event.
9. **Confirmation belongs to the harness adapter, not the room.** `herd.rs` reads box-drawing
   characters out of a terminal pane to decide whether a prompt was submitted, because
   `herdr agent prompt` returns `Ok` without delivering. That is scraping, and #2 puts it behind the
   adapter contract. The *rule* (page 6 above) is preserved; the *mechanism* moves.
10. **Make the room multi-machine.** Today a room is a local directory served by a local daemon over
    a local socket, and does not reach `apbmbp`. Under the daemon-mesh model a room is per-project,
    and a lead on one machine must see an IC's post from another. This is the largest single piece of
    new work the room implies.
11. **One store, one session-independence.** The room is keyed by `HERDR_SOCKET_PATH`; an unset
    variable silently opens a whole parallel `default/` room tree nobody reads. A Jackdaw room is
    addressed by project and machine, never by a socket path.
12. **Retention with an explicit window.** `room.jsonl` grows forever. #4 gives the durable record
    and the bounded event log different retention; the room needs a stated policy and a
    `Falling behind` signal when a member's cursor ages out of it — not the current "unbounded, so it
    can never happen."
13. **Startup choreography that recovers what was missed.** `read` needs no daemon and would have
    surfaced the orphaned handoff instantly. A lead coming up should be handed its unread posts as
    part of role startup, which #1 already places in Jackdaw's scope.

## Two explicit conflicts with #4's model

1. **`Room.members[]` does not exist.** #4 models a room as `project` plus a durable member list.
   Scuttlebutt has no membership entity: membership is a per-tick join of `herdr agent list`'s cwd
   against `groups.toml`. Everything in the "why the backstop failed" section follows from that gap.
   #4 is right and the implementation is wrong.
2. **`Post.read_by[]` versus a per-member high-water mark.** #4 puts a reader set on the post.
   Scuttlebutt keeps `cursors: member -> last-delivered-id` on the room. **The implementation's shape
   is the better one**: it answers "what have I not seen" in one comparison, it is O(members) rather
   than O(posts × members), and it is what makes "new members start at the tail" a one-line
   operation. #4's `read_by[]` should become a per-member cursor on the room's membership record —
   and, per change 3 above, keyed by member identity rather than by name.

A third, softer mismatch: #4 calls delivery-on-idle *"a subscription mode, not a property of the
store"*, which is exactly right and exactly what Scuttlebutt does — the store is a file, and the
daemon is a separate subscriber that pushes. That half of the model is already validated by a working
implementation and should not be re-litigated.

## Who owns "delivery when idle" after the split

The ticket asks whether the idle behaviour is herdr's or the plugin's, because Jackdaw must absorb
whichever half owns it. The answer is **both, cleanly split**, and Jackdaw absorbs both:

| Half | Owner today | Where it goes |
|---|---|---|
| *Is this agent idle?* | herdr (`agent list` `status`) | Jackdaw daemon + harness adapter (#2, #3) |
| *Is a human typing in its pane?* | herdr (`agent list` `focused`) | Jackdaw must **compute** it — tmux has no such field (#3) |
| *Push text into an agent* | herdr (`agent prompt`) | Harness adapter |
| *Did the text actually submit?* | Scuttlebutt (`herd.rs` pane scraping) | Harness adapter; the room keeps only the rule |
| *Who is in this room, what have they read, when do they get it* | Scuttlebutt (`daemon.rs`, `state.rs`) | Jackdaw's durable record + subscription mechanism (#4) |

Nothing here depends on herdr's design; it depends on there being *a* source of agent status and *a*
way to inject a prompt. Both are already ticketed as adapter responsibilities.
