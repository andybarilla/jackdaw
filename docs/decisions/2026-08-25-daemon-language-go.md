# Daemon implementation language: Go

Resolves [#7](https://github.com/andybarilla/jackdaw/issues/7). Deliberately deferred at charting
until the protocol and the daemon's real workload were known; both now are.

## The workload, from seven closed decisions

- A **persistent tmux control-mode client per session** — `refresh-client -B` format subscriptions
  and `%subscription-changed` lines (#3), alongside `capture-pane` at 5.25 ms where scraping is the
  fallback (#8).
- Whole-fleet **session-registry reads at 0.40 ms**, polled (#22).
- A **socket server** speaking NDJSON with per-connection bounded queues and multiplexed
  subscriptions (#26).
- **Three durable stores** and a bounded event log (#4).
- **File watching**, a **mesh client and server**, and **HTTP + WebSocket** with an embedded static
  bundle (#26).
- **Process supervision** of tmux and of adapter subprocesses over stdio (#5).

Targets: `linux/amd64` (`apbfw16`) and `darwin/arm64` (`apbmbp`). **No Windows-native target** —
the substrate is tmux, so Windows is WSL (#26 §1).

## The decision

**Go**, with the dashboard as a separate TypeScript/React source tree built to a static bundle and
embedded via `go:embed` into the same binary.

### Why

- **Distribution is the ticket's own stated concern, and Go collapses it.**
  `GOOS=darwin GOARCH=arm64 go build` from `apbfw16` produces a static binary needing no toolchain
  on the target. *`curl`-a-binary beats provisioning a runtime*, and `apbmbp` is where provisioning
  has already cost this fleet real time.
- **The concurrency model maps 1:1 onto the protocol #26 specifies.** One goroutine per connection,
  and **a buffered channel *is* the bounded queue** — overflow is a `select` default, which is
  precisely where `fell_behind` is sent. The same shape covers the N control-mode connections that
  #3's session-scoping requires. When the protocol's core mechanism is a language primitive rather
  than a library, the implementation stops being a translation.
- **`go:embed` makes the single-artifact decision free**, so the archive's UI work survives without
  a second process to supervise — which would be its own small joke, given what Jackdaw is for.
- **This code will be written mostly by agents, which is a real criterion for this project
  specifically.** Jackdaw is built by the fleet it supervises. Go's small surface and boring idioms
  give the highest first-pass correctness from an IC; a borrow checker turns a routine change into
  a multi-hour fight that a lead then has to gate, and the gate is the fleet's scarcest resource.

### Library availability carries no weight here, and that is a finding

**No library implements the part we need, in any compiled language.**

- Every Go tmux library — [gotmux](https://github.com/GianlucaP106/gotmux),
  [gomux](https://github.com/wricardo/gomux),
  [jubnzv/go-tmux](https://github.com/jubnzv/go-tmux) — **wraps the CLI**, shelling out and parsing
  stdout. That is the mechanism #3 measured and rejected in favour of subscriptions.
- **Control mode has no library ecosystem.** The
  [tmux wiki's protocol page](https://github.com/tmux/tmux/wiki/Control-Mode) documents the format
  and references no client implementations; the known implementers embed it (iTerm2, where George
  Nachman designed it; an [Emacs client](https://github.com/csheaff/tmux-control)), and
  [Microsoft Terminal's issue #5612](https://github.com/microsoft/terminal/issues/5612) is still
  open.
- **tmux is not a library** — no C API, only the CLI and the control-mode protocol.
- [libtmux](https://pypi.org/project/libtmux/) (Python) is the most complete thing in the space and
  has a control-mode engine. It is worth **reading as a reference implementation** regardless of
  language; Python as a daemon runtime fails the distribution constraint.

So the control-mode client — a line-based parser for `%begin`/`%end`/`%error` guard blocks and `%`
notifications — is ours to write in any case. The library everyone has is the one we do not want,
in every language, which removes the only criterion the alternatives could have won on by
ecosystem.

## Costs, stated rather than discovered

- **`encoding/json` drops unknown fields on an unmarshal→marshal round trip**, which collides with
  #26's additive-only rule at exactly one place: **mesh relay**, where this daemon forwards a
  peer's response. **Peer payloads are relayed as `json.RawMessage` and never round-tripped through
  a struct.** A newer peer's fields must survive an older relay.
- **Go has no sum types**, and `unavailable`-as-a-first-class-answer is modelled in every contract
  on this map (#5, #9). It becomes a tagged struct rather than an enum — more verbose, and easy to
  get wrong by reading the value without checking the tag. **One shared generic wrapper plus a vet
  check, from the first commit**, not after the first bug.

## Alternatives

**Rust** models `unavailable` genuinely better and would win a contest scored on correctness alone.
Its strongest pull for this project would have been a desktop shell — and #11 made the dashboard a
browser, so Tauri-versus-Electron is not a question Jackdaw has to answer. It pays the
agent-iteration cost without collecting the prize.

**Bun/TypeScript** gives one language across daemon and UI and can compile a single cross-target
binary. It is the closest call. But the daemon is the thing that must not die when everything it
watches does, and a younger long-lived-daemon story is the wrong place to spend novelty budget in a
supervision plane.

## Toolchain

Go managed by **mise**, a recent stable as the floor, and **`CGO_ENABLED=0` as a project rule**
rather than a default. No-cgo is what keeps cross-compiling to `apbmbp` a single command with no
toolchain on the target, and it fails **silently** the first time a dependency needs it — the
binary simply stops cross-building, on a machine that is not the one you are standing at.

## Tracer bullet

**The control-mode client, end to end**: one persistent connection, a `refresh-client -B`
subscription on `%*`, a socket client subscribed through the wire protocol, and a deliberately slow
reader forced to receive `fell_behind`.

It exercises the two things that could falsify this choice — N long-lived connections per machine,
and backpressure at a bounded queue — and it is the piece with no library in any language, so it is
written regardless of the outcome. A tracer bullet proving only the socket server would prove the
easy half.

**Run it on `apbmbp`, not merely built for it.**

## Reversal cost, and what would falsify this

**Low, deliberately.** #26 put a wire protocol in front of the daemon that nothing is coupled
*through*: the CLI, the dashboard, the adapters and every role file talk to the protocol, not to
the process. Replacing the daemon's language moves no client. *We can change our mind* is only true
if someone wrote down why, so it is written down here.

Two falsifiers, both cheap to check early:

1. **A cross-compiled `darwin/arm64` binary misbehaving on `apbmbp`** — this kills the distribution
   argument outright, which is why the tracer bullet is run there.
2. **Agent-authored Go proving no better first-pass than the alternatives** — this removes the
   criterion weighted heaviest above.

## Open, and not blocking

**What travels from the archive** (`/run/media/andy/Backup/home-backup/dev/andybarilla/jackdaw/`).
The drive was unmounted when this was decided, so the reuse audit is unrun. The map's Notes already
record the expectation — the design system and specs travel, the Electron shell does not — and the
UI being a separate source tree (above) is what makes that audit a UI question rather than a
language one. This decision does not depend on its outcome.
