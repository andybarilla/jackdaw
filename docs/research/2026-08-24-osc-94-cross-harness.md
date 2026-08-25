# Is OSC 9;4 the cross-harness native status channel?

Research for [andybarilla/jackdaw#18](https://github.com/andybarilla/jackdaw/issues/18). Date: 2026-08-24.

**Question.** #17 found that `pi` drives tmux's `#{pane_pb_state}` via OSC 9;4 progress, and that
Claude Code's bundle contains OSC 9;4 code behind an auto-detect gate that returns `false` under
tmux. Does forcing that gate open make `claude` drive `#{pane_pb_state}` too — and if so, is OSC
9;4 the native, cross-harness status channel the design has been looking for?

**Method.** #17's rig, reproduced on a private server (`tmux -L jackdaw-research-18`); the live
fleet socket was never contacted and no `send-keys` went outside it. Two independent observers on
every run: a **100 ms sampler** (`display -p` of `#{pane_pb_state}`/`#{pane_pb_progress}`/
`#{pane_title}`/`#{alternate_on}` plus `capture-pane`, every changed frame to disk) and
**`pipe-pane`** through a stamper logging `(timestamp, offset, length)` per chunk, so any byte
offset in the reassembled stream maps back to a wall clock. Escape sequences are matched against
the reassembled file, not per chunk. A **positive control ran first**. `claude` ran under a scratch
`CLAUDE_CONFIG_DIR`; the user's real `~/.claude` was never written. `pi` ran under a scratch
`PI_CODING_AGENT_DIR`.

**Versions.** tmux **3.7c** · `claude` **2.1.231** · `pi` **0.84.1** · `codex` **0.147.0**.
`cursor` is **not installed** and was not tested.

> **Version discrepancy resolved (#18 asked).** `~/.local/share/claude/versions/` holds
> **2.1.231, 2.1.241 and 2.1.243**; the launcher symlink resolves to **2.1.231**, and the
> in-pane banner printed `Claude Code v2.1.231`. So the running build is 2.1.231, not the
> 2.1.241 the rollback was reported as. The one finding below that turns on a source read was
> re-checked in the 2.1.243 bundle and is byte-identical there.

---

## Verdict

**No. OSC 9;4 is not a cross-harness native status channel. It is one harness's channel plus a
second harness that emits the sequence and then deliberately routes it around tmux.**

Forcing `claude`'s gate open **does** make it emit OSC 9;4 — `\e]9;4;3;\a` at turn start and
`\e]9;4;0;\a` at turn end, 16–31 ms after submit. But under tmux `claude` wraps every one of them
in a **tmux DCS passthrough** (`\ePtmux;\e\e]9;4;3;\a\e\\`), which tmux by design relays without
parsing. `#{pane_pb_state}` therefore **never leaves `hidden`** for a `claude` pane, forced setting
or not. Same payload, two envelopes, measured back to back (§3.2):

```
bare      \e]9;4;3;\a                      -> pb_state = indeterminate
wrapped   \ePtmux;\e\e]9;4;3;\a\e\\        -> pb_state = hidden   (allow-passthrough off)
wrapped   \ePtmux;\e\e]9;4;3;\a\e\\        -> pb_state = hidden   (allow-passthrough on)
```

**There is a lever that recovers it, and it is a launch-time one.** The wrapper is selected by
`$TMUX` alone. Launch `claude` with the capability gate forced open (`TERM_PROGRAM=ghostty`,
`TERM_PROGRAM_VERSION=1.2.0` — the other route, `ConEmuANSI=1`, segfaults it) **and** with `TMUX`
and `TMUX_PANE` unset in the pane, and it emits the sequence bare,
and `#{pane_pb_state}` tracks the turn exactly: `indeterminate` 17–63 ms after submit, `hidden` at
turn end, **one clean ON/OFF pair per turn including across five sequential tool calls**, and
`hidden` 134 ms after `Esc`. That works with a real interactive client attached (§5).

**But the state it gives is working / not-working, and for `claude` the missing state is the
dangerous one.** A turn stopped at an approval prompt reads **`indeterminate`** — byte-identical
to a turn doing work — and it held that value for **102 seconds** while waiting on a human. #17
argued `pi`'s signal "fails stuck-working, the safe direction". **That argument does not transfer
to `claude`.** `pi` has no approval gate, so for `pi` blocked and idle are the same state. `claude`
has one, and on this channel an agent waiting for a human is indistinguishable from an agent
working — indefinitely. The supervisor never escalates and the human is never summoned. That is a
false *busy*, and it costs exactly as much as a false idle.

So, stated plainly: **forcing the setting on gives `claude` a working/not-working signal and still
gives it no blocked signal.** That is not a win over #8; it is a different two-thirds of the
problem.

**Two things do carry `blocked`, and both were established here rather than assumed:**

1. **OSC 777 on the raw stream.** `claude` emits `\e]777;notify;Claude Code;Claude needs your
   permission\a` when an approval prompt goes unanswered, and `…;Claude is waiting for your input\a`
   when a finished turn goes idle. **Two different strings for the two states #8 could not tell
   apart.** It is on the `pipe-pane` byte stream (tmux surfaces no format for OSC 777), it survives
   the DCS wrapper because the wrapper is still bytes in the pane's output, and it is *not*
   screen-scraping. It lags: **5.9 s** behind the dialog, and **60.0 s** behind turn end.
2. **A Jackdaw-installed hook.** `claude`'s hook contract accepts a `terminalSequence` field whose
   allowlist **explicitly admits the OSC 9;4 progress form**, and the emitter for it carries **no
   capability gate at all**. A `Notification` hook returning `\e]9;4;2;0\a` drove
   `#{pane_pb_state}` to **`error`** — a fourth, distinct, native state meaning *blocked*.
   Measured, working, with caveats in §6.

**Cost.** Reading `#{pane_pb_state}` needs tmux **3.7** against the **3.2** #3 pinned — unchanged
from #17, and it now buys less than #17 hoped. On 3.2–3.6, or on any pane where the adapter cannot
control the launch environment, scraping remains the mechanism. **#8's verdict stands.**

**Cross-harness score: 1 of 3 out of the box, 2 of 3 with launch-time configuration, 1 untested.**
`pi` yes (setting on). `claude` only if the adapter both forces the gate *and* unsets `TMUX`.
`codex` 0.147.0 has zero occurrences of `9;4` in its binary. `cursor` still not installed.

---

## 1. Positive control: the instrument carries every form, including claude's

Run before anything else, so that a later "pb_state never moved" is a statement about `claude` and
not about tmux.

```
tmux 3.7c   socket jackdaw-research-18

baseline       -> pb=[hidden]         prog=[0]
9;4;3          -> pb=[indeterminate]  prog=[0]
9;4;1;42       -> pb=[normal]         prog=[42]
9;4;2;0        -> pb=[error]          prog=[0]
9;4;0          -> pb=[hidden]         prog=[0]
```

`claude` emits a **trailing empty field** (`9;4;3;`, not `9;4;3`), so that form was controlled
separately before drawing any conclusion from it — it is accepted:

```
9;4;0        -> pb=[hidden]           9;4;3;       -> pb=[indeterminate]
9;4;3        -> pb=[indeterminate]    9;4;0;       -> pb=[hidden]
9;4;3;0      -> pb=[indeterminate]    9;4;2;       -> pb=[error]
9;4;2;0      -> pb=[error]            9;4;1;       -> pb=[normal] prog unchanged
9;4;1;50     -> pb=[normal] prog=[50]
```

`pb_progress` retains its last value after the state goes hidden — confirming #17: **only
`pb_state` is trustworthy as a latch.** The trailing semicolon is a red herring; it is not why
`claude` fails to move the format.

## 2. What `claude` 2.1.231 actually does, from its own bundle

All line content below is `grep -a` from `~/.local/share/claude/versions/2.1.231`.

### 2.1 The state machine has two outputs, not four

```js
function bzm({enabled: e, isLoading: t, hasToolsInProgress: r}) {
    if (!e) return null;
    if (t || r) return "indeterminate";
    return "completed";
}
```

and its only call site:

```js
let {progress: Or} = lhe(), At = Bv.useRef(null),
    yr = pd("terminalProgressBarEnabled", !0).value;      // <-- default TRUE
Bv.useEffect(() => {
    let $e = bzm({enabled: yr, isLoading: y, hasToolsInProgress: Jt});
    if (At.current === $e) return;                         // <-- change-guarded: no keepalive
    At.current = $e, Or($e);
}, [Or, yr, y, Jt]),
Bv.useEffect(() => () => Or(null), [Or]);
```

Three things follow before any experiment:

- **`terminalProgressBarEnabled` defaults to `true`** — so turning it *on* in `settings.json`
  changes nothing, and it is not the gate that was closing under tmux. It is still honoured, and
  therefore still a thing an adapter must not get wrong: a run with the gate forced open, `$TMUX`
  unset, and `"terminalProgressBarEnabled": false` produced **zero** OSC 9;4 across a whole turn
  (`ccE`, 6550 raw bytes, OSC inventory `0;<title>` only), while the pane title spun normally.
  The setting is a second, default-open gate in series with `c6t()`.
- **`error` and determinate `running` are dead code on this path.** The emitter supports all four
  (§2.2), but `bzm` can only ever return `indeterminate` or `completed`.
- **There is no keepalive.** The `At.current === $e` guard means one write per state *change*.
  `pi` re-sends `9;4;3` every 1000 ms, which is what makes emitter liveness observable on the raw
  stream (#17 §5). `claude` gives up that property. Confirmed on the wire: a 102-second blocked
  turn produced exactly **two** OSC 9;4 writes (§4.3).

### 2.2 The emitter, and the enums

```js
i = rIe.useCallback((s, a) => {
    if (!c6t()) return;
    if (!s) { e(T5($k(aA.ITERM2, Q9t.PROGRESS, Z9t.CLEAR, ""))); return }
    let l = Math.max(0, Math.min(100, Math.round(a ?? 0)));
    switch (s) {
      case "completed":     e(T5($k(aA.ITERM2, Q9t.PROGRESS, Z9t.CLEAR, "")));       break;
      case "error":         e(T5($k(aA.ITERM2, Q9t.PROGRESS, Z9t.ERROR, l)));        break;
      case "indeterminate": e(T5($k(aA.ITERM2, Q9t.PROGRESS, Z9t.INDETERMINATE,""))); break;
      case "running":       e(T5($k(aA.ITERM2, Q9t.PROGRESS, Z9t.SET, l)));          break;
      case null: break
    }
}, [e]);
```

```js
aA  = { SET_TITLE_AND_ICON:0, SET_ICON:1, SET_TITLE:2, SET_COLOR:4, SET_CWD:7, HYPERLINK:8,
        ITERM2:9, ..., SEMANTIC_PROMPT:133, GHOSTTY:777, ITERM2_PROPRIETARY:1337, TAB_STATUS:21337 };
Q9t = { NOTIFY:0, BADGE:2, PROGRESS:4 };
Z9t = { CLEAR:0, SET:1, ERROR:2, INDETERMINATE:3 };
```

So the wire form is OSC `9;4;{0,1,2,3}` — the same alphabet tmux parses. `SEMANTIC_PROMPT:133` is
in the enum but nothing emits it, consistent with #17's zero-OSC-133 capture for `claude`.

### 2.3 The gate — and why the user setting is not it

```js
function c6t() {
    let e = $w()?.progressReporting; if (e !== void 0) return e;
    if (!process.stdout.isTTY) return !1;
    if (Q.WT_SESSION) return !1;
    if (Q.ConEmuANSI || Q.ConEmuPID || Q.ConEmuTask) return !0;
    let t = y1d.coerce(Q.TERM_PROGRAM_VERSION); if (!t) return !1;
    if (Q.TERM_PROGRAM === "ghostty")   return jj(t.version, "1.2.0");
    if (Q.TERM_PROGRAM === "iTerm.app") return jj(t.version, "3.6.6");
    return !1
}
function $w() { return I4.attacherCaps() }
```

`progressReporting` is **not a settings key** — it is a field of the *attacher capabilities*
object, itself populated by `progressReporting: c6t()` on the client side. The only user-reachable
overrides are environment: `ConEmuANSI`, or a `TERM_PROGRAM`/`TERM_PROGRAM_VERSION` pair.
This environment has neither (`TERM=xterm-256color`, no `TERM_PROGRAM*`), which is the direct
explanation of #8's and #17's zero-`9;4` captures for `claude`.

**Of the two override routes, only one is usable, and it is the one with side effects.**

```
ConEmuANSI=1  ->  Segmentation fault (core dumped) claude       # 2 of 2 launches, 2.1.231
```

`ConEmuANSI` short-circuits `c6t()` before the `TERM_PROGRAM` branch and would otherwise be the
inert choice on Linux; instead it **segfaults `claude` 2.1.231 on startup, reproducibly**, in a
private server with and without `$TMUX` unset. (Unrelated to the fleet-wide 2.1.243 startup
segfault, which this build does not have.) So the only route that works is spoofing
`TERM_PROGRAM=ghostty` — and that is **not** inert: the bundle's `y9_` terminal set contains
`"ghostty"` and `wwn()` keys modifier-key interpretation off `TERM_PROGRAM`, so the spoof also
changes how `claude` reads keybindings. That side effect was not measured; see §11.

### 2.4 The finding that decides the ticket

```js
function T5(e) {
    let t = y6s();
    if (t === "tmux")   return `\x1BPtmux;${e.replaceAll("\x1B","\x1B\x1B")}\x1B\\`;
    if (t === "screen") return `\x1BP${e.replaceAll("\x1B","\x1B\x1B")}\x1B\\`;
    return e
}
function y6s() { let e = $w(); if (e) return e.mux; if (Q.TMUX) return "tmux"; if (Q.STY) return "screen"; return null }
```

**Every** progress emit in §2.2 goes through `T5`. Under tmux the sequence is wrapped in DCS
passthrough — the envelope whose entire purpose is *"do not interpret this, hand it to the outer
terminal"*. `claude` is not failing to talk to tmux; it is deliberately talking **through** it.
Byte-identical wrapper in **2.1.243**:

```js
function pt(t){let e=N();if(e==="tmux")return`\x1BPtmux;${t.replaceAll("\x1B","\x1B\x1B")}\x1B\\`;…}
```

Note `T5` is applied to the progress and notification sequences only — the OSC 0 title is written
bare, which is why `#{pane_title}` has always worked for `claude` and `#{pane_pb_state}` never has.

### 2.5 The hook escape hatch

```
"… returned a terminalSequence that was rejected by the allowlist (only OSC 0/1/2/9/99/777 and
 BEL are permitted, and OSC 9 bodies may not begin with a digit unless in the 9;4 progress form)"
```

```js
terminalSequence: N().describe("A terminal escape sequence (e.g. OSC 9 / OSC 777
    desktop-notification) for Claude Code to emit on your behalf. Only notification/title OSCs
    (0, 1, 2, 9, 99, 777) and BEL are permitted; anything else is dropped.").optional()
function cja(e){ let t = QJv(e); if (t === null) return null;
                 return t.map(r => r.kind === "bel" ? F8 : T5($k(r.ps, r.payload))).join("") }
function uja(e){ Cbi.write(e) }
```

The 9;4 progress form is **carved out of the allowlist by name**. `uja` writes straight to the
registered terminal writer with **no `c6t()` call anywhere in the path** — so a hook-supplied
progress sequence is not subject to the capability gate at all. It *is* still subject to `T5`
(`cja` calls it), so it needs the same `TMUX`-unset launch as everything else. Exercised in §6.

## 3. On the wire: forced on, under tmux

### 3.1 Control run and forced run, same rig, same prompt

`ccA` — default environment, gate closed. `ccB` — `TERM_PROGRAM=ghostty
TERM_PROGRAM_VERSION=1.2.0` exported in the pane before launch, gate open. Both under tmux with
`$TMUX` present.

```
ccA (gate closed)   raw 23050 B / 53 chunks / 90.6 s
  OSC inventory: 0;<title> x11 only
  A1-notool: OSC9;4={}   OSC133={}
  pb_state transitions: 1 (the baseline sample). Never left hidden.

ccB (gate forced)   raw 17840 B / 56 chunks / 51.6 s
  OSC inventory: 0;<title> x8, 9;4;0; x2, 9;4;3; x1
  B1-notool: OSC9;4={'9;4;3;': 1, '9;4;0;': 1}
        +0.033s  9;4;3;
        +7.098s  9;4;0;
  pb_state transitions: 1 (the baseline sample). Never left hidden.
```

**The gate works and the format does not move.** The bytes, with 60 characters of context, say why:

```
b'\x1b]0;\xe2\x9c\xb3 Claude Code\x07\x1bPtmux;\x1b\x1b]9;4;0;\x07\x1b\\'
b'\x1b]0;\xe2\x97\x90 Claude Code\x07\x1bPtmux;\x1b\x1b]9;4;3;\x07\x1b\\'
b'\x1b]0;\xe2\x9c\xb3 Write a poem about jackdaws\x07\x1bPtmux;\x1b\x1b]9;4;0;\x07\x1b\\'
```

The title OSC immediately before it is bare. The progress OSC is wrapped. Same pane, same write.

### 3.2 The envelope is the whole cause — controlled

Identical payload, emitted from a plain shell in the same server, with `allow-passthrough` in both
positions:

```
allow-passthrough = off
  clear                              -> pb=[hidden]
  bare 9;4;3; (claude payload)       -> pb=[indeterminate]
  clear                              -> pb=[hidden]
  DCS-wrapped, passthrough off       -> pb=[hidden]
allow-passthrough = on
  clear                              -> pb=[hidden]
  DCS-wrapped, passthrough on        -> pb=[hidden]
```

`allow-passthrough` changes nothing: with it off tmux drops the payload, with it on tmux forwards
it verbatim to the client's terminal. **Neither path parses it.** There is no tmux-side option that
recovers this signal — the fix has to be on the emitter's side.

## 4. Unset `TMUX`, and the channel appears

`ccC` — `unset TMUX TMUX_PANE` plus the ghostty gate, then `claude`. Everything below is one
session, `pipe-pane` and 100 ms sampler running throughout.

### 4.1 Per-turn, from the byte stream

```
C1-notool     +0.031s  9;4;3;    +6.421s  9;4;0;
C2-tool(read) +0.018s  9;4;3;    +6.097s  9;4;0;
C3-tool(bash) +0.016s  9;4;3;    +4.581s  9;4;0;
C4-BLOCKED    +0.016s  9;4;3;  +102.036s  9;4;0;     <-- 102 s waiting on a human, no state change
C5-multitool  +0.020s  9;4;3;   +15.620s  9;4;0;     <-- 5 sequential tool calls, one ON/OFF pair
```

**Exactly one `9;4;3;` and one `9;4;0;` per turn, in every turn, with no mid-turn flicker.**
That is the property a supervisor needs, and `claude` has it — once the bytes can reach tmux.

### 4.2 And on the other side of tmux, at 100 ms

```
…923.529  pb=hidden         title=apbfw16
…940.614  pb=indeterminate  title=◐ Claude Code                 C1  submit …940.561  ->  53 ms
…947.070  pb=hidden         title=✳ Write a 120-word poem…
…961.847  pb=indeterminate  title=◐ …                           C2  submit …961.754  ->  93 ms
…967.851  pb=hidden         title=✳ …
…974.963  pb=indeterminate  title=◐ …                           C3  submit …974.865  ->  98 ms
…979.538  pb=hidden         title=✳ …
…995.804  pb=indeterminate  title=◐ …                           C4  submit …995.787  ->  17 ms
…097.866  pb=hidden         title=✳ …                           C4  approved …096.610
…102.652  pb=indeterminate  title=◑ …                           C5  submit …102.594  ->  58 ms
…118.219  pb=hidden         title=✳ …
…244.596  pb=indeterminate  title=◑ …                           C6  submit …244.569  ->  27 ms
…252.642  pb=hidden         title=✳ …                           C6  Esc …252.508    -> 134 ms
…321.409  pb=indeterminate  title=◑ …                           C7  submit …321.346  ->  63 ms
…432.285  pb=hidden         title=✳ …                           C7  end
```

Seven turns, fourteen transitions, **zero spurious ones**. Emitter-side latency 16–31 ms;
observer-side 17–98 ms, which is the 100 ms sampler's own granularity. Abort is handled: `Esc` to
`hidden` in 134 ms.

**`#{alternate_on}` differs between the two launches of the same binary:** `0` with `$TMUX` set,
`1` with it unset. This sharpens #17's correction of #8 — it is not merely per-session, it moves
with the *launch environment*, so it must be read live per pane and can change when an adapter
changes how it launches.

### 4.3 Blocked vs done — the question the ticket said decides the value

C4 asked for a file write, which `manual` mode gates behind an approval dialog. Timeline:

```
submit                        …995.787
9;4;3; on the wire            …995.803   (+16 ms)
approval dialog first frame   …998.461   (+2.7 s)
… 102 seconds of a human not answering …
approval keypress             …096.610
9;4;0; on the wire            …097.823
```

During those 102 seconds, `#{pane_pb_state}` read **`indeterminate`**, continuously. Sampled at
100 ms and cross-tabulated with the pane title's leading glyph:

```
C4, submit .. approval keypress      samples = 924
   902  pb=indeterminate  title=idle-glyph (✳)      <-- 90.2 s of BLOCKED
    22  pb=indeterminate  title=spinner   (◐◑)      <-- 2.2 s of genuine work before the dialog

C1, a no-tool working turn           samples = 59
    59  pb=indeterminate  title=spinner   (◐◑)      59/59
C2, a one-tool working turn          samples = 55
    55  pb=indeterminate  title=spinner   (◐◑)      55/55
C5, the five-tool working turn       samples = 143
   143  pb=indeterminate  title=spinner   (◐◑)      143/143
```

So, for `claude`, on this channel alone:

| state | `pane_pb_state` |
|---|---|
| working | `indeterminate` |
| **blocked on approval** | **`indeterminate`** |
| finished | `hidden` |

**Blocked and finished are distinguishable; blocked and working are not.** That is the mirror image
of #8, where the title collapsed blocked into *done*. It is the safer of the two collapses only for
a harness that cannot block. `claude` can, so this collapse hides the one event that needs a human.

There is one honest consolation, and it is a *pair*, not this channel: during the blocked window
the title carried the **idle** glyph `✳` while `pb_state` said `indeterminate` — a combination that
never occurred while genuinely working (0 of 257 samples across three working turns, one of them
five tool calls long). `(pb_state, title-glyph-class)`
separates all three states:

```
working   = (indeterminate, spinner)
blocked   = (indeterminate, idle glyph)
finished  = (hidden,        idle glyph)
```

Both halves are tmux **formats**, so this is not screen-scraping — but it does put weight back on
the title, whose spinner #8 found flickers and produces phantom `-B` notifications. Read as a
*class* (spinner vs not) rather than a value it separated the three states cleanly in every window
sampled here. Offered as a lead, not a verdict: one harness version, one permission mode, one
session.

### 4.4 There is no liveness beat

`pi` re-sends `9;4;3` every second, so `pipe-pane` can prove the emitter is alive (#17 §5).
`claude`'s emitter is change-guarded (§2.1) and the 102-second blocked turn produced **two** writes
total. `claude` therefore has no equivalent of that beat on either tier. Combined with #17's
finding that tmux holds a stale `pb_state` indefinitely, **the per-pane staleness clock #8 demanded
is still required, and for `claude` nothing can substitute for it.**

## 5. Does it survive a real interactive client?

Every observation in #8 and #17 came from a `-C attach -f no-output` control client. A genuine
client was attached on a real pty (`pty.fork`, `TIOCSWINSZ` 200x50, `TERM=xterm-256color`):

```
client=/dev/pts/13 tty=/dev/pts/13 flags=[attached,focused,UTF-8] control=0 size=200x50
session_attached=1
```

With that client attached and rendering the pane, turn C7 moved `pb_state` to `indeterminate`
63 ms after submit and back to `hidden` at turn end — identical to the unattached turns. **Yes, it
survives.**

One secondary observation: 1.16 MB of client output contained **zero** `9;4`. tmux 3.7c did not
forward the progress state outward to this client, because `xterm-256color` does not advertise the
`progressbar`/`Spb` capability. Irrelevant to Jackdaw, which reads the format, but it means a human
watching the pane in a plain terminal sees nothing.

## 6. The hook route: a native `blocked` state, with caveats

Following §2.5. Scratch config, no other changes:

```json
"hooks": {
  "Notification": [{"hooks":[{"type":"command","command":".../hook-blocked.sh"}]}],
  "Stop":         [{"hooks":[{"type":"command","command":".../hook-done.sh"}]}]
}
```

```bash
# hook-blocked.sh          # hook-done.sh
cat > /dev/null            cat > /dev/null
printf '{"terminalSequence":"\\u001b]9;4;2;0\\u0007"}\n'
                           printf '{"terminalSequence":"\\u001b]9;4;0\\u0007"}\n'
```

`ccD`, same `TMUX`-unset launch, one turn that trips the approval dialog:

```
…456.574  TURN_START  D1-blocked "Create a new file called hooked.txt containing the word rook."
…457.180  SUBMIT
…457.259  pb=indeterminate     (+79 ms)      claude's own emitter
…460.642  approval dialog first frame (+3.5 s)
…466.648  pb=error             (+6.0 s after the dialog)   <-- the Notification hook
…491.641  pb=hidden                                        <-- the Stop hook
```

**`#{pane_pb_state}` = `error` is a real, native, fourth state meaning *blocked*.** It is read by
`display -p` and pushed by `refresh-client -B` like any other value, and it costs no scraping and
no `pipe-pane`.

Three caveats, all measured, none fatal:

1. **It is late.** 6.0 s behind the dialog. The `Notification` event is on a debounce, not on the
   dialog's render. The same 6 s appears independently in §7.
2. **The hook and `claude` fight over one latch.** `claude`'s emitter is change-guarded: after the
   hook overwrote the pane state to `error`, `claude` still believed it had emitted
   `indeterminate`, so on approval it emitted nothing and the pane stayed `error` for the rest of
   the turn — until the `Stop` hook cleared it. The design only works if Jackdaw owns *every*
   transition it cares about, i.e. installs the complementary hooks too. A half-installed hook set
   leaves the latch stuck.
3. **It requires the adapter to write hooks into the harness's config**, which is a strictly larger
   claim on the harness than "pass a launch flag".

## 7. OSC 777: `blocked` on the raw stream, no hooks required

Unprompted, in the default configuration, `claude` emits desktop notifications as OSC 777 — and
the two strings are different:

```
ccC  ts …004.343   \x1b]777;notify;Claude Code;Claude needs your permission\x07
ccB  ts …878.760   \x1bPtmux;\x1b\x1b]777;notify;Claude Code;Claude is waiting for your input\x07\x1b\\
```

- *"Claude needs your permission"* fires **5.9 s** after the approval dialog renders (dialog
  …998.461, notify …004.343).
- *"Claude is waiting for your input"* fires **60.0 s** after turn end (`9;4;0;` …818.759, notify
  …878.760) — the `messageIdleNotifThresholdMs` default, which the bundle confirms gates it:

  ```js
  if (… && Cr >= Qt().messageIdleNotifThresholdMs)
      DLe({message:"Claude is waiting for your input", notificationType:"idle_prompt"}, tr)
  ```

**These are two distinct byte strings for the two states #8 proved the title cannot separate.**
Note the `ccB` capture: even wrapped in DCS passthrough, it is still there in the pane's output, so
this signal is available on `pipe-pane` **whether or not the adapter unsets `TMUX`** — it is the
only blocked signal here that does not depend on the launch environment. tmux exposes no format for
OSC 777, so it costs a `pipe-pane` (one per pane, #17 §5.2) and its latency is the debounce.

**A byte-level extractor must handle both envelopes, and the wrapped one doubles every ESC.**
`T5` does `replaceAll("\x1b", "\x1b\x1b")`, so on the wire the wrapped form is
`\x1bPtmux;\x1b\x1b]777;…\x07\x1b\\` — the payload's own introducer appears as **two** ESC bytes.
A naive `\x1b\]777;` match still hits it only by accident (it matches the second ESC). Any
extractor Jackdaw builds must strip the DCS envelope and un-double the escapes explicitly, or it
will silently mis-parse exactly the panes where the fallback matters most. The same applies to the
`9;4` sequences in a `$TMUX`-set pane.

I did not pin down the constant behind the 5.9 s permission debounce or whether it is configurable;
two independent measurements (5.88 s in §7, 6.01 s in §6) agree, and that is all that is claimed.

## 8. `pi`: `agent_end` fires once per turn, not once per round-trip

#17's open item 2 — observed clean on a 5.4 s two-tool turn, never run against a long sequential
one. Run here: `pi` 0.84.1, scratch `PI_CODING_AGENT_DIR` with
`terminal.showTerminalProgress: true`, a turn that performed **seven sequential tool calls**
(read x3, ls, `wc -c`, `ls -la`, `date`) over 24.6 s.

```
raw 588779 B / 498 chunks
OSC inventory: 8;; x821, 133;B x36, 133;C x36, 9;4;3 x25, 133;A x9, 0;π - proj x1, 9;4;0 x1

P1-longtools:  +0.006s 9;4;3
               +1.007s … +24.018s   9;4;3  x24, spaced 1.000-1.001 s   (the keepalive)
              +24.582s 9;4;0
```

**One `9;4;0`, at the end, and nowhere else.** The 100 ms sampler agrees: `indeterminate` at
+52 ms, `hidden` at +24.6 s, two transitions total. **No mid-turn false idle.** #17's open item 2
is closed: `agent_end` is turn-scoped, as its `interactive-mode.js` call sites imply.

## 9. Static scan of the other harnesses

```
                    ]133   9;4   emits 9;4 at runtime   drives pane_pb_state
pi      0.84.1       yes   yes   yes (setting on)       yes
claude  2.1.231       0     7    yes (gate forced)      only if $TMUX is unset
codex   0.147.0       0     0    no                     no
cursor              not installed — not tested, no claim made
```

`grep -ac '9;4'` on the `codex` 0.147.0 binary returns **0**, reproducing #17. `cursor` is now
three studies old as an untested gap and needs a machine that has it.

## 10. What this changes for the design

1. **#8's verdict stands.** Screen-scraping remains the fallback for any harness without a hook
   API. OSC 9;4 does not replace it; it supplements it for two harnesses, both of which need the
   adapter to configure the launch.
2. **The adapter contract needs a *launch environment*, not just launch arguments.** #2 asked for
   launch arguments. `claude` needs three environment edits at once: `TERM_PROGRAM`/
   `TERM_PROGRAM_VERSION` spoofed to open the capability gate, `TMUX` and `TMUX_PANE` **removed**
   so the sequence is not wrapped, and `terminalProgressBarEnabled` left alone or `true`. That is
   a stronger and stranger requirement than a flag — and one with side effects Jackdaw must own,
   because a `claude` that cannot see `$TMUX` also cannot use its own tmux integrations, and a
   spoofed `TERM_PROGRAM` changes modifier-key handling. That trade is a design decision, not an
   implementation detail.
3. **The channel's alphabet is not the channel's semantics.** tmux gives four states; `claude`'s
   own state machine can produce two. The extra states exist only if Jackdaw writes them, via
   hooks.
4. **`blocked` is available for `claude`, by three different mechanisms, none of them this
   channel's default behaviour**, and only one of them is independent of the launch environment:
   - a `Notification` hook writing `9;4;2` — native format, 6 s late, needs config write access,
     and **inherits the `$TMUX`-unset precondition**, because `cja` routes the hook's sequence
     through the same `T5` wrapper (§2.5). It is not an independent path.
   - **OSC 777 on the raw stream** — needs a `pipe-pane`, 6 s late, and needs nothing else. It is
     the **only** blocked signal here that works with `$TMUX` set, on tmux 3.2, unconfigured.
   - the `(pb_state, title-glyph)` pair — two formats, immediate, but leans on the title #8
     distrusts, and still needs the `$TMUX`-unset launch for the `pb_state` half.

   Jackdaw should pick one deliberately, and should notice that the cheapest-to-deploy option is
   the one that does not use this channel at all.
5. **The staleness clock is still mandatory and now less optional than in #17.** `claude` has no
   keepalive, so neither reachability tier can prove the emitter is alive.
6. **`#{alternate_on}` moves with the launch environment**, not only with runtime mode. Read it
   live, per pane, after launch.
7. **The tmux 3.7 floor buys less than #17 priced it at.** It is still required to read
   `pane_pb_state`, and the machines on 3.2–3.6 still fall back to scraping — but for `claude` the
   floor is now necessary *and not sufficient*, because the launch environment matters more than
   the tmux version.

## 11. Where this stops

**Established here:** `claude` emits OSC 9;4 when the gate is forced (§3.1), and does not when
`terminalProgressBarEnabled` is `false` or when `ConEmuANSI` crashes it first (§2.1, §2.3); it is DCS-wrapped and
therefore invisible to `#{pane_pb_state}` (§2.4, §3.1, §3.2); unsetting `$TMUX` recovers it with
clean one-pair-per-turn semantics and 16–31 ms latency (§4.1–4.2); blocked reads as `indeterminate`
and is indistinguishable from working (§4.3); it survives a real interactive client (§5); a
`Notification` hook can drive `pb_state=error` (§6); OSC 777 distinguishes blocked from idle on the
raw stream (§7); `pi`'s `agent_end` is turn-scoped over a 7-tool turn (§8); `codex` has nothing (§9).

**Not established, and why:**

1. **`cursor`** — still not installed on this machine. Untested for the third study running.
2. **What unsetting `$TMUX` costs `claude`.** It was not measured, and the entire positive half of
   this verdict rests on it. `y6s()` feeds a `mux` field that other subsystems read, and teammate
   spawning has a `tmux` mode. Before #5 commits to this lever, someone should run a `claude` with
   `TMUX` unset through a real task including `/teammate`-style work and see what breaks. The one
   difference already visible here is that the pane runs on the alternate screen
   (`alternate_on=1`) instead of the main one — which changes what `capture-pane` and scrollback
   see, i.e. it changes the scraping fallback too.
2b. **What spoofing `TERM_PROGRAM=ghostty` costs.** Source-read only: `y9_` contains `"ghostty"`
   and `wwn()` derives modifier-key behaviour from `TERM_PROGRAM`, so the spoof plausibly changes
   keybinding interpretation. Not exercised. The alternative gate route, `ConEmuANSI=1`, is ruled
   out — it segfaults 2.1.231 on startup (§2.3).
3. **The 5.9 s permission-notification debounce** — measured twice, constant not located in the
   bundle, configurability unknown. If it is tunable, the hook route's latency is tunable with it.
4. **`9;4;1;N` (determinate)** is emitted by no harness tested. `claude` has the code path
   (`case "running"`) but `bzm` cannot reach it. Whether a future version drives it — e.g. from
   token counts or todo progress — is unknown and would be worth re-checking on version bumps.
5. **Whether the `(pb_state, title-glyph)` pair holds** across permission modes, harness versions,
   and long sessions. One session, one version, `manual` mode only.
6. **`refresh-client -B` delivery of `pb_state` for `claude`** was not re-measured here; #17
   established it for synthetic transitions and `pi`, and nothing about `claude` changes the
   transport.

## Appendix: reproduction

Scripts and raw logs are under the session scratchpad at `.../scratchpad/r18/` — not committed.
The essentials:

```bash
S=jackdaw-research-18
tmux -L $S new-session -d -s ctl -x 200 -y 50
tmux -L $S set -g exit-empty off

# scratch config; the real ~/.claude is never written
#   settings.json:  {"terminalProgressBarEnabled": true}      (already the default — see §2.1)
#   .claude.json:   hasCompletedOnboarding + hasTrustDialogAccepted for the scratch project
# pane holds a bare shell first, so pipe-pane is attached before claude writes a byte
tmux -L $S new-window -d -n cc -c "$PROJ" "env -u CLAUDECODE … bash --noprofile --norc"
tmux -L $S pipe-pane -o -t cc "python3 stamp.py cc.raw cc.idx"

# force the capability gate open …
tmux -L $S send-keys -t cc 'export TERM_PROGRAM=ghostty TERM_PROGRAM_VERSION=1.2.0' Enter
# … and, crucially, stop claude from wrapping the sequence in DCS passthrough
tmux -L $S send-keys -t cc 'unset TMUX TMUX_PANE' Enter
tmux -L $S send-keys -t cc "export CLAUDE_CONFIG_DIR=$A; cd $PROJ && claude" Enter

# 100 ms ground truth
while :; do
  printf '%s\t%s\n' "$(date +%s.%N)" \
    "$(tmux -L $S display -p -t cc '#{pane_pb_state}|#{pane_pb_progress}|#{pane_title}|#{alternate_on}|#{history_size}')"
  tmux -L $S capture-pane -p -t cc > "frame-$(date +%s.%N).txt"
  sleep 0.1
done
```

> **A tmux target gotcha, recorded because it nearly corrupted a run.** `-t ctl` names a *session*
> and resolves to that session's **active window**. After `select-window -t ccC`, every
> `send-keys -t ctl` in the control scripts was landing in the `claude` pane. Target the window by
> name explicitly in any rig that also switches windows.

The private server was destroyed at the end of the session
(`tmux -L jackdaw-research-18 kill-server`, verified: `no server running on
/tmp/tmux-1000/jackdaw-research-18`); the user's live fleet socket was never contacted and no
live-fleet `claude` pane was restarted.
