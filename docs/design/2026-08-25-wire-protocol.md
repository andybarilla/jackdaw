# The wire protocol

Resolves [#26](https://github.com/andybarilla/jackdaw/issues/26). The payload contract is
[the CLI surface](./2026-08-25-cli-surface.md); the stores and the subscription guarantee are
[the supervision domain model](./2026-08-24-supervision-domain-model.md); the adapter channel is
[the adapter contract](./2026-08-25-adapter-contract.md).

**What this fixes and what it inherits.** #6 settled the *payload*: the `.result.<noun>` envelope,
an always-present `degraded`, `schema` on every response, and exit codes that separate timeout from
failure. This document settles what carries it — transport, framing, multiplexing, subscription
semantics and versioning — and adds no second vocabulary for anything #6 already named.

## 1. Transport

One unix socket per daemon, mode `0600`. **Authorization is filesystem permission**: the daemon and
every agent run as one user on one box, and a local auth layer would protect against nothing that
`0600` does not.

**Linux and macOS only, and that is not a new decision.** The substrate is tmux
([#3](https://github.com/andybarilla/jackdaw/issues/3)), which does not run natively on Windows —
so Windows means WSL, which is Linux. A Windows-native *client* reaching a WSL daemon is a
network crossing and belongs to mesh transport, not here.

Three portability constraints, all from macOS being a real target (`apbmbp`):

- **The socket lives at a short runtime path**, named by the config root rather than nested under
  it. `sun_path` is 104 bytes on macOS against 108 on Linux, and it truncates rather than erroring.
- **No dependence on peer-credential APIs anywhere in the protocol.** `SO_PEERCRED` and
  `LOCAL_PEERCRED` are different calls with different structs and nothing portable underneath, and
  peer identity buys nothing when everything runs as one user.
- **No abstract sockets** — Linux-only. The socket is always a file on disk.

**Bind is try-connect-then-unlink.** A socket file outlives its process, so a daemon that unlinks
blindly steals the socket from a live one. Connect first; unlink only on refusal. This is the
crash-versus-reboot distinction of [#14](https://github.com/andybarilla/jackdaw/issues/14) at the
socket layer — a surviving file is not evidence of a surviving daemon, and neither is its absence
evidence of a dead one.

## 2. Framing

**NDJSON — one JSON value per line — with a hard line-length cap.**

- #6 already committed `jackdaw event tail` to streaming NDJSON, so the wire format and the
  user-facing stream are one format rather than two with a translation between them.
- It is diagnosable with `socat` and `jq`, which matters for a daemon whose failures are read at
  3am by an agent rather than stepped through in a debugger.
- **Partial writes are self-solving.** A frame is a line; an incomplete final line is discarded;
  a client that dies mid-write takes its connection with it, so there is no following frame to
  corrupt.

The cap is the one thing NDJSON needs that length-prefixing gets free: without it, a broken client
buffers the daemon into an OOM.

## 3. Frames

Every frame carries a `type` and an `id`.

| `type` | Meaning |
|---|---|
| `request` | A method call |
| `response` | The reply to one `id` |
| `event` | A subscription frame, reusing its `subscribe` response's `id` |
| `error` | A failed request |
| `fell_behind` | A subscriber's cursor was advanced without it reading (§5) |

**The response body is the CLI response object**, plus the correlation `id` — the CLI is a
renderer, not a translator:

```json
{ "type": "response", "id": 7, "schema": 1, "result": { "agents": [ … ] }, "degraded": [] }
```

There is no JSON-RPC 2.0 envelope over the top of it. A second envelope means a second error
space, and every daemon error would then need mapping into #6's exit codes — where something
eventually maps wrong.

**One error vocabulary, mapping 1:1 onto the exit codes.** An `error` frame carries a stable
string `code`:

| `code` | Exit |
|---|---|
| `usage` | 1 |
| `not_found` | 2 |
| `timeout` | 3 |
| `degraded` | 4 |

Identical through the socket and through `$?`.

**Typed frames rather than inferred ones.** Reading "a frame whose id I have an outstanding
request for" as a reply is what lets a late response be mistaken for an event once a subscription
reuses an id. The `type` field costs one key and removes the class.

## 4. Subscriptions share the connection

`subscribe` is an ordinary request. Its `response` claims an `id`; every later frame with that `id`
is an `event`; `unsubscribe` releases it.

**A subscription cannot outlive its connection, and the protocol offers no way to ask for one.**

This is the protocol forbidding a known bug. #6 §3.3 already ruled that a shell-held subscription
is not the wake mechanism — any subscription a shell holds dies with that shell, *silently*, which
is how an IC was orphaned on 2026-08-24, and a backgrounded watcher is the same trap wearing a
flag. A durable subscription primitive on the wire is something a future session would eventually
build the wake path on, with the protocol's blessing. Waking stays the daemon's job via room
delivery-on-idle, which the daemon holds and no shell can drop.

**Making the ephemeral thing look unmistakably ephemeral is a goal of this protocol, not a
limitation of it.**

## 5. Backpressure and falling behind

A bounded queue per connection. On overflow the daemon **neither blocks nor silently drops**: it
advances the subscriber's cursor and sends `fell_behind` carrying the gap — the cursor it held and
the cursor it now holds.

This makes *falling behind* one concept with two causes — a slow reader here, a cursor aged out of
the bounded window in #4 — carrying **one signal**. A daemon that blocks lets one wedged client
stall the fleet's event stream; a daemon that drops silently rebuilds the failure #4 was written to
kill, where being *told* is the guarantee.

**Cursor ownership.** An event-log subscriber passes its cursor on `subscribe` and the daemon
resumes from it; a room's per-member cursor is daemon-held and keyed to the `Agent` (#4, #14). The
invariant across both:

> **The wire never advances a cursor silently.** Every advance is either a read the client asked
> for or a `fell_behind` it was told about.

## 6. Cancellation

`cancel` references an outstanding `id`. **A disconnect cancels every outstanding request on that
connection.**

**Cancelling a request cancels the waiting, never the work.** `agent wait --until idle` giving up
says nothing about the agent — that is #6's timeout-is-not-failure rule, and a protocol that let a
dying `wait` client reach through to a session, a lease, or a launch in flight would rebuild it one
layer down. `cancel` withdraws interest in an answer.

## 7. Versioning

**`hello` is the first frame of every connection**, carrying the client's *protocol* version and
answered with the daemon's. It covers the transport only; `schema` on every response already covers
the payload, and #6 made that additive-only within a major.

- **A major mismatch refuses at connect time with a clear error**, rather than degrading. A
  protocol that half-works fails at the worst moment instead of the earliest one.
- **A newer client calling a method an older daemon lacks gets `unsupported`, naming the method.**
  Never a hang and never silence — which is the failure mode nearly every decision on this map
  traces back to.

## 8. The mesh speaks the same protocol

Same framing, same envelope, same methods. What differs is transport and authentication.

Fan-out means the local daemon asks a peer literally the question a client asked it (#6 §4:
`machine:name` works anywhere a name does). Two protocols would mean two implementations of every
verb, and the second one drifts.

**A fanned-out result is keyed by machine, and carries per-machine `schema` and `degraded`** — a
set of answers with attribution, never one answer averaged over the mesh. #6 requires this
directly: two machines can be on different versions mid-migration, and a fanned-out answer must say
so rather than blending them.

**An unreachable peer appears as an entry saying so, never as an omission.** A fan-out that drops
the peer it could not reach returns a shorter, cleaner, wrong answer. This is the map's oldest rule
in its newest place — `supervisor.md` forbids rendering an empty roster from a failed probe, and
the console ranks a blind source 2nd, because an outage and *nothing is running* look identical
downstream and only one is safe to ignore. Per-peer timeouts are bounded independently, so one slow
machine degrades the answer rather than holding it, and the response exits `4`.

**Mesh authentication is out of scope here** and stays with the mesh-transport item #6 parked.

## 9. The dashboard: a separate transport, not a separate API

Browsers cannot open a unix socket. The daemon serves HTTP plus WebSocket on loopback; the
WebSocket carries the **same typed frames**, and the HTTP endpoints are a thin shell over the
**same methods** returning the **same envelope**.

#6 already committed to this: the CLI's output contract and the console's are one contract, one
record with two renderings. A second API is how those two renderings drift until a `Finding` means
something different in the GUI than in `jackdaw status`.

**Loopback HTTP is reachable by every local process, so `0600` stops being the authorization
story** — this surface needs a token from the config root. That is the first place local
authentication is genuinely required, and it exists because of the browser, not because the local
socket was ever unsafe.

## 10. Adapter subprocesses: same framing, different vocabulary

The adapter contract's stdio escape hatch reuses the typed NDJSON frames — one parser, one set of
failure semantics, rather than a second half-specified stdio protocol debugged separately.

**The method vocabulary is the adapter contract's, not the client's.** An adapter answers
observations and sends **hints**, and a hint wakes the daemon and carries no data — so **an adapter
can never assert state through this channel**.

Framing is a transport decision and shares cleanly; vocabulary is the trust boundary and must not.
Sharing a line format also commits nobody to a runtime, which keeps the adapter contract
independent of [#7](https://github.com/andybarilla/jackdaw/issues/7) as it required.
