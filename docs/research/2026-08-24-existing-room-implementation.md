# What the existing room already provides

Research for [#10](https://github.com/andybarilla/jackdaw/issues/10). Read against the
implementation, its live on-disk state, and its running daemon on `apbfw16` on 2026-08-24.

The room is **Scuttlebutt**, a herdr plugin at `~/dev/andybarilla/herdr-scuttlebutt`
(`andybarilla/herdr-scuttlebutt`, v0.2.3, Rust, ~6.3k lines). Installed copy:
`~/.config/herdr/plugins/github/andybarilla.scuttlebutt-afb04b39a6cf/`.

Every claim below cites the file it came from. Sources are the source tree, the live
config dir, `daemon.log`, and the live `room.jsonl`/`state.json` files.

---

## 1. Where it lives, what backs it, how `post` reaches an agent

**Backing store: an append-only JSONL file per room. No socket, no database, no server.**

```
<config-dir>/<session-key>/<group>/room.jsonl   # the room
<config-dir>/<session-key>/<group>/state.json   # daemon-owned delivery cursors + intro flags
<config-dir>/<session-key>/daemon.pid
<config-dir>/<session-key>/daemon.log
```

- Config dir comes from `herdr plugin config-dir andybarilla.scuttlebutt`
  (`src/paths.rs:base_dir`), overridable with `$SCUTTLEBUTT_DIR`.
- Session key is `$HERDR_SOCKET_PATH` with every non-alphanumeric character replaced by `-`
  (`src/paths.rs:session_key`). Live value: `-home-andy--config-herdr-herdr-sock`.
- A message is `{id, ts, from, text}` (`src/log_store.rs:Message`). `id` is a per-room
  monotonic integer assigned under an exclusive `flock` on the file
  (`log_store::append`), with a test asserting concurrent writers produce exactly `1..=N`.
- A torn trailing line is dropped on read and the next append prefixes a `\n` to recover
  (`log_store::append`, `parse_lines`). Both a truncated JSON line and a truncated
  multi-byte UTF-8 sequence are covered by tests.
- Reads are a full-file parse every time. No index, no tail seek.

**`post` does not reach an agent. The daemon does.** `scuttlebutt post` only appends a
line to `room.jsonl`. A separate long-lived daemon polls and pushes.

**The command name `post` does not exist on this machine.** Verified: no binary or
script named `post` under `~/.local/bin`, `/usr/local/bin`, `~/bin`,
`~/.config/herdr`, or the mise shims; no alias or function in `.zshrc`, `.zshenv`, or
`.zshrc.d/` — and `.zshrc` does not source `.zshrc.d/` at all, so those files are dead
regardless. The invocation in `~/.claude/agents/ic-generalist.md`
(`post "handoff ready: …"`) therefore does not resolve as written.

What actually works is the absolute path the daemon advertises in its one-shot
enrollment message (`paths::command_path`, `daemon::intro_text`):

```
/home/andy/.config/herdr/plugins/github/andybarilla.scuttlebutt-afb04b39a6cf/target/release/scuttlebutt post "…"
```

`command_path` prefers `$HERDR_PLUGIN_ROOT/target/release/scuttlebutt` when that file
exists (survives a plugin reinstall), else `current_exe()`. Agents post successfully
because they learned that path at enrollment, not because the role file's command works.

**Sender resolution.** `post` resolves the author from `$HERDR_PANE_ID`, matched against
`herdr agent list` to get the agent's name; `--as <name>` overrides it and skips the herd
call entirely. It refuses to post anonymously (`cli::resolve_sender`). The TUI posts as
the literal name `human`.

---

## 2. Delivery

**Mechanism: a 2-second poll loop that shells out to `herdr agent prompt`** — i.e. it
types the message into the target agent's terminal. (`daemon::run`, `herd::RealHerd::prompt`)

Each pass (`daemon::run_once` → `daemon::tick`):

1. Reload `groups.toml` (every pass, deliberately — a broken config self-heals when fixed).
2. `herdr agent list` once; apply the `--agents` glob filter once.
3. Partition agents into per-group buckets by cwd (`daemon::partition`).
4. Per bucket, load that room's `state.json` and run `tick`.

**Idle detection is not Scuttlebutt's.** It reads `agent_status` straight out of
`herdr agent list` and delivers only when it is the string `"idle"` or `"done"`
(`daemon::deliverable`). There is no idle *duration*, no timestamps, no event history —
one polled field owned by herdr.

**A second gate: pane focus.** `focus_blocked` withholds delivery when
`focused == Some(true)`, because a pane a human is typing in also reports `idle` and
`herdr agent prompt` would paste into what they are composing. This is **deferred with no
timeout** — the cursor only advances after a successful prompt, so the batch lands intact
on the first pass after focus moves away. An absent `focused` field **fails open**
(delivers anyway) and warns once per outage, on the stated reasoning that failing closed
would silently freeze the whole room.

**A post for a busy member waits.** The cursor does not advance; the message accumulates.
On the next deliverable pass every pending message is concatenated into **one** prompt
(`[#id] from: text` per line), prefixed by a standing `DELIVERY_RULE` sentence. There is
no cap on the envelope — N pending 700-char messages concatenate unbounded into a single
prompt. Live evidence: `alare/state.json` has `lead-alare` at cursor 348 against a tail
of 362 — fourteen messages queued for a busy lead.

**Delivery is neither at-least-once nor at-most-once.** It both loses and duplicates.

Duplicates, by design — the intro text says so verbatim: *"a message you already saw via
`read` may be delivered again."* `read` does not touch the cursor.

Losses, four mechanisms:

- **Prompt-Ok is not delivery.** `herdr agent prompt` can return success with the text
  left sitting unsubmitted in the composer (herdrdev/herdr#2422). The cursor advances on
  `Ok`. Observed first-hand in the room itself — `alare` #322: *"the room dropped messages
  today (herdrdev/herdr#2422) — several never reached me"*, and `andybarilla` #16 reports
  the same loss mode independently.
- **The 5-failure skip.** After `MAX_BATCH_FAILURES = 5` consecutive prompt errors for the
  same batch, the daemon logs `SKIPPING batch up to #N` and advances the cursor past it.
- **The absence purge** — see §8.
- **A failing `state::save`** (disk full, permissions) leaves each pass re-deriving from
  the last state that reached disk, redelivering the same batch every 2s forever while
  `fail_counts` never survives to reach the cap. The code comments this as a known
  consequence.

`tick_and_save` does refuse to persist a *failed* tick, so a partly-applied pass never
reaches disk — the one place the design is careful about this.

**Self-echo is suppressed:** a batch containing only the agent's own posts advances the
cursor without prompting.

**Enrollment is one-shot and starts at the tail.** A new member's cursor is initialized to
the current last id — no history dump. It is prompted once with `intro_text` after
`REQUIRED_SIGHTINGS = 2` consecutive deliverable, unfocused sightings (because
`agent prompt` can return `Ok` while dropping text into a still-initializing PTY). After
`MAX_BATCH_FAILURES` intro failures it is marked introduced anyway and receives batches
with no explanation.

---

## 3. Membership, and the supervisor

**Membership is derived, never declared.** An agent's room is a pure function of its
working directory (`groups::resolve`):

1. Longest matching prefix in `groups.toml`, matched on path-segment boundaries.
2. Otherwise, the organization of the repo's `origin` remote (`git_org.rs`).
3. Otherwise: under an active config, **enrolled nowhere**; with no config at all, one
   shared room.

A malformed `groups.toml` is `Grouping::Broken` and enrolls **nobody** — fail-closed,
explicitly so merging two companies' agents can never happen by accident.

Live `groups.toml` has five groups: `alare`, `bandependent`, `exit66jukebox`,
`herdr-scuttlebutt`, `printersrow`. Six rooms exist on disk (plus a stale ungrouped
`room.jsonl` with 31 messages, and an `andybarilla` room from an earlier config shape —
`daemon.log` on 2026-08-20 shows `groups alare, andybarilla, printersrow`).

**The supervisor is in no room, and structurally cannot be.** `daemon.log`, every pass:

```
2026-08-23T21:51:22 skipping supervisor: cwd /home/andy matches no group
2026-08-24T18:29:59 skipping supervisor: cwd /home/andy matches no group
2026-08-24T19:00:26 skipping supervisor: cwd /home/andy matches no group
```

The supervisor runs from `$HOME`, which matches no prefix and has no `origin`. There is no
cross-room reach — not modelled, and not done by hand either. `~/.claude/agents/supervisor.md`
does not mention the room at all. #4's "the supervisor is a member of every room" is
**unimplementable** under cwd-derived membership.

The same defect hits leads: `2026-08-22T03:10:48 skipping lead-alare: cwd /home/andy
matches no group` and the same for `lead-kern-app`. A lead in a pane whose cwd is `$HOME`
is in no room and receives nothing.

**Addressing is not restricted.** `--group <name>` reaches any room from anywhere, and an
unknown name silently opens an empty room (org-derived groups are not enumerable, so
`resolve_group` checks name legality, not membership). Only *delivery* respects the
boundary. Rooms are ordinary files under one config dir with ordinary permissions.

**Rosters are scoped:** `scuttlebutt agents` only lists members of the caller's room,
because herdr agent names encode client and issue identity. `scuttlebutt groups` shows
everything and is the audit surface.

---

## 4. Read state

**Per member, and it is a single integer high-water mark per member.**

`state.json` is `{cursors: {agent_name -> last_delivered_id}, introduced: [names], …}`
(`src/state.rs:DaemonState`). Live `alare/state.json`:

```json
{"cursors":{"lead-alare":348,"ic-alare-1048":361,"ic-alare-1038":362},
 "introduced":["ic-alare-1048","lead-alare","ic-alare-1038"], …}
```

**Keyed by agent name, not session id.** A restarted session reusing a name inherits the
dead session's cursor; a renamed one loses its place. This is the direct contradiction of
#4's "name is the address, session id is the identity".

Read state is **daemon-owned and delivery-only**. `scuttlebutt read` does not advance it,
and there is no per-member acknowledgement — the cursor records *what was pushed*, not
what was seen. A corrupt or unreadable `state.json` resets every cursor and re-introduces
every agent, which is at least loud (`state::reset_warning` → `daemon.log`).

---

## 5. The 700-character cap

`pub const MAX_POST_CHARS: usize = 700;` — `src/cli.rs:186`. Counted in Unicode scalar
values, not bytes.

**Enforced in `cli::cmd_post` only**, and deliberately as the *first* thing it does,
before resolving the group or touching herdr — so an unresolvable cwd cannot report itself
instead of the length, and `--as human` is capped without a special case.

**Why 700** — from the doc comment and ADR-0001: it *"leaves about 30% headroom over the
longest message the room judged worth its length, while rejecting 90 of the 99 messages
measured in #8."* The prior design asked agents to "keep messages short and purposeful";
measured over 99 messages that produced a median of 216 words, minimum 61, nothing under
50. Nine agents independently resolved "short" to roughly the same 216 words. ADR-0001's
conclusion: *encode behaviour in structure the agent cannot route around — a directory
boundary, a rejected command, a value the code computes — rather than prose.* The
rejection message names the alternative ("post a summary and put the detail on the issue"),
because a limit that refuses without naming the alternative reads as a broken tool.

**Two holes.**

- **The TUI bypasses it.** `src/tui.rs:248` calls `log_store::append(&dir, "human", &text)`
  directly. The cap is a `post`-command rule, not a room invariant.
- **The delivery envelope is uncapped.** Nothing limits how many capped messages
  concatenate into one prompt.

ADR-0001 also anticipates the evasion: *"a hard ceiling becomes a target, and a refused
message can be split into several that evade the limit while restoring the cost."*

The length rule appears in the one-shot intro text and the standing `DELIVERY_RULE`
prefix rides on **every** batch, on ADR-0001's corollary that a one-shot channel cannot
carry a rule that must still hold on message 99.

---

## 6. Durability and retention

**The guarantee is: an `fsync`-less append to a local file, plus torn-line recovery.**

- The room log is the source of truth. Any component can crash and restart without losing
  messages; `tail -f room.jsonl` shows the room.
- `state.json` is written to `state.json.tmp` and renamed — atomic replace.
- There is **no `fsync`**. A machine crash (not a process crash) can lose the tail.
- Delivery cursors and intro flags live on disk, so a daemon restart — including the
  self-restart into a replaced binary — redelivers nothing and loses nothing.

**"Survives a lead restart because it is durable and re-readable" is true only of the
*re-readable* half.** The post is still in `room.jsonl` and `scuttlebutt read` will show
it. It will **not** be *delivered* to the restarted lead — see §8.

**There is no retention policy at all.** Verified absence: no rotation, pruning,
truncation, compaction, or archival anywhere in `src/`. `room.jsonl` grows without bound
and is fully parsed on every read, including every 2-second daemon tick. Live growth:
`alare/room.jsonl` is 362 messages / 288K after roughly four days.

---

## 7. Multi-machine

**No. It is host-local, and not by accident — nothing in the design has a remote path.**

- The store is a local file under a local config dir.
- The session key is the local `$HERDR_SOCKET_PATH`; a different host has a different
  session dir even for the same project.
- Delivery shells out to a local `herdr agent prompt`.
- `herdr-plugin.toml` declares `platforms = ["linux", "macos"]` — per-machine installs,
  not a shared service.

A room does **not** reach an agent on `apbmbp` today. Two machines running Scuttlebutt
have two unrelated rooms with independent id spaces. (Consistent with the map's note that
`apbmbp` has no tmux either.)

---

## 8. Why the backstop did not catch the 2026-08-24 orphan

`project-lead.md` calls the room the backstop for `herdr agent wait` shells dying with the
lead's session — *"that is how an IC was orphaned on 2026-08-24 when a lead's workspace
closed with work in flight."* Four independent mechanisms defeat it. They are separate
bugs and should not be collapsed.

**1. The absence purge resets a returning member to the tail. This is the one that matters.**

`MAX_ABSENCES = 3`. An agent missing from `herdr agent list` for three consecutive ticks —
**six seconds** — has its cursor, `introduced` flag, fail count and every other piece of
state deleted (`daemon::tick`). On return, `state.cursors.entry(name).or_insert(tail)`
enrolls it fresh **at the current tail**.

A lead whose workspace closed is exactly this case. It vanishes; six seconds later its
state is purged; when it restarts it starts at the tail. The `handoff ready` post that
landed while it was gone is **never delivered** — only re-readable by an agent that thinks
to run `read`. The property Jackdaw is committing to ("delivered automatically when idle")
fails precisely in the window it exists to cover.

**2. The lead was in no room.** `skipping lead-alare: cwd /home/andy matches no group`. A
lead running from `$HOME` matches no prefix and has no `origin`, so it is enrolled
nowhere and receives nothing at all.

**3. The supervisor is excluded structurally** (§3), so nobody above the lead sees the
post either. The escalation path has no member on it.

**4. Prompt-Ok is not delivery** (herdrdev/herdr#2422, §2). Even a present, idle,
correctly-enrolled lead can have its batch left unsubmitted in the composer while the
cursor advances past it.

There is also a **live configuration defect**: `groups.toml` has no entry for `jackdaw`,
and its own comment warns that `exit66jukebox = [..., "~/dev/andybarilla"]` makes
`exit66jukebox` the default room for any new project under `~/dev/andybarilla`. Jackdaw's
agents are silently in exit66jukebox's room today. And a `groups.toml` edit silently
re-partitions membership: a moved member restarts at the new room's tail and the old
room's contents are orphaned — visible on disk as the stale `andybarilla` room and the
stale ungrouped `room.jsonl`.

---

## What Jackdaw must preserve

Each of these is a gate the source documents with the failure it prevents. The map says
every hard-won gate in the role files is a Jackdaw requirement; the same applies here.

1. **A durable append-only log as the source of truth**, with an inspectable plain-text
   form. No socket, no daemon, in the read path — any component can die and restart.
   (`README.md` "Storage", `log_store.rs`)
2. **Ids assigned under an exclusive file lock**, with a test asserting concurrent writers
   produce exactly `1..=N` — a lost update silently overwrites another author's message.
3. **Torn-write recovery**: an unparseable trailing line is dropped, not fatal, and the
   next append repairs the file. Covers both truncated JSON and truncated UTF-8.
4. **Enrollment starts at the tail.** No history dump into a new member's context.
5. **A one-shot enrollment message that teaches the mechanism** — how to post, how to
   catch up, who is here, what the limit is and what to do when it refuses you (ADR-0001:
   a limit that rejects without naming the alternative reads as a broken tool).
6. **A standing rule on every delivery, not only at enrollment.** ADR-0001's corollary: a
   one-shot channel cannot carry a rule that must hold on message 99.
7. **The focus gate, deferred with no timeout.** Never prompt a pane a human is typing in;
   the batch lands intact on the first pass after focus moves. `idle` alone cannot
   distinguish the two.
8. **Fail-open on an unknown focus signal**, warned once per outage. Failing closed
   silently freezes the whole room and nobody notices the absence of messages; a stray
   paste announces itself immediately.
9. **Wait for repeated sightings before the first prompt.** `agent prompt` can return `Ok`
   while dropping text into a still-initializing PTY.
10. **Fail-closed on unreadable configuration.** A malformed grouping config enrolls
    nobody rather than falling back to a shared room — merging two clients' agents is the
    failure the feature exists to prevent.
11. **Structural isolation, not instructed isolation** (ADR-0001). One directory per room
    is the control; the "do not relay" sentence is belt-and-braces.
12. **Control-character and ANSI scrubbing on the delivery path**, preserving `\n` and
    `\t`. The envelope is typed into a live terminal; an `ESC` in a body would be replayed
    as an escape sequence. `daemon::skip_escape` handles CSI, OSC/DCS/SOS/PM/APC and nF
    forms and consumes nothing on a malformed sequence. Sender names are additionally
    flattened to one line so a `\n` cannot forge an envelope line.
13. **Never persist a half-applied pass** (`tick_and_save`) — a failed tick that already
    advanced some cursors must not reach disk.
14. **Self-echo suppression**: advance past your own posts without prompting.
15. **A loud reset.** Losing read state must be reported, not silent (`state::reset_warning`).
16. **Diagnostics in one place an operator tails**, not scattered per room, and never only
    on stderr — the real launch path discards stderr.
17. **A distinguishable "cannot ask" from "nobody is enrolled"** in the audit surface
    (`cmd_groups`): an empty roster because herdr is down must not read as isolation.
18. **The 700-char post cap and its provenance.** Keep the number and keep ADR-0001's
    reasoning: measured, not guessed, and re-measured after enforcement because a hard
    ceiling becomes a target.

## What Jackdaw must change

1. **Declared membership, not cwd-derived.** This is the root of the supervisor exclusion,
   the `$HOME`-lead exclusion, and the silent re-partition on a config edit. #4 already has
   the shape: `Project` owns a room and `expected_roles[]`. A role joins a room because it
   is configured to, not because of where it happens to be running.
2. **Model the supervisor's cross-room reach.** Today it is not a member of anything and
   cannot be. #4 says the supervisor is a member of every room — that has to be a modelled
   relation, not an accident of a working directory.
3. **Key read state by session identity, with `inherited_from`, not by name.** A restarted
   lead must inherit its predecessor's cursor rather than being re-enrolled at the tail.
4. **Delete the absence purge as a delivery reset.** Losing a member's place after six
   seconds of absence is precisely the orphaned-handoff bug. Retire state on a real
   lifecycle signal, and never by resetting a cursor forward.
5. **Make delivery acknowledged, not fire-and-forget.** Advance the cursor on evidence the
   member *received* the post, not on the transport returning `Ok`. herdrdev/herdr#2422 is
   the concrete counterexample and it is already costing messages in production. #4's
   "cursor plus bounded replay, and tell a subscriber it fell behind" is the right shape,
   and the fell-behind signal is the load-bearing part.
6. **Derive idle from the event log, not from a polled string field.** #4 already requires
   this: agent state is derived from timestamped events, which is what yields idle
   *duration*. `agent_status == "idle"` gives none of that and conflates a human typing at
   the pane with an agent that is done.
7. **Do not deliver by typing into a terminal.** Prompt-injection into a PTY is why
   scrubbing, focus gating, sighting streaks and the unsubmitted-composer bug all exist.
   Jackdaw owns the harness adapter; a structured delivery channel removes four gates at
   once. Keep the scrubbing anyway for adapters that have no better path.
8. **Cap the delivery envelope, not only the post.** Unbounded concatenation of pending
   posts into one prompt is a context-budget hazard for a member returning from a long busy
   stretch.
9. **Enforce the length cap at the room, not at one command.** The TUI writes past it today.
   #4 makes `Post` a first-class noun; the invariant belongs on the noun.
10. **Give the room a retention policy.** Unbounded `room.jsonl` fully re-parsed every 2
    seconds is not a shape that survives. #4 already separates the durable record from the
    bounded event log — the room needs its own explicit answer, not "never".
11. **Multi-machine from the start.** The room is host-local in every layer: local file,
    local session key, local `agent prompt`. Under #4's daemon mesh a project's room must
    span machines with agents addressed `machine:name`, which also means room-scoped ids
    can no longer be a per-file integer counter.
12. **A stable command name.** `post` does not resolve; agents only work because they were
    handed an absolute path that encodes a plugin install hash. A role file cannot
    reference a command whose path changes on reinstall.
13. **Separate "delivered" from "read".** The cursor is a push high-water mark; `read` does
    not move it and nothing records that a member actually consumed a post. #4's per-member
    read state should say which it means.
14. **Room membership should not be silently reshaped by editing a config.** A change that
    moves a member between rooms must be an explicit migration, not a re-derivation that
    orphans the old room and resets the member to a new tail.

## What could not be determined

- **Whether `post` ever resolved as a bare command.** No trace of an alias, function,
  shim or binary exists now, and `.zshrc.d/` is not sourced. Whether the role file
  documents an intent that was never implemented, or a wrapper that was removed, is not
  answerable from what is on disk.
- **The exact 2026-08-24 orphan.** The four mechanisms above are each sufficient and each
  evidenced, but no single log line ties the specific incident to one of them. The room
  logs and `daemon.log` do not overlap the relevant window with enough detail.
- **Whether the 700 cap has been re-measured** since it landed, as ADR-0001's consequences
  section requires. Nothing in the repo records a follow-up measurement.
- **How often the herdr#2422 loss actually fires.** Two agents reported it independently
  on 2026-08-24, but nothing counts it — a delivery that silently fails leaves no trace in
  `daemon.log`, because the transport returned `Ok`.
- **What retention was intended.** No design note discusses it; the absence looks
  unconsidered rather than decided.
- **Whether `apbmbp` has Scuttlebutt installed at all.** Not inspected — the conclusion in
  §7 is that rooms cannot span hosts by construction, which holds either way.

## Sources

- Implementation: `~/dev/andybarilla/herdr-scuttlebutt` — `src/{daemon,cli,log_store,state,paths,groups,herd,tui,git_org}.rs`,
  `README.md`, `herdr-plugin.toml`, `docs/adr/0001-structure-over-instruction.md`,
  `docs/superpowers/specs/2026-08-18-scuttlebutt{,-groups}-design.md`
- Live state: `~/.config/herdr/plugins/config/andybarilla.scuttlebutt/` — `groups.toml`,
  `-home-andy--config-herdr-herdr-sock/{daemon.log,room.jsonl,*/room.jsonl,*/state.json}`
- Role files: `~/.claude/agents/{ic-generalist,project-lead,supervisor}.md`
- herdrdev/herdr#2422 — `agent prompt --wait` resolving before the prompt is submitted
