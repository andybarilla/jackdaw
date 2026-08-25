# Does a scraped status signal survive the trip through tmux?

Research for [andybarilla/jackdaw#8](https://github.com/andybarilla/jackdaw/issues/8). Date: 2026-08-24.

**Question.** For the harnesses with no structured channel, does a scraped status signal
survive the trip through tmux? Specifically: does `#{pane_title}` carry usable state, does the
`refresh-client -B` subscription deliver it, and what does `capture-pane` screen-scraping cost
in *accuracy*.

**Method.** Experimental, not documentary. Everything below was run against a private tmux
server (`tmux -L jackdaw-research-8`) on `apbfw16`; the user's live fleet server was never
touched and no `send-keys` went anywhere outside that socket. Two observers watched every run
simultaneously so latency is a difference of two clocks on the same transition:

- a **100 ms sampler** (`display -p '#{pane_title}'` + `capture-pane -p`, logged on change,
  every changed frame written to disk) — ground truth,
- a **`refresh-client -B` subscriber** (`tmux -C attach -f no-output`, then
  `refresh-client -B jdtitle:%*:"#{pane_title}"`) with each line stamped on arrival,
- and for the byte-level questions, `pipe-pane` writing the pane's raw pre-render stream.

**Versions.** tmux 3.7c · `claude` **2.1.241** · `pi` **0.84.1** · herdr catalog fetched live
from `https://herdr.dev/agent-detection/index.toml` on the day.
The Claude panes displayed `✔ Update installed · Restart to update` mid-session and were
deliberately **not** restarted — 2.1.243 segfaults on startup fleet-wide, and 2.1.241 is the
rolled-back build under test.

---

## Verdict

**The title survives the trip through tmux intact. It is not a status signal.**

tmux delivers `#{pane_title}` faithfully and the subscription pushes it reliably at 1 Hz. The
problem is upstream of tmux: the title's alphabet is too small. For Claude Code it is a busy
spinner plus a conversation summary, and `✳` — the not-working glyph — is **overloaded across
finished, awaiting-input, and (observed once, for 14 s) actually working**. For `pi` the title
is a compile-time constant: `π - piproj`, emitted once at startup and never again.

Concretely, against the two harnesses:

| | `claude` 2.1.241 | `pi` 0.84.1 |
|---|---|---|
| Sets `#{pane_title}` at all | yes | yes, **once**, at startup |
| working distinguishable | mostly — `◐`/`◑` spinner at ~1 Hz, but see the 14 s false-idle below | **no** |
| awaiting-input distinguishable from done | **no** — byte-identical `✳` for 26 s while a modal blocked the pane | **no** |
| screen-scrape working | yes, 0 false positives observed | yes, but trivially poisoned |
| screen-scrape blocked | yes (this is the only path that works) | **no rule exists** |
| alt-screen (`#{alternate_on}`) | **1** — `history_size=0`, no scrollback at all | **0** — `history_size` grows |

So: **scraping is good enough for `claude`, and only from the screen, never from the title.
For `pi` it is not good enough on any axis.** `pi` is second-class in Jackdaw and that belongs
in the adapter contract (#5). The one hopeful lead is that `pi` turns out to emit **OSC 133**
prompt marks — a structured channel #2 did not know about — reachable today through
`pipe-pane` and natively through tmux 3.8's `pane-shell-prompt` hook when it lands.

---

## 1. Positive control: tmux carries OSC 2, on this server, with these options

Establishing this first matters, because "the harness emits nothing" and "tmux swallowed it"
are otherwise indistinguishable.

```
$ tmux -L jackdaw-research-8 show-options -g   | grep -i title
set-titles on
set-titles-string "#T"
$ tmux -L jackdaw-research-8 show-options -g -w | grep -i 'title\|rename'
allow-rename off
allow-set-title on
automatic-rename on

$ tmux -L ... send-keys -t ctl 'printf "\033]2;JACKDAW-SENTINEL\007"' Enter
$ tmux -L ... display -p -t ctl 'title=[#{pane_title}]'
title=[JACKDAW-SENTINEL]

$ tmux -L ... send-keys -t ctl 'printf "\033]0;JACKDAW-SENTINEL-0\007"' Enter
title=[JACKDAW-SENTINEL-0] window=[zsh]
```

`allow-set-title` is **on** by default; `allow-rename` is **off** by default, so OSC 0 sets the
pane title without renaming the window. Default pane title before anything sets one is the
hostname (`apbfw16`) — worth knowing, because "hostname" is Jackdaw's *no signal yet* value.

`pipe-pane` was likewise controlled before being trusted:

```
$ tmux -L ... pipe-pane -o -t pctl "cat >> pctl.raw"
$ tmux -L ... send-keys -t pctl 'printf "\033]2;PIPE-CONTROL-TITLE\007"; printf "\033]9;4;1;50\033\\"' Enter
raw bytes: 132
OSC seqs: [b'2;PIPE-CONTROL-TITLE', b'9;4;1;50']
```

Both OSC 2 and OSC 9;4 reach the pipe verbatim. So a later "zero OSC on the wire" result is a
statement about the harness, not about the instrument.

## 2. `refresh-client -B` latency, and what 1 Hz misses

Synthetic titles driven at known times, both observers running:

```
  apbfw16          sampler=…697.436  sub=…698.426  lag=0.990 s
  RIG-STATE-1      sampler=…701.671  sub=…702.431  lag=0.760 s
  RIG-STATE-2      sampler=…704.208  sub=…704.433  lag=0.225 s
  RIG-STATE-3      sampler=…706.646  sub=…707.436  lag=0.790 s
  RIG-STATE-4      sampler=…709.182  sub=…709.438  lag=0.256 s
  RIG-STATE-5      sampler=…711.729  sub=…712.441  lag=0.712 s
  RIG-AFTER-BLIP   sampler=…714.375  sub=…714.443  lag=0.068 s
  RIG-AFTER-BLIP2  sampler=…717.228  sub=…717.446  lag=0.218 s
titles the 100 ms sampler saw but the subscription never delivered:
   MISSED: RIG-BLIP
```

**Delivery is reliable; latency is 0.07–0.99 s, uniform in [0, 1 s) as a 1 Hz sampling grid
predicts.** `%subscription-changed` arrivals sit exactly 1.000–1.002 s apart in every long run,
so `-B` is a sampler, not an event stream — #3's "≤1 Hz" is confirmed as "exactly 1 Hz".

**Short-lived transitions are lost.** `RIG-BLIP` dwelt 208 ms (sampler saw it at …714.167,
gone by …714.375) and the subscription never reported it. `RIG-BLIP2` at 50 ms was invisible to
both observers. This is not a corner case for real harnesses — see §3, where the spinner's own
period beats against the sampling grid.

## 3. Claude Code: the title is a spinner plus a summary

Byte-level, from process start, with `pipe-pane` running before the first frame — **every OSC
the harness emitted in a whole session**:

```
  b'0;\xe2\x9c\xb3 Claude Code'                  # ✳ idle
  b'8;id=r7fux7;https://claude.ai/code/session_01Y1WcBcqxBxbuZHAKUupTyM'
  b'8;;'
  b'0;\xe2\x97\x90 Claude Code'                  # ◐ working
  b'0;\xe2\x97\x91 Claude Code'                  # ◑ working
  b'0;\xe2\x97\x91 Write haiku about jackdaws'   # summary lands mid-turn
  b'0;\xe2\x97\x90 Write haiku about jackdaws'
  b'0;\xe2\x97\x91 Write haiku about jackdaws'
  b'0;\xe2\x97\x90 Write haiku about jackdaws'
  b'0;\xe2\x97\x91 Write haiku about jackdaws'
  b'0;\xe2\x9c\xb3 Write haiku about jackdaws'   # ✳ done
```

It is **OSC 0**, not OSC 2, and there is **no OSC 9;4 progress at all** — herdr's
`osc_progress_idle` rule (`region = "osc_progress"`, `regex = ['^4;0']`) has nothing to match on
this build. Only three OSC types ever appear: title, hyperlink, hyperlink-close.

The glyphs match herdr's catalog exactly — `osc_title_working` is
`regex = ['^[\x{2800}-\x{28FF}\x{25D0}-\x{25D3}] ']` (braille or half-circles) and
`osc_title_idle` is `regex = ['^\x{2733} ']`. `◐` is U+25D0 and `✳` is U+2733, both with the
trailing space the rules require.

### 3.1 The spinner beats against the 1 Hz grid

100 ms ground truth alongside the subscription, one short turn:

```
  …439.392  '✳ Claude Code'                  dwell=17.555 s
  …456.947  '◐ Claude Code'                  dwell=0.996 s
  …457.943  '◑ Claude Code'                  dwell=0.114 s     <-- missed by -B
  …458.057  '◑ Write haiku about jackdaws'   dwell=0.885 s     <-- missed by -B
  …458.942  '◐ Write haiku about jackdaws'   dwell=0.894 s
  …459.836  '◑ Write haiku about jackdaws'   dwell=0.999 s
  …460.835  '◐ Write haiku about jackdaws'   dwell=0.900 s
  …461.735  '◑ Write haiku about jackdaws'   dwell=0.444 s
  …462.179  '✳ Write haiku about jackdaws'
```

```
  …457.872  %subscription-changed jdtitle : ◐ Claude Code
  …458.873  %subscription-changed jdtitle : ◐ Write haiku about jackdaws
  …459.874  %subscription-changed jdtitle : ◑ Write haiku about jackdaws
  …460.875  %subscription-changed jdtitle : ◐ Write haiku about jackdaws
  …461.877  %subscription-changed jdtitle : ◑ Write haiku about jackdaws
  …462.878  %subscription-changed jdtitle : ✳ Write haiku about jackdaws
```

The spinner alternates on a ~0.9 s period against a 1.000 s grid, so the subscription
under-reports frames and reports a phantom `◐ Claude Code` → `◐ Write haiku` transition that
never happened as a *pair*. This is harmless for a `working?` predicate — both glyphs mean
working — but it means **`%subscription-changed` on `#{pane_title}` is a change-notification
stream that does not correspond one-to-one with the harness's own transitions.** Jackdaw must
normalise (glyph → state) before timestamping an event, or the event log fills with spinner
noise. The one transition that matters, working→done, arrived with 0.70 s lag (`…462.179` →
`…462.878`).

A 34 s turn behaved identically: `◐`/`◑` every second from `…542.968` to `…577.004`, then `✳`.

### 3.2 The false-idle: 14 s of work with the title reporting `✳`

In an earlier session the same prompt produced, at 100 ms sampling, a title that **never left
the sparkle** for the entire turn:

```
  …783.875 TITLE='✳ Claude Code'
  …784.712 TITLE='✳ Corvid poem'     <-- summary updates, prefix stays ✳
  …785.341 TITLE='✳ Corvid poem'
  …            (55 changed frames, 14 s of streaming output)
  …798.958 TITLE='✳ Corvid poem'
```

The harness demonstrably was working — the screen streamed a 250-word poem and the transcript
line afterwards read `✻ Cooked for 14s`. So the title said *not working* for 14 s while the
agent worked, and the summary updated during that window, which proves the harness was emitting
titles and choosing the sparkle prefix.

Two hypotheses were checked against the saved frames and **both were refuted**:

- *A modal was open, suppressing the spinner* — the onboarding modal appears in exactly **1 of
  the 55 frames**, the last one, after the turn had ended.
- *Background agents differ between runs* — both runs show `← 2 agents` in the footer
  (229 and 223 frames respectively).

What the run-A frames do show is the welcome/release-notes banner still scrolled into the
viewport. Cause not identified. It is reported as an observed, unexplained **false-idle**,
which is the failure direction a supervisor cannot tolerate: a working agent that reads as
finished gets escalated, restarted, or handed new work.

### 3.3 Blocked is indistinguishable from done

Two independent blocking modals, both leaving the title untouched:

```
=== A: BLOCKED on onboarding form ===
TITLE=[✳ Corvid poem]
  Teach auto mode about your environment?
  Auto mode works better when it knows your environment. Takes about a minute.
  ❯ 1. Yes
    2. Not now
    3. Don't show again
  Enter to confirm · Esc to cancel
```

```
=== B: BLOCKED on /model picker ===
TITLE-while-blocked=[✳ Write haiku about jackdaws]
TITLE-still-blocked-after-26s=[✳ Write haiku about jackdaws]
TITLE-after-dismiss=[✳ Write haiku about jackdaws]
```

Twenty-six seconds blocked on a modal, and the title before, during and after is one byte-for-byte
identical string. **There is no title-based path to `awaiting-input` for Claude Code.**
herdr agrees by construction: of its five `blocked` rules for claude, **zero** use
`region = "osc_title"` — every one of them is a screen rule.

**Not tested: a real tool-permission prompt.** Four attempts (`touch`, `curl | head`, a command
substitution, an explicit Bash request) were all auto-approved by this machine's settings, so no
`Do you want to proceed?` box was ever produced. The modal results above are structurally the
same shape — the `❯ 1. … / Enter to confirm · Esc to cancel` form herdr's `live_blocked_form`
matches — but the verdict on the permission prompt specifically rests on herdr's rule set, not
on an observation here. Re-running with `CLAUDE_CONFIG_DIR` pointed at an empty scratch dir
would settle it.

## 4. pi: the title is a constant, but there is OSC 133 underneath

`pi --provider anthropic --model anthropic/claude-sonnet-4-5`, one full working turn producing a
250-word poem. Every pane title the 100 ms sampler saw across the run:

```
      1 TITLE='apbfw16'
    168 TITLE='π - piproj'
```

Two `%subscription-changed` events in the whole session — the initial value and the one title
pi ever sets:

```
  …292.060 %subscription-changed jdtitle : apbfw16
  …294.062 %subscription-changed jdtitle : π - piproj
```

Byte level, 423 KB of raw pane output for that one turn:

```
raw bytes: 423239
OSC count: 606
   553 b'8;;'                          # hyperlink close
    25 b'133;B'
    25 b'133;C'
     2 b'133;A'
     1 b'0;\xcf\x80 - piproj'          # the only title, at startup
```

**`pi` sets its pane title exactly once, to a constant that encodes the project name and
nothing else.** The title path is not degraded for pi; it is absent. For the harness the ticket
singles out as the one that must rely on scraping, `#{pane_title}` and therefore the whole
`refresh-client -B` design carries zero status information.

### 4.1 The OSC 133 lead

`pi` emits **OSC 133 semantic prompt marks** — `133;A` (prompt start), `133;B` (end of prompt),
`133;C` (command output start) — 52 of them in a single turn. #2 concluded pi has no structured
channel because it has no approval gate and no hook system; this is a different kind of channel
and it was not surveyed.

Scoping it honestly:

- 25 `B`/`C` pairs per turn is **block-level, not turn-level**. The mapping from marks to
  lifecycle states is **unestablished** — this is a lead, not a solved channel.
- It is reachable **today** via `pipe-pane`, which #3 established as viable for transcripts.
  Extracting it is cheap despite the firehose: 52 marks out of 423 KB, but the filter is a
  fixed-string scan for `\x1b]133` on a stream, not a render.
- tmux **3.8 (unreleased)** adds `pane-shell-prompt` / `pane-command-started` /
  `pane-command-finished` hooks, which would surface these natively. tmux 3.7c exposes nothing:
  `#{pane_last_prompt}`, `#{pane_shell_prompt}` and `#{pane_progress}` all expand empty, and no
  such hooks exist in `man tmux`.

Worth a ticket. It does not rescue this verdict, because it is unproven and version-gated.

## 5. What screen-scraping actually costs in accuracy

### 5.1 The alt-screen asymmetry — a per-harness property that changes scraper correctness

```
claude : alternate_on=1  history_size=0    capture-pane -S -  →  50 lines (== the viewport)
pi     : alternate_on=0  history_size=57   capture-pane -S -  → 107 lines
```

Claude Code is a full-screen alternate-screen application, so tmux keeps **no scrollback for it
at all**. Two consequences, in opposite directions:

- The classic stale-prompt false positive **cannot happen**: after dismissing the `/model`
  picker, every probe returned zero in both the viewport and the full history —
  `'select model'`, `'enter to confirm'`, `'enter to select'`, `'esc to cancel'`,
  `'do you want to proceed?'`, all `visible=0 history=0`.
- But there is no history to consult either. `capture-pane -S -` on an alt-screen harness is a
  more expensive way to fetch the viewport. Anything that scrolled off is gone.

`pi` is the opposite, and the false positive is not hypothetical:

```
$ ... send-keys -t pi 'Reply with exactly this one line and nothing else: Working...'
 They're being very explicit - "exactly this one line and nothing else"
 I should just output that single word followed by ellipsis, with no other text, no explanation, no tools.
 Working...
'Working...' in visible while IDLE: 3
```

herdr's **entire** rule set for pi is one rule:

```toml
[[rules]]
id = "working_literal"
state = "working"
priority = 100
region = "whole_recent"
visible_working = true
contains = ["Working..."]
```

pi's real working indicator is `⠹ Working...` (present in 161 of 169 sampled frames during a
turn — long dwell, so 1 Hz polling catches it comfortably). But the rule matches the bare
substring over the whole recent buffer, so an idle pi session that merely *printed* those
characters — in its own answer, in its own reasoning trace, in a diff, in a log — reads as
working **forever**, because pi is not alt-screen and the text never scrolls out of the buffer
tmux keeps. Three occurrences on screen, session idle. pi has no idle rule and no blocker rule
at all, so this state is unrecoverable by any other rule.

`#{alternate_on}` is therefore a **per-harness property the adapter contract (#5) needs to
carry**: it decides whether history-scraping is safe, and whether scrollback poisoning is a
threat model.

### 5.2 Screen-scraping beat the title on the run that mattered

herdr's `live_turn_working` rule for claude, applied with its region faithfully reproduced
(`bottom_non_empty_lines(12)`), across every saved frame:

| | frames | alt1 `⏸⏵ … esc to interrupt` | alt2 `✻ Activity…` |
|---|---|---|---|
| run A, the 14 s false-idle window | 55 | **0** | **37** |
| run A, whole session | 246 | **0** | 181 |
| run B, whole session | 230 | **0** | 204 |

And the false-positive check — frames whose OSC title says idle (`✳`), i.e. ground-truth idle:

```
run B frames whose OSC title says IDLE (sparkle): 15
  of those, herdr live_turn_working alt2 matches:  0
```

Two things fall out.

**Screen scraping caught the working state the title lied about.** In the 14 s window where the
title reported `✳` throughout, the screen rule fired on 37 of 55 frames (67%), with matches like
`'✻ Manifesting…'` and `'· Blanching…'`. Zero false positives on genuinely idle frames. For
`working?` on Claude Code, the screen is *more* accurate than the title.

**One of the two working alternatives is already dead.** `'^\s*[⏸⏵].*esc to interrupt(?:\s|·|$)'`
matched **0 of 476 frames** across both sessions. Claude Code 2.1.241 never renders
`esc to interrupt` in the captured pane. Whatever that rule was written against, it is not this
build — and it is one of only two working alternatives in the highest-priority live-UI rule.

### 5.3 Width: a null result, and where the real fragility is

Capturing the same blocked `/model` picker at three widths and probing the substrings its rule
needs:

```
width=200 'select model'=1 'enter to set as default'=1 'esc to cancel'=1
width=60  'select model'=1 'enter to set as default'=1 'esc to cancel'=1
width=40  'select model'=1 'enter to set as default'=1 'esc to cancel'=1
```

`contains` rules are **not** width-fragile in the way expected: the TUI reflows around its own
separators, and each short phrase survives intact. Reported as a null result.

The layout *does* reflow, though — at 40 columns the footer becomes two lines:

```
   Enter to set as default · s to use
   this session only · Esc to cancel
```

which shifts every rule anchored by position rather than content:
`bottom_non_empty_lines(N)` with hand-tuned N, `last_non_empty_above_prompt_box`,
`after_last_horizontal_rule`, `prompt_box_body`. Those regions carry most of the catalog's
precision, and they are the part that moves.

### 5.4 The maintenance treadmill, from the catalog itself

The catalog was fetched live and compared against the copy embedded in the installed herdr
binary. 18 of 20 manifests are byte-identical; `claude` is not:

- embedded `2026.08.13.1` (12 rules) vs. remote `2026.08.21.1` (16 rules)

All four rules added in those eight days are working-detection —
`live_turn_working`, `background_shell_working`, `background_agents_working`,
`background_mcp_task_working`. **One harness needed four new working rules in eight days, and
the shipped binary was already stale on arrival.** That is the maintenance cost of the fallback
path stated in the incumbent's own release history rather than in the abstract.

The catalog documents its own fragility in comments:

```toml
# Braille covers <= 2.1.227; half-circles are the 2.1.228 busy spinner.
regex = ['^[\x{2800}-\x{28FF}\x{25D0}-\x{25D3}] ']
```

```toml
# Claude renders activity summaries at column zero; wrapped continuations are indented.
# Keeping that shape prevents user prompt text from impersonating this signal.
```

Coverage is also thinner than "17 harnesses supported" suggests. Rule counts per harness:
claude 16, grok 13, qwen 10, hermes 9, codex 8, devin 7, amp 6, kimi 6, cursor 5, kiro 5,
maki 5, droid 4, antigravity 3, opencode 3, qodercli 3, cline 2, gemini 2, copilot 2, kilo 2,
**pi 1**. Only 9 of 20 have any `idle` rule — **eleven harnesses, including cursor, droid,
opencode and pi, can never be positively detected as idle**; idle is the absence of evidence.
`opencode`'s working rule is `regex = ['(■|⬝){4,}']` over the whole buffer — four block
characters anywhere, which any progress bar or table border trips. `droid`'s entire working
detection is `contains = ["esc to stop"]`.

There is **no colour or SGR matcher** anywhere in the rule schema (14 fields:
`id`, `state`, `priority`, `region`, `visible_idle`, `visible_working`, `visible_blocker`,
`skip_state_update`, `contains`, `regex`, `line_regex`, `all`, `any`, `not`). A harness that
signals state purely by recolouring existing text is invisible to this approach. And only qwen's
manifest is localised — every other harness's `contains` rules are English-only, so a
non-English locale drops 19 of 20 manifests to their glyph rules, or to nothing.

## 6. Cost

`capture-pane` polling is affordable, confirming #3 (measured higher here — 5.25 ms vs 2.3 ms —
under a loaded machine, so treat this as the pessimistic figure):

```
capture-pane -p            : 5.25 ms/call
capture-pane -p -e -J -S - : 7.86 ms/call
display -p '#{pane_title}' : 5.34 ms/call
```

Almost all of that is process spawn — a long-lived control-mode client issuing `capture-pane`
over the existing connection avoids it. Twenty panes at 1 Hz is ~105 ms/s of CPU at the
pessimistic figure. Cost is not the constraint; accuracy is.

## 7. What this changes for the design

1. **`refresh-client -B` on `#{pane_title}` is worth keeping, but it is not the status
   channel.** It is a cheap 1 Hz *hint* — good enough to schedule a `capture-pane`, not good
   enough to write an event from. Normalise glyph→state before timestamping, or the event log
   fills with spinner alternation.
2. **Status detection for a no-channel harness is screen-scraping, and screen-scraping is
   per-harness rule maintenance.** There is no cheaper substrate underneath. Jackdaw must own
   region extraction (`bottom_non_empty_lines(N)`, prompt-box body, last horizontal rule) —
   that is where the precision lives, and it is more work than the regexes.
3. **`#{alternate_on}` belongs in the adapter contract.** It decides whether history is
   available, whether history-scraping is safe, and whether scrollback poisoning is a threat.
   The two harnesses tested sit on opposite sides of it.
4. **`pi` is second-class, and should be labelled so in the model.** No title signal, no
   approval concept (#2), one substring rule that its own output can poison indefinitely, and
   no way to distinguish blocked from idle. #11's **blind source** ranking — a source with no
   signal ranks 2nd, above every known-bad state — is exactly the right handling, and pi is its
   first real instance.
5. **A false-idle is the failure that costs.** A working agent that reads as finished gets
   escalated or handed new work. Both the title (§3.2) and the incumbent's dead
   `esc to interrupt` rule (§5.2) produced one. Detection should be biased so that the
   *absence* of positive idle evidence is not read as idle — which is precisely what herdr's
   `visible_idle` flag and its eleven idle-less manifests already concede.
6. **OSC 133 from `pi` is a real lead worth a ticket** — reachable via `pipe-pane` today,
   natively in tmux 3.8. Semantics unestablished.

## 8. Could not test

- **A genuine tool-permission prompt.** This machine's settings auto-approve Bash; four
  attempts produced no prompt. Blocked-state evidence rests on two other modals of the same
  visual shape.
- **Any harness other than `claude` and `pi`.** `cursor` — the other no-channel harness from
  #2 — is not installed here.
- **Real terminal focus.** No interactive terminal was attached; `#{alternate_on}` and title
  behaviour were observed through detached clients only.
- **tmux 3.8's OSC 133 hooks.** Unreleased.
- **The run-A false-idle's cause.** Two hypotheses refuted against saved frames; not explained.

## Appendix: reproduction

Scripts and every raw log are under the session scratchpad and are not committed. The rig is
three pieces and re-creatable in a few lines:

```bash
S=jackdaw-research-8
tmux -L $S new-session -d -s cc -x 200 -y 50 -c "$PROJ" 'claude'
tmux -L $S set -g exit-empty off
tmux -L $S pipe-pane -o -t cc "cat >> cc.raw"          # byte-level OSC

# 1 Hz push observer
mkfifo f; tmux -L $S -C attach -t cc -f no-output < f | ts > sub.log &
exec 9> f; printf 'refresh-client -B jdtitle:%%*:"#{pane_title}"\n' >&9

# 100 ms ground truth
while :; do
  printf '%s\t%s\n' "$(date +%s.%N)" "$(tmux -L $S display -p -t cc '#{pane_title}')"
  tmux -L $S capture-pane -p -t cc > "frame-$(date +%s.%N).txt"
  sleep 0.1
done
```

The private server was destroyed at the end of the session (`tmux -L jackdaw-research-8
kill-server`); the user's live fleet socket was never contacted.
