# Mesh transport, peer authentication and role-file distribution

Resolves [#31](https://github.com/andybarilla/jackdaw/issues/31). The framing, envelope and method
vocabulary are [the wire protocol](./2026-08-25-wire-protocol.md); the addressing surface is
[the CLI surface](./2026-08-25-cli-surface.md); the observe-never-act rule is
[reboot reconstruction](./2026-08-25-reboot-reconstruction.md); the runtime is
[Go](../decisions/2026-08-25-daemon-language-go.md).

This closes the two items [#6](https://github.com/andybarilla/jackdaw/issues/6) and
[#26](https://github.com/andybarilla/jackdaw/issues/26) explicitly parked: mesh transport with
authentication, and role-file distribution. They are one problem — *copy a file to a peer* and
*reach a peer* differ only in payload.

## 1. Reachability is a requirement, not a mechanism

**Every machine in the mesh must be directly reachable by every other**, at a configured address.
The fleet gets that from Tailscale today — `apbmbp.cobbler-polaris.ts.net`, which is already what
`~/.ssh/config` dials — but Jackdaw does not depend on it. No `tsnet`, no LocalAPI, no WireGuard
peer identity.

That has one consequence that shapes everything below: **the mesh cannot assume an encrypted or
authenticated substrate underneath it**, so it carries both itself.

A peer's config entry names an address. MagicDNS is broken on `apbfw16` today — `systemd-resolved`
and NetworkManager wired incorrectly — so name resolution is a `jackdaw doctor` check and never an
assumption.

**Tailnet membership is not mesh membership.** The tailnet holds an iPad, a phone and a Hetzner
box. The set of Jackdaw machines is a declaration in config, as everything else in §5 of the CLI
surface is.

## 2. Transport: Jackdaw's own listener, over TLS

**One TLS listener per daemon, bound to a configured address, on a fixed default port.** It speaks
the wire protocol unchanged — same NDJSON framing, same typed frames, same `hello`, same envelope,
same methods. #26 §8 already committed to this and the reason stands: two protocols mean two
implementations of every verb, and the second one drifts.

### 2.1 Why not SSH

The issue expected SSH to inherit `supervisor.md`'s documented traps — `gh` at
`/opt/homebrew/bin/gh` and absent from a bare `ssh host '…'`, no `timeout` on macOS, the login
keychain unreadable from an SSH session. **That expectation is wrong, and it is worth writing down
why.** Every one of those is a trap of *executing a command in a non-interactive SSH session*.
`ssh -N -L` executes nothing and inherits none of them.

SSH loses on three other things:

- **A FIDO2 PIN prompt ignores `BatchMode` and writes to `/dev/tty`.** This fleet's own
  `~/.ssh/config` carries a comment recording it, because it painted over a TUI. A daemon is the
  worst thing in the system to block on a hardware key.
- **Authentication would live in `sshd`, which Jackdaw does not own.** `jackdaw doctor` could not
  diagnose a mesh failure, and an auth failure would arrive as an `ssh` exit code needing
  translation — the exact path by which an unauthenticated peer goes *absent* instead of *blind*.
- **A supervised subprocess per peer**, for a daemon whose job is supervising processes.

### 2.2 Trust is pinned certificates

Each daemon generates a keypair on first start and stores it in the config root at `0600`. **A
peer's config entry carries `name`, `address` and that peer's certificate fingerprint.** Pinning is
mutual: both ends verify.

No CA to operate, no expiry to renew, no issuance path to get wrong. This is `known_hosts` trust,
which is the right shape for a fleet of two machines whose config is hand-edited and
version-controlled.

**No trust-on-first-use.** An unknown fingerprint is refused at `hello`: `blind` with reason
`untrusted` at the dialer, a logged `Event` at the listener. `jackdaw machine trust` prints the
local fingerprint for pasting into a peer's config.

The cost, stated rather than discovered: **adding a machine means editing config on every machine.**
Two edits and a diff today, and it is the same *declaration you can diff* property that made
config canonical in the first place.

### 2.3 Identity comes from the dialer, never from the peer

**`machine:name` is a local config fact.** A response is attributed to the config entry that
reached it. A peer that announces a name in `hello` has it compared and a mismatch reported in
`degraded`; the local config always wins.

#26 §8 requires per-machine attribution on every fan-out, and attribution is what the console ranks
blind-versus-empty on. A peer that could name itself could attribute its answers to another machine.

### 2.4 Version skew needs nothing new

`hello` is already the first frame of every connection and already refuses a major mismatch at
connect time (#26 §7). The mesh reuses it. Relay fidelity is likewise already settled: peer payloads
are relayed as `json.RawMessage` and never round-tripped through a struct, so a newer peer's fields
survive an older relay (#7).

## 3. Topology

**Eager, persistent, one connection per direction.** The daemon dials every declared peer at
startup, holds the connection, and reconnects with backoff. Correlation `id`s are owned by the
dialer, so the two directions never share an id space.

**`blind` is the link's state, not a query result.** Lazy dialing cannot deliver that: a machine
that went down would be discovered the next time somebody asked, so the console's blind ranking
would lag reality by however long nobody looked. #14 §3 needs more than that — peers learn a remote
lease's fate **by event rather than by inferring death across the network**, which requires a
standing subscription.

That subscription is held by the daemon and never by a shell. #6 §3.3 forbids the shell-held case
because it dies silently, which is how an IC was orphaned on 2026-08-24. The daemon-held case is
the sanctioned one, and this is it.

### 3.1 Blind carries a reason

One state, one required machine-readable reason:

| Reason | Meaning |
|---|---|
| `unreachable` | No route to the address |
| `daemon_down` | Host answers, daemon does not |
| `untrusted` | Fingerprint mismatch or unknown |
| `version_refused` | `hello` major mismatch |
| `timeout` | Answered too slowly for the per-peer budget |

A caller testing only blind-versus-visible keeps working. `doctor` and the console get to say
*`apbmbp` refused authentication* rather than *`apbmbp` is not answering* — different problems, with
different humans fixing them.

An unreachable peer is always an entry and never an omission (#26 §8). Per-peer timeouts stay
independently bounded, so one slow machine degrades the answer rather than holding it, and the
response exits `4`.

### 3.2 One hop

**No transitive relay.** Fan-out is a star from the caller.

A relay chain makes attribution ambiguous — whose answer is it, and who vouched — compounds
timeouts past the per-peer budget, and turns a config cycle into a loop.

### 3.3 A trusted peer is fully trusted

**No per-method scoping.** A per-peer ACL implies a threat model where one machine is compromised
but its pinned key is not, which is not this fleet: every box runs one user, and #26 §1 already
rests local authorization on `0600` for that reason. An ACL would also need updating on every new
verb, and a stale one fails by making a method silently stop working across the mesh.

Accountability is a record instead of a permission: **every relayed request is an `Event` on the
destination carrying the originating machine.**

**Two methods are local-only** and return `usage` when addressed as `machine:name`:

- `machine reconstruct` — a peer driving another machine's reconstruction is what #14 §7 forbids.
- `session ready` — an agent's claim about itself, and an agent is always local to the daemon it
  claims to.

## 4. Relay, not reach-in

**A peer only ever asks. The destination daemon executes.**

#14 §7 says a peer may observe another machine's reconstruction but never act on it, while #6 §4
advertises `jackdaw agent prompt apbmbp:lead-talostitle "…"`, which is a write. These were never in
tension, and the mechanism says why: `pane send-keys` acquires a `Lease` and refuses a `focused`
pane, and `focused` means something different on macOS than on Linux — `supervisor.md` records
both. The write can only be correct where it lands.

So #14's rule reads as **never act locally on remote state**. A relayed request is not an exception
to it; there is no reach-in surface at all, and nothing in the mesh touches another machine's tmux,
filesystem or leases directly.

### 4.1 A relayed write carries a stable request key

The link drops mid-`agent prompt`. #26 §6 is explicit that cancellation withdraws interest and
never cancels work, so the honest answer to *did it land* is **unknown** — and a caller that retries
blind sends the text twice into a pane, which is #6 §2.5's concatenation hazard turning `/exit` into
`restart the session/exit`.

**Every relayed write carries a request key in its payload: minted once by the originator, persisted
to disk, reused verbatim on every retry.** The destination records the outcome against that key and
replays it rather than re-executing.

The key is deliberately **not** the correlation `id`. The `id` is per-connection and dialer-owned,
and a retry happens after a reconnect — a new connection with a new id space, or the same one after
a daemon restart. Keying idempotency on `id` would land the prompt twice at exactly the two moments
a retry occurs. **The `id` correlates a reply; the key identifies the work.**

A dropped link surfaces as `timeout` and exit `3` — information for the next pass, never grounds
for a restart.

## 5. Events, clocks and findings

### 5.1 A declared subset, not the firehose

The mesh subscription carries **lease transitions, machine state transitions (including
`reconstructing`), and `attention_raised` / `attention_cleared`**. A peer's pane-level churn stays
on the peer.

#4 calls the event log high-volume, and #14 §3 names the only thing the mesh provably needs events
for. Widening a declared subset later is additive; narrowing a firehose is a breaking change.

**The local daemon holds a cursor per peer and passes it on every `subscribe`.** A subscription
cannot outlive its connection (#26 §4), so every reconnect in §3 re-subscribes — and a re-subscribe
without a cursor resumes at the peer's tail, which is the mechanism of the 2026-08-24 orphan
arriving over the network. #26 §5 already makes an event-log subscriber pass its cursor; the mesh is
one such subscriber. An aged-out cursor is answered with `fell_behind`, which is what produces the
gap in §5.2 rather than silence.

### 5.2 Peer events live in per-peer buffers

**Never merged into the local event log.** #4's log is bounded and was sized for one machine's
volume: merging lets a busy peer age out this daemon's own history, and it blurs provenance in a
design whose attribution rule exists against exactly that blending.

Cross-machine conditions read peer buffers explicitly. A peer that sends `fell_behind` (#26 §5)
leaves **that peer's view gapped** until re-read — blind-with-gap for one peer, never contamination
of local history.

### 5.3 Every timestamp belongs to the machine that observed the fact

**The daemon never subtracts a peer's timestamp from its own clock.** A remote `since` is computed
by the peer and relayed.

`since` is the field #6 §2.4 added to delete the supervisor's entire track-status-across-passes
mechanism, so judgment now rests on it. Skew between a Mac and a Linux box would make it wrong by
exactly the skew, silently, in the one field designed to be trusted.

Each side sends its clock in `hello`. **Measured skew past a threshold is a `Finding`** — the
failure being prevented is a wrong duration that looks exactly like a right one.

### 5.4 A machine computes findings about itself

**A machine computes findings about its own state; the local daemon computes findings about the
link and about its own view of a peer.** Findings about `apbmbp` are computed on `apbmbp` and
relayed; that a peer is blind, that a peer's view is gapped, that measured clock skew is out of
threshold (§5.3) and that a room's owner is unreachable (§6) are all the local daemon's, because
each is a fact about the link rather than about the peer.

Both ends computing the same condition means two vantage points that can disagree about one fact.

**An `Acknowledgement` lives with its finding**, on the machine that computes it. An acknowledgement
is muted until its *material* evidence changes, and the evidence and the mute must never sit on
opposite sides of a link.

## 6. Rooms cross machines

This is the mesh's only push path.

A `Room` is project-scoped, the supervisor is a member of every room and runs on `apbfw16`, and
`lead-talostitle` runs on `apbmbp` — so TalosTitle's room has members on two machines. #6 §3.3
makes room delivery-on-idle **the** sanctioned wake mechanism, the one thing the daemon holds so no
shell can drop it.

**A room is single-homed on a config-designated machine.** Replicating a room means replicating its
per-member cursors, which turns the one piece of read state a room keeps into a consensus problem.

**Delivery to a remote member is a relayed request** the destination daemon executes as a local
prompt, under its own lease and its own `focused` semantics — §4, unchanged.

**An undeliverable wake leaves the cursor exactly where it is.** #14 §4 supplies the safety: a
cursor is keyed to the `Agent` and survives its member's absence, so delivery resumes from the
cursor on reconnect rather than at the tail. Reseeding at the tail is the mechanism of the
2026-08-24 orphan.

**A room whose owner is unreachable raises a `Finding`.** Silent non-delivery is that orphan wearing
mesh clothes; a room that cannot wake anyone must never be quiet about it.

## 7. Role-file distribution

### 7.1 The silence is the bug, not the copying

`supervisor.md` runs an `md5`-and-`scp` loop against `apbmbp` every pass because a missing prompt
file fails **silently**: the lead `cat`s a file that is not there, gets nothing, and starts work
with no role. That has happened.

**Config declares `path` and `hash` per role, plus one machine as the source. `agent start`
verifies the local file against the declared hash and refuses on mismatch.**

Fail-closed at start is what makes distribution a convenience rather than a correctness mechanism.
It also unties a circularity: #6 §5 wants `config validate` to check a prompt file *on the machine
the role runs on*, which needs the mesh, while the mesh's role-file story needs validation.
**Validation is advisory; `agent start` is enforcing.**

**The hash lives in the config of the machine that runs the role**, not in a live comparison
against the source. Comparing live would make `agent start` mesh-dependent, and the moment you most
need to restart an agent is the moment a machine is unreachable.

The cost, which is the same O(N) shape as §2.2's fingerprints: editing `lead-talostitle.md` on
`apbfw16` means recomputing a hash and editing it into **`apbmbp`'s** config, since `apbmbp` is
where that role runs. `jackdaw config hash <path>` prints it and a human pastes it, because #6 §5
forbids the CLI writing config. Seven role files across two machines today.

### 7.2 Pull, and what happens to a local edit

**Machines pull.** The machine that will run the role fetches it, so the failure is local and
visible at the point of use.

Pulls happen at daemon start, on a timer, and on demand via `jackdaw config sync`.

**The daemon records what it last wrote**, which is what lets it tell a stale copy from somebody's
edit:

| Local file | Action |
|---|---|
| Absent, or hash matches the last fetch | Overwrite freely — this is a copy the daemon owns |
| Hash matches nothing the daemon ever wrote | **Refuse**, raise a `Finding`; `--force` overrides |

Git-checkout semantics. Losing a hand-edit silently and clobbering one silently are the same
failure in opposite directions, and `apbfw16` being one-way authoritative today is how the second
one happens.

### 7.3 A peer asks for an artifact by name, never by path

*Fetch a file from a peer* is a remote file-read primitive, and §3.3 just declared trusted peers
unscoped — so this is the one place the scope has to live.

**A peer requests a declared artifact: the prompt file for role `lead-talostitle`, the manifest for
adapter `claude`.** The source resolves the name against its own config and serves nothing that
config does not name. Paths stay a local detail at both ends, which also means the two machines do
not have to agree on where a file lives.

### 7.4 What travels

**Role prompt files and adapter/plugin manifests.**

**Config does not.** It is where a machine states which roles run *here*, and distributing it erases
the per-machine difference that gives it its value.

**The binary does not.** #7 answered distribution with cross-compile-and-`curl`, `hello` already
refuses a major skew at connect time, and a self-updating daemon in the supervision plane is
novelty spent in the worst available place.

## 8. What each role file loses

`supervisor.md` — **the `md5`-and-`scp` sync loop and the one-way-authoritative warning**, replaced
by §7. #6 already took the `ssh -o BatchMode=yes` wrapping, the `zsh -lc` login-PATH workaround, the
macOS-keychain trap and the HARD-GATE forbidding remote diagnosis from an SSH session; this document
is what makes those removals real, because it supplies the transport underneath `machine:name`.

## 9. CLI additions

| Verb | Purpose |
|---|---|
| `jackdaw machine trust` | Prints this machine's certificate fingerprint, for pasting into a peer's config (§2.2) |
| `jackdaw config hash <path>` | Prints the hash a config entry must declare for a role prompt file (§7.1) |
| `jackdaw config sync` | Pulls declared artifacts from the source machine on demand (§7.2) |

Everything else rides existing surface. `machine:name` already addresses a peer, `machine list|show`
already reports a machine, and the always-present `degraded` already carries a blind peer's reason in
a form a shell can test.

## What this does not settle

- **Config distribution.** §7.4 rules it out deliberately. If per-machine config ever needs a shared
  fragment, that is a new decision and not an extension of this one.
- **A mesh larger than a hand-edited peer list.** No TOFU and mutual pinning make adding a machine
  an O(N) edit. Correct at three machines; a discovery mechanism is what would change it, and
  nothing here needs one.
- **Rehoming a room.** §6 single-homes a room on a designated machine and says nothing about moving
  it, which would have to carry the per-member cursors with it.
