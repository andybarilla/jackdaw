# How does an adapter get a blocked signal, and what does unsetting `$TMUX` cost?

Research for [andybarilla/jackdaw#22](https://github.com/andybarilla/jackdaw/issues/22). Date: 2026-08-25.

**Question.** #18 found three mechanisms that carry *blocked* for `claude` and could not weigh them.
Which should the adapter contract require, in what fallback order, and what does the
launch-environment surgery they depend on actually cost?

**Method.** #18's rig, reproduced on a private server (`tmux -L jackdaw-research-22`); the live
fleet socket was never contacted and no `send-keys` went outside it. Five `claude` panes crossing
the two launch levers, each with `pipe-pane` through #18's stamper (`(timestamp, offset, length)`
per chunk, so any byte offset maps to a wall clock) and a 100 ms sampler of
`#{pane_pb_state}`/`#{pane_title}`/`#{alternate_on}`/`#{history_size}`. Blocked turns were driven
by a prompt that trips the approval dialog, held 40–90 s, then approved, with the dialog's first
appearance timestamped by an independent 100 ms `capture-pane` poller. `claude` ran under a scratch
`CLAUDE_CONFIG_DIR`; the user's real `~/.claude` was never written (it was read, read-only, for the
live-fleet survey in §1.4 and §2.5).

**Versions.** tmux **3.7c** · `claude` **2.1.231**, invoked by absolute path.

> **The launcher has rolled forward and is broken.** `~/.local/bin/claude` now resolves to
> **2.1.243**, which segfaults on startup — 2 of 2 here, reproducing the fleet-wide report. Every
> run below therefore invokes `~/.local/share/claude/versions/2.1.231` directly. Separately, the
> live-fleet session registry shows panes running **2.1.245** (§2.5), a build not present in
> `~/.local/share/claude/versions/`. Anything that shells out to bare `claude` on this machine is
> currently starting a binary that dies.

---

## Verdict

**None of the three. There is a fourth mechanism, it is better than all of them on every axis that
matters, and it is already running on the live fleet with no configuration at all.**

`claude` maintains a **session registry** at `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`, rewritten on
every status transition. It carries the exact three-way distinction the whole chain has been
looking for:

```json
{"pid": 2719033, "sessionId": "61cf92fa-…", "cwd": "…/proj", "version": "2.1.231",
 "kind": "interactive", "status": "waiting", "waitingFor": "permission prompt",
 "statusUpdatedAt": 1787672880124, "updatedAt": 1787672880124, "procStart": "4930975",
 "tmux": "ctl:@10.%10"}
```

`status` is `busy` | `waiting` | `idle` | `shell`, and when it is `waiting` the `waitingFor` field
says *why*. Measured on a pane launched with **no environment surgery, no settings change, no
hooks, no `pipe-pane`, and `$TMUX` intact**:

```
submit            …876.971
status=busy       …876.989   (+18 ms)
dialog on screen  …880.182   (first independent sighting, 100 ms poller)
status=waiting    …880.124   waitingFor="permission prompt"   <-- ahead of the sighting
approval keypress …941.279
status=busy       …941.312   (+33 ms)
status=idle       …942.932
```

Against the three candidates: OSC 777 is **5.9 s** late and needs the notification channel forced
on; the hook is **6.0 s** late, needs a config write, needs `$TMUX` unset and needs Jackdaw to own
every transition; the `(pb_state, title-glyph)` pair is immediate but needs the capability gate
forced, `$TMUX` unset, tmux 3.7, and a title #8 distrusts. The registry is **~20 ms**, needs
nothing, and works on tmux 3.2 because it does not involve tmux at all.

**And the cost the ticket was worried about is not there.** Unsetting `$TMUX` **does not** move
`claude` to the alternate screen. `claude` is on the alternate screen in *every* configuration
tested — `alternate_on=1`, `history_size=0`, with `$TMUX` set and unset alike — which reproduces
#8 and corrects #18. The scraping fallback is byte-for-byte the same shape either way (§1.2). #18's
`alternate_on=0` reading was a startup artefact: `claude` is on the main screen for the first few
seconds and then switches, so a single sample taken too early sees `0` (§1.1).

The lever does cost something, just not that. **Dropping `$TMUX` removes the `tmux` field from the
session registry entry** — the pane identity `session:@window.%pane` that `claude` writes when it
can see `$TMUX` (§1.3) — plus eleven other behaviours read out of the bundle (§1.5), of which the
one an operator would notice is that `claude` stops downgrading its palette for tmux while also no
longer setting `terminal-features RGB` on the server.

**Recommended mechanism and fallback order:**

1. **Session registry** — `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`, `status` + `waitingFor`,
   pane-mapped via `#{pane_pid}` → child pid (§2.6). Baseline. Costs nothing, breaks nothing.
2. **OSC 777 on `pipe-pane`** — for panes Jackdaw launches, when the registry is unavailable or its
   schema has moved. Needs `preferredNotifChannel: "ghostty"` in the config Jackdaw owns (§3.2) —
   **not** a `$TMUX` change, **not** a `TERM_PROGRAM` spoof. 5.9 s.
3. **Screen-scraping**, #8's verdict, unchanged. Works everywhere, costs a rule treadmill.
4. **`(pb_state, title-glyph)`** — only where the adapter already forces the capability gate and
   drops `$TMUX` for other reasons. Not worth the surgery on its own.
5. **The `Notification` hook** — do not implement. Strictly dominated: it is later than OSC 777,
   needs the same config write *and* the `$TMUX` drop *and* tmux 3.7, and it fights `claude` over
   one latch (#18 §6).

**May an adapter write into a user's harness config?** Only into a config scope Jackdaw provisioned
and owns. Never `~/.claude`. The consequence is the part #5 needs: **no config-dependent signal can
be a baseline requirement of the adapter contract**, because adopted panes were launched by the
user and Jackdaw does not own their config. Baseline must be read-only; anything requiring a write
is an opt-in enhancement for Jackdaw-launched panes. The recommendation above is built to satisfy
that: tier 1 is read-only, tier 2 is the enhancement.

---

## 1. What unsetting `$TMUX` costs

Four panes crossing the two levers, all `claude` 2.1.231, same scratch config, same prompt:

| pane | `TERM_PROGRAM=ghostty` | `$TMUX` | |
|---|---|---|---|
| A | no | set | the fleet's actual launch today |
| B | yes | set | gate forced, wrapper still on |
| C | yes | **dropped** | #18's full surgery |
| D | no | **dropped** | attribution control |

`$TMUX`/`$TMUX_PANE` were removed at launch time with `env -u TMUX -u TMUX_PANE` in the
`new-window` command, so the shell never had them, rather than #18's in-pane `unset`.

### 1.1 It does not move the pane to the alternate screen

```
after startup settles (all four panes):   alternate_on=1   history_size=0
```

`claude` 2.1.231 is an alternate-screen application in every configuration tested. #8 measured
exactly this (`alt=1 hist=0`) and it still holds. **#18's §4.2 report that `alternate_on` was `0`
with `$TMUX` set and `1` with it unset does not reproduce**, and the explanation is visible in the
sampler: `claude` renders its startup banner and any pre-session dialog on the **main** screen and
switches to the alternate screen a few seconds later. Sampled during that window a pane reads `0`
regardless of the launch environment — this run produced `alt=0` readings for A, B, C *and* D at
+12 s and `alt=1` for all four afterwards.

The operational consequence stands from #8 and is unchanged by the lever: **there is no scrollback
to consult on a `claude` pane, ever.** `history_size` is 0 and `capture-pane -S -` returns the
50-line viewport, with `$TMUX` and without.

### 1.2 The scraping fallback is unaffected

Same session, same point in the turn, `capture-pane -p` of pane A (no surgery) and pane C (full
surgery):

```
A                                       C
20:  ⎿  Wrote 1 line to blkA2.txt       20:  ⎿  Wrote 1 line to blkC2.txt
23:● Created blkA2.txt containing rook. 23:● Created blkC2.txt containing rook.
25:✻ Brewed for 4s                      25:✻ Churned for 3s
47:──────────────────────────────────── 47:────────────────────────────────────
48:❯ …                                  48:❯ …
49:──────────────────────────────────── 49:────────────────────────────────────
50:  ⏸ manual mode on · ? for shortcuts  50:  ⏸ manual mode on · ? for shortcuts
```

Identical structure, identical 50-line viewport, identical footer — the anchors #8's rule regions
key off (`bottom_non_empty_lines(N)`, the horizontal rule, the prompt-box body) are all in the same
places. **The ticket's stated fear — that this lever buys a native signal and breaks the fallback a
blocked-detector still needs — is not borne out.**

### 1.3 What it does cost: the pane identity in the session registry

The registry entry (§2) carries a `tmux` field when `claude` can see `$TMUX`, and does not when it
cannot:

```
pane A  ($TMUX set)      "tmux": "ctl:@10.%10"
pane B  ($TMUX set)      "tmux": "ctl:@8.%8"
pane E  ($TMUX set)      "tmux": "ctl:@11.%11"
pane C  ($TMUX dropped)  field absent
pane D  ($TMUX dropped)  field absent
```

The writer is `uVy()`, which returns early without `$TMUX` and otherwise shells out to
`tmux display-message -p -t $TMUX_PANE '#{session_name}:#{window_id}.#{pane_id}'`. So the lever
that makes `pb_state` work is the same lever that deletes the pane↔session mapping `claude`
volunteers. This does not block Jackdaw — §2.6 maps panes by pid instead, and that works for the
dropped panes too — but it is the concrete price, and it is the exact inverse of what the lever
buys.

### 1.4 Not measured, and honestly

I could not read the live fleet's `claude` processes' environments to check whether their registry
entries lack the `tmux` field for this reason or another — the survey in §2.5 shows **no** live
fleet entry carrying it. Reading `/proc/<pid>/environ` for those processes was refused by this
session's own permission layer and I did not work around it. So: *my* panes lose the field when
`$TMUX` is dropped; why the fleet's panes lack it is unestablished.

### 1.5 The rest of the blast radius, from the bundle

Every `Q.TMUX` read in the 2.1.231 bundle, classified. `→` is what changes when the variable is
gone.

| site | effect of dropping `$TMUX` |
|---|---|
| `SoE()` — `mux: Q.TMUX?"tmux":…` in attacher caps | → `mux=null`, so `T5()` stops DCS-wrapping. **This is the lever's whole purpose** (#18 §2.4). |
| `y6s()` — same decision, fallback path | → `null` |
| `uVy()` — pane-id resolution | → skipped; registry `tmux` field absent (§1.3) |
| `PRu()` — `tmux show-environment -g CLAUDE_CODE_CHILD_SESSION` | → skipped; `claude` can no longer tell it was spawned as a child session inside tmux. **Relevant to teammate spawning**, which the ticket flagged. |
| clipboard tool selection — `if(Q.TMUX) return "tmux-buffer"; return "osc52"` | → OSC 52 instead of `tmux load-buffer` |
| `v9_()` — the `tmux load-buffer -w -` clipboard write | → skipped |
| `zXg()` — `if(Q.TMUX && level>2) level=2` | → truecolor **not** downgraded |
| `tmux set -as terminal-features ",*:RGB"` on attach | → **not** applied |
| `bzo()`/`wzo` — DECSTBM gate, `…&& Q.TMUX==null &&…` | → DECSTBM scroll-region rendering **enabled** where it is normally off under tmux |
| `Gle()`/`m1d()` — synchronized-output support | → resolved by a different branch |
| `Tqu()`, `kqu()`, `Hqu()` — tmux mouse/focus-events probes and hints | → skipped |
| XTVERSION correction via `#{client_termtype}` | → skipped; terminal identified from the raw XTVERSION reply |
| `lHw()`, `in_tmux_worktree` telemetry | → reports `none` |
| `Squ()`, `Cl_()` — iTerm control-mode probe | → no change here (also gated on `TERM_PROGRAM`) |

The two worth a design decision: **child-session detection** (`PRu`) is exactly the teammate path
#18 said should be exercised before anyone commits to the lever, and the **colour pair**
(`zXg` + `terminal-features`) means a `$TMUX`-blind `claude` emits 24-bit colour into a tmux that
it has not told to accept 24-bit colour. Neither was exercised functionally; both are source-read.
Given §1.1–1.2 and the verdict, no mechanism Jackdaw should ship depends on this lever, so the
question stops being load-bearing.

---

## 2. The session registry — the mechanism the ticket did not know about

### 2.1 How it was found

Tracing the notification path in the bundle for the OSC 777 debounce led to a status state machine
that had nothing to do with escape sequences:

```js
function qyh(e){
  let t = BGE(e);
  if (t !== void 0) return {status:"waiting", waitingFor:t, working:!1};
  return {status: e.isLoading||e.delegatedActive ? "busy" : "idle", waitingFor:void 0, working:e.isQueryActive}
}
function BGE(e){
  if (e.sandboxHostPrompt||e.workerSandboxPrompt) return "sandbox request";
  if (e.elicitationPrompt)                        return "input needed";
  if (e.managedSettingsSecurityPrompt)            return "dialog open";
  if (e.topDialogWaitingFor !== void 0)           return e.topDialogWaitingFor;
  if (e.pendingWorkerRequest)                     return "worker request";
  if (e.pendingSandboxRequest)                    return "sandbox request";
  if (e.isShowingLocalJSXCommand)                 return "dialog open";
  return
}
```

and its consumer, which **publishes** it:

```js
let oM = vS === "idle" && hC ? "shell" : vS;                 // hC = a local_bash still running
Qr.useEffect(() => { qpn({status: oM, waitingFor: kx}, Y) }, [oM, kx, Y]);

async function qpn(e,t){ let r = Date.now();
  await Ovt({...e, updatedAt:r, ...e.status !== void 0 && {statusUpdatedAt:r}}, t) }

function zvr(){ return zOe.join(vn(), "sessions") }          // $CLAUDE_CONFIG_DIR/sessions
function ETo(){ return jn.session(`${process.pid}.json`) }
```

`topDialogWaitingFor` comes from a per-dialog-kind label map whose entry for every tool-permission
dialog is `"permission prompt"`. So the alphabet is small, fixed, and English literals in the
bundle — there is no localisation layer on it.

### 2.2 Measured, on a pane with nothing done to it

Pane A: default environment, no `TERM_PROGRAM`, `$TMUX` present, stock settings, no hooks,
no `pipe-pane`. Registry polled at 200 ms, every change logged:

```
1787672876.971  SUBMIT
1787672876.989  status=busy                                        +18 ms
1787672880.124  status=waiting  waitingFor="permission prompt"
1787672880.182  (dialog first seen by the independent 100 ms poller)
1787672941.279  APPROVE
1787672941.312  status=busy                                        +33 ms
1787672942.932  status=idle
```

Pane C, full #18 surgery, same turn, same result:

```
1787672876.970  SUBMIT
1787672876.989  status=busy                                        +19 ms
1787672879.343  status=waiting  waitingFor="permission prompt"
1787672879.356  (dialog first seen by the poller)
1787672940.450  APPROVE
1787672940.465  status=busy                                        +15 ms
1787672941.797  status=idle
```

In both panes the `waiting` transition is stamped **before** the earliest independent sighting of
the dialog, so the publish is simultaneous with the render to within the poller's resolution. The
honest claim: **latency is below 100 ms and I could not measure it more finely than that.**

Compare the same event on the other three channels, same rig:

| mechanism | blocked latency | needs |
|---|---|---|
| **session registry** | **< 100 ms** | nothing |
| `(pb_state, title-glyph)` | ~50 ms | ghostty spoof + `$TMUX` dropped + tmux 3.7 |
| OSC 777 | **5.90 s** (n=3: 5.918, 5.897, 5.923) | notification channel forced + `pipe-pane` |
| `Notification` hook → `pb_state=error` | 6.0 s (#18 §6) | config write + `$TMUX` dropped + tmux 3.7 |

### 2.3 It has the staleness clock built in

#8 demanded a per-pane staleness clock and #18 said `claude` can never provide one because its
emitter is change-guarded with no keepalive. The registry answers that from a different direction:

- `statusUpdatedAt` — when the status last *changed*.
- `updatedAt` — when the record was last written.
- `procStart` — the process's start time, field 22 of `/proc/<pid>/stat`. Verified equal for all
  16 live-fleet entries (§2.5). This makes the liveness check **pid-reuse-safe**: an entry is live
  iff `/proc/<pid>` exists *and* its `procStart` still matches.

So "the emitter is alive" is answerable by process liveness rather than by a beat on the wire, and
"this status is old" is answerable by arithmetic. That is strictly better than what #8 asked for.

### 2.4 Cost of reading it

```
16 session files, full scan + JSON parse:   0.40 ms/scan
```

against #8's `capture-pane -p` at **5.25 ms per pane per poll**. One scan reads the whole fleet.
At 1 Hz across twenty panes that is 0.4 ms/s of CPU versus ~105 ms/s. Cost is not a constraint for
either, but the registry is two orders of magnitude cheaper and involves no tmux round-trip.

### 2.5 It is already working on the live fleet, unmodified, across three versions

Read-only survey of `~/.claude/sessions/` during this session — no fleet pane was touched:

```
pid=15645    ver=2.1.231  status=busy     procStart matches /proc
pid=15690    ver=2.1.231  status=shell    procStart matches /proc
pid=3099968  ver=2.1.241  status=idle     procStart matches /proc
pid=3238372  ver=2.1.245  status=waiting  procStart matches /proc     <-- a real blocked agent
pid=3229972  ver=2.1.245  status=busy     procStart matches /proc
… 16 entries, all live, all schema-identical
```

**A live fleet pane was sitting at `status=waiting` while I looked.** That is the signal
`supervisor.md` and `project-lead.md` need, present today, on panes nobody configured, three
harness versions wide. `waitingFor` was absent on every live entry sampled — see §5.

The schema is identical across 2.1.231, 2.1.241 and 2.1.245: same keys, same status alphabet. That
is the only cross-version evidence available and it is encouraging rather than conclusive.

### 2.6 Mapping a pane to its entry

`#{pane_pid}` is the pane's shell; `claude` is its child. Walking one level of children and looking
the pid up in the registry resolved all five research panes, including the two where `claude`
itself could not write the `tmux` field:

```
D %6  pane_pid=2254278 claude_pid=2254618 -> idle   (no tmux field)
B %8  pane_pid=2639690 claude_pid=2640124 -> idle   tmux=ctl:@8.%8
C %9  pane_pid=2665102 claude_pid=2665669 -> idle   (no tmux field)
A %10 pane_pid=2718451 claude_pid=2719033 -> idle   tmux=ctl:@10.%10
E %11 pane_pid=3806854 claude_pid=3807536 -> idle   tmux=ctl:@11.%11
```

So the mapping does not depend on the harness volunteering it, and therefore does not depend on the
`$TMUX` lever. An adapter needs the pane's pid (a tmux format), `/proc`, and the registry directory.

### 2.7 What it is not

It is an **internal file format with no supported interface**. `claude --help` exposes no
session-listing command (`claude agents` covers background agents only). There is no documentation,
no stability promise, and a version bump could change it. It carries `version` and `peerProtocol: 1`,
which is the guard an adapter should check: read the record, and if `version` is outside the range
Jackdaw has verified, fall through to tier 2. That check costs nothing and turns a silent
mis-parse into an explicit downgrade.

---

## 3. Reliability of OSC 777

### 3.1 It is not "unconfigured", and #18's positive result was the spoof's doing

Pane A — default environment, `$TMUX` set, no `TERM_PROGRAM` — ran a full blocked turn and emitted
**zero** OSC 777. Its entire OSC inventory for the session is titles:

```
=== A  12141 B / 77 chunks     inventory: {'0;': 11, '8;': 1, '8;;': 1}
```

Panes B and C, which differ from A only by `TERM_PROGRAM=ghostty`, both emitted it. The cause is
the notification channel resolver:

```js
async function MyS(){ switch($w()?.terminal ?? Q.terminal){
  case "Apple_Terminal": return await OyS() ? "terminal_bell" : "no_method_available";
  case "iTerm.app": return "iterm2";
  case "kitty":     return "kitty";
  case "ghostty":   return "ghostty";
  default:          return "no_method_available" } }
```

with `preferredNotifChannel` defaulting to `"auto"`, which routes through `MyS()`. On this machine
`TERM_PROGRAM` is unset, the terminal resolves to `default`, and the answer is
`no_method_available` — nothing is written. **#18's claim that OSC 777 "needs nothing else" and is
"the only blocked signal here that works with `$TMUX` set, on tmux 3.2, unconfigured" is half
right**: it does work with `$TMUX` set on tmux 3.2, but it is not unconfigured. Both #18 captures
that showed it (`ccB`, `ccC`) had the ghostty spoof applied, and #18 never observed it in `ccA`.

### 3.2 The configuration it needs is a config write, not the spoof

`preferredNotifChannel` is a user-settable key, and setting it explicitly bypasses the
auto-detection entirely:

```js
let r = pd("preferredNotifChannel","auto").value;
if (r === "auto") { let o = await MyS(); $7f(o,e,t) }
else { switch(r){ case"iterm2": case"iterm2_with_bell": case"kitty": case"ghostty":
                  case"terminal_bell": o = r; break; … } … }
```

Pane E: `preferredNotifChannel: "ghostty"` written into the scratch `.claude.json`, **no
`TERM_PROGRAM` spoof, `$TMUX` intact**, everything else default:

```
=== E  13068 B / 93 chunks
  1787673257.331  DCS   777;notify;Claude Code;Claude needs your permission
  1787673354.851  DCS   777;notify;Claude Code;Claude is waiting for your input
  inventory: {'0;': 13, '777;': 2, '8;': 1, '8;;': 1}
```

This is a strict improvement on #18's route. **OSC 777 needs no environment surgery at all** — no
`TERM_PROGRAM` spoof (whose modifier-key side effects #18 flagged and nobody has measured), no
`$TMUX` drop, no capability gate. It needs one key in the config Jackdaw owns. Note the key lives
in `.claude.json`, not `settings.json`.

### 3.3 The debounce is stable and the idle threshold is tunable

Three independent blocked turns, dialog render (100 ms poller) to notification (byte stream):

```
pane B   dialog …199.938   notify …205.856    5.918 s
pane C   dialog …198.493   notify …204.390    5.897 s
pane E   dialog …251.408   notify …257.331    5.923 s
```

**5.90 s ± 0.02 s**, matching #18's two measurements (5.88, 6.01). It behaves like a fixed
constant, and I still could not locate it in the bundle — see §5.

The *idle* notification is a different story and the constant is named:

```js
messageIdleNotifThresholdMs: 60000       // in the settings schema, default 60000
… Cr >= Qt().messageIdleNotifThresholdMs → DLe({message:"Claude is waiting for your input", notificationType:"idle_prompt"})
```

and measured exactly:

```
pane B   turn end (9;4;0;) …292.737   notify …352.738    60.001 s
pane C   turn end (9;4;0;) …289.967   notify …349.968    60.001 s
```

`messageIdleNotifThresholdMs` is a settings key, so **the idle-notification latency is tunable by
an adapter that owns the config**; the permission debounce is not, as far as I could establish.

### 3.4 The strings, and whether there are others

Both strings are hardcoded English literals. `"Claude needs your permission"` is a single bundle
constant (`yQe`) reused for every tool-permission dialog kind; sibling literals in the same map
cover other dialog kinds (`"Claude Code wants to enter plan mode"`, `"Claude Code needs your
approval for the plan"`, `"Session paused"`, `"A message from another session needs your
approval"`, `"Claude wants to use your browser"`, and more). So an extractor keyed on the exact
string `Claude needs your permission` will **miss** plan-mode approvals, cross-session approval
requests and browser requests, all of which are also *blocked*. A prefix/keyword match is not safe
either — `"Claude is waiting for your input"` is the *idle* notification and must not be treated as
blocked. Any OSC 777 extractor needs the literal set, and the literal set moves with the version.
This is a second reason to prefer the registry, whose `waitingFor` covers all of these under one
`status=waiting`.

No localisation layer wraps these strings in 2.1.231.

### 3.5 The envelope caveat from #18 reproduced

Pane E's captures are `DCS`-wrapped (`\x1bPtmux;\x1b\x1b]777;…\x07\x1b\\`, escapes doubled) and
pane C's are bare, from the same binary. #18's warning holds and my extractor implements it: match
`\x1b\x1b?\]` so both envelopes hit, or strip the DCS envelope and un-double escapes first.

---

## 4. The three candidates, weighed

| | registry | OSC 777 | `(pb_state, title-glyph)` | `Notification` hook |
|---|---|---|---|---|
| blocked latency | **< 100 ms** | 5.90 s | ~50 ms | 6.0 s |
| tmux version floor | **none** | **none** (3.2 fine) | **3.7** | **3.7** |
| needs `$TMUX` dropped | no | no | **yes** | **yes** |
| needs `TERM_PROGRAM` spoof | no | no (config instead) | **yes** | **yes** |
| needs a config write | **no** | yes (`preferredNotifChannel`) | no | yes (hooks) |
| needs `pipe-pane` (one per pane, ~22–32 KiB/s working) | no | **yes** | no | no |
| works on adopted panes | **yes** | no | no | no |
| distinguishes blocked from working | **yes** | yes | yes | yes |
| distinguishes blocked from done | **yes** | yes (two strings) | yes | yes |
| carries a reason | **yes** (`waitingFor`) | partially (string set, §3.4) | no | no |
| staleness clock | **built in** (`statusUpdatedAt`+`procStart`) | none | none | none |
| stability | undocumented internal format | undocumented literals | two formats + a title #8 distrusts | documented hook API, fights the latch |

The hook is dominated on every row by OSC 777 except "no `pipe-pane`", and it pays for that with a
config write *and* the `$TMUX` drop *and* tmux 3.7 *and* the latch-ownership problem (#18 §6
caveat 2 — a half-installed hook set leaves `pb_state` stuck at `error`). It should not be built.

The `(pb_state, title-glyph)` pair is the fastest of the three original candidates and the most
expensive to deploy: it is the only one that needs both launch levers *and* the version floor *and*
two observation channels held in agreement. Its only advantage over the registry is that it is a
tmux format, and that advantage is worth little once the registry turns out to be a 0.4 ms file
read.

### 4.1 On the objection the ticket raised about the 5.9 s debounce

The ticket says a detector that "misses a prompt answered quickly is not [fine]". For the OSC 777
tier that objection is real but narrower than it looks against the *named* triggers.
`supervisor.md` escalates on **blocked work that has not moved between two passes**, and
`project-lead.md` on **an IC stuck twice**. A prompt answered inside 5.9 s produces title movement
(`✳` → spinner) and, at the next pass, `status`/screen movement — the trigger is "has not moved",
so a prompt that is answered promptly is precisely the case that should not fire. The debounce
costs a live "waiting on you" indicator its first six seconds; it does not cost either escalation
trigger anything. With tier 1 in place the point is moot at 100 ms.

---

## 5. Cross-harness

```
                  blocked signal available            mechanism
claude  2.1.231   yes                                 session registry (status/waitingFor)
pi      0.84.1    n/a — pi has no approval gate       (#17: blocked and idle are the same state)
codex   0.147.0   none found                          no OSC 777 (0 occurrences), no live status file
cursor            not installed — untested, 4th study running
```

`grep -ac '777;notify'` returns **0** for both the `pi` and `codex` binaries, so neither has the
OSC 777 channel. Neither keeps a live per-process status file analogous to `claude`'s registry:
`~/.codex/sessions/` is a dated transcript archive and `~/.pi/agent/` holds `sessions/`,
`missions/index` and `run-history.jsonl`, none of which is a status record. That is a bounded
negative — I looked at the obvious locations, not exhaustively.

`cursor` remains uninstalled and untested, now for the fourth study running.

---

## 6. What this requires of the adapter contract (#5)

Written for #5 to consume; not posted there by me.

1. **A harness adapter must declare a `blocked` observation, and the contract must accept a
   read-only one.** For `claude` it is: read `<config-dir>/sessions/<pid>.json`, map pane→pid via
   `#{pane_pid}` and one level of `/proc` children, and report `status=waiting` (with `waitingFor`
   as the reason) as *blocked*, `busy` as *working*, `idle`/`shell` as *idle*.
2. **Baseline capabilities must be read-only.** An adapter may write only into a config scope
   Jackdaw provisioned and owns. It must never write `~/.claude/settings.json` or `~/.claude.json`.
   Therefore an adapter may declare a *tier-2* signal that depends on a config key — but the
   contract may not make any config-dependent signal mandatory, because adopted panes have a config
   Jackdaw does not own.
3. **The contract needs a version guard, not just a name.** The registry is an undocumented format.
   An adapter declares the harness version range it has verified, checks the record's own `version`
   field, and downgrades to the next tier rather than mis-parsing.
4. **Adopted panes are a first-class case, and they are what make tiering necessary.** Every
   mechanism except the registry and screen-scraping requires Jackdaw to have controlled the launch.
   The contract should let an adapter report *which* tier a given pane is being observed at, so the
   fleet console can show that an adopted pane has a coarser signal than a launched one.
5. **`claude` needs no launch-environment surgery.** #18 §10.2 asked #5 for a launch *environment*
   rather than launch arguments, on the strength of the `pb_state` route. That requirement can be
   dropped: nothing in the recommended stack needs `TERM_PROGRAM`, `TMUX` or the capability gate.
   Launch arguments plus an owned config dir are sufficient.
6. **A staleness clock is still mandatory, and for `claude` it is now cheap.** `statusUpdatedAt`
   plus a `procStart`-checked liveness probe gives it directly; for harnesses without a registry
   #8's per-pane clock is still required.

---

## Where this stops

**Established here:** `claude` maintains a live per-process status registry with a
blocked/working/idle distinction and a reason, at sub-100 ms latency, with no configuration
(§2.1–2.2); it carries a pid-reuse-safe liveness stamp and two freshness timestamps (§2.3); it
costs 0.40 ms to read the whole fleet (§2.4); it is running on the live fleet today across three
versions, with one pane observed at `status=waiting` (§2.5); panes map to entries by pid (§2.6).
Unsetting `$TMUX` does **not** move `claude` to the alternate screen and does not change the
scraping fallback (§1.1–1.2); it does remove the registry's `tmux` pane-identity field (§1.3) and
eleven other behaviours read from the bundle (§1.5). OSC 777 is gated on the notification channel
and is absent from a default pane (§3.1), but can be enabled by a config key alone with no
environment change (§3.2); its permission debounce is 5.90 s ± 0.02 over three measurements and its
idle threshold is exactly `messageIdleNotifThresholdMs` = 60 s and is a settings key (§3.3); its
message strings are unlocalised literals and the two #18 found are not the whole set (§3.4).

**Not established, and why:**

1. **`waitingFor` was absent from every live-fleet entry sampled**, while my research panes carried
   it reliably. Sixteen entries were sampled once each, and none was `waiting` with a reason at the
   sampled instant except one entry that showed `status=waiting` with no `waitingFor` key. The
   likely reading is that `waitingFor` is written only for the dialog kinds `BGE()` covers and that
   the fleet pane was waiting for a different reason — but I did not confirm it, and an adapter
   should therefore treat `waitingFor` as optional and `status=waiting` as the load-bearing field.
2. **Registry write atomicity was not tested.** I never observed a truncated or unparseable file
   across roughly 1000 polls of five files, but I did not read the writer's publish discipline
   (`Ovt` / `publishDiscipline`) or induce a torn read. An adapter should treat a parse failure as
   "no reading this pass", not as an error.
3. **Behaviour when `claude` is stopped or killed.** `procStart` and `/proc` make the liveness check
   sound in principle; I verified the stamps match for 16 live processes but did not SIGSTOP or
   SIGKILL a session and watch the entry go stale. #17 established tmux holds a stale `pb_state`
   indefinitely; the registry presumably holds a stale `status` the same way, which is what the
   liveness check is for.
4. **Whether the live fleet's missing `tmux` field has the same cause as my dropped-`$TMUX` panes**
   (§1.4). Reading those processes' environments was refused and I did not route around it.
5. **The 5.9 s permission debounce constant** — measured five times now across two studies, tightly
   clustered, still not located in the bundle. One timeboxed attempt was made. Operationally it does
   not matter for either escalation trigger (§4.1); it matters for a live indicator.
6. **`TERM_PROGRAM=ghostty`'s cost** is still source-read only, exactly as #18 left it — but it is
   now moot, because nothing in the recommendation uses the spoof. If a future design revives it,
   the modifier-key question is still open, and `ConEmuANSI=1` is still ruled out.
7. **Teammate spawning with `$TMUX` dropped** (`PRu()`, §1.5) was not exercised functionally. Also
   moot under the recommendation.
8. **`cursor`** — still not installed. Fourth study.
9. **Everything here is one machine, one `claude` build for the controlled runs (2.1.231), one
   permission mode (`manual`), and one dialog kind (tool-use approval).** The plan-mode,
   cross-session-approval and browser-request dialogs listed in §3.4 were not driven; they are
   asserted from the bundle to produce `status=waiting` and were not observed doing so.

---

## Appendix: reproduction

Scripts and raw logs are under the session scratchpad at `.../scratchpad/r22/`, with a copy at
**`~/.cache/jackdaw-r22/`** — not committed. Derived from #18's rig at `~/.cache/jackdaw-r18/`.

```bash
S=jackdaw-research-22
tmux -L $S new-session -d -s ctl -x 200 -y 50
tmux -L $S set -g exit-empty off

# scratch config; the real ~/.claude is never written
bash setup_claude.sh                 # trusts the scratch project, marks onboarding complete

# one pane per cell of the 2x2; "drop" removes the mux vars at launch, not in-pane
bash launch3.sh A off     cccfg  keep     # the fleet's launch today
bash launch3.sh B ghostty cccfg  keep
bash launch3.sh C ghostty cccfg  drop     # #18's full surgery
bash launch3.sh E off     cccfg3 keep     # preferredNotifChannel=ghostty, nothing else

# 200 ms registry observer + a blocked turn held for N seconds
python3 regpoll.py 200 &
bash blockedturn.sh A blkA2 60

python3 osc.py A B C E               # OSC inventory, offsets mapped to wall clock
python3 reg2.py                      # read-only live-fleet survey incl. procStart check
bash    map.sh                       # pane -> pane_pid -> claude pid -> registry entry
```

The `claude` binary must be invoked by absolute path (`~/.local/share/claude/versions/2.1.231`);
the `claude` on `PATH` resolves to 2.1.243 and segfaults.

The private server was destroyed at the end of the session
(`tmux -L jackdaw-research-22 kill-server`); the user's live fleet socket was never contacted, no
live-fleet `claude` pane was restarted or written to, and the only live-fleet access was read-only
reads of `~/.claude/sessions/*.json` and `/proc/<pid>/stat`.
