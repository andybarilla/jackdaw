# tmux capability audit — what the substrate gives, what Jackdaw must build

Research for [andybarilla/jackdaw#3](https://github.com/andybarilla/jackdaw/issues/3). Date: 2026-08-24.

**Question.** Can tmux deliver what herdr's pane/workspace model delivers, and where are the gaps?

**Sources.** `man tmux` from the tmux installed on `apbfw16` (3.7c), the upstream `CHANGES`
file (`https://raw.githubusercontent.com/tmux/tmux/master/CHANGES`, fetched 2026-08-24) for
version floors, `herdr api snapshot` for the model being replaced, and experiments run
against a private tmux server on this machine (`tmux -f /dev/null -L jdaudit`, never the
user's default socket — no tmux server was running on `/tmp/tmux-1000/default` at audit time).

**Headline.** tmux can carry the model, but the streaming design has to be inverted from the
obvious one. Control mode's `%output` firehose is the wrong stream to build on: it is raw
pre-render bytes and it can be *paused and dropped* under a slow reader. The right stream is
`refresh-client -B` format subscriptions (push, ≤1 Hz, per pane, arbitrary format) plus
`capture-pane` for rendered screen. Everything herdr calls durable state — names, roles,
worktree links, handoffs — must live outside tmux, because tmux pane ids reset to `%0` on
server restart and pane options die with the server.

---

## 0. Version floors

Established from `CHANGES`, not from the local man page (3.7c passes everything, so the man
page can only prove "3.7c has it").

| Capability | Minimum tmux | `CHANGES` evidence |
|---|---|---|
| Control mode (`-C`), `capture-pane -p`, `capture-pane -e` | **1.8** | "Control mode, which is a way for a client to send tmux commands" / "capture-pane learnt '-p' … and '-e'" (1.7→1.8) |
| `capture-pane -S -` (start of history) | **2.0** | "'capture-pane' understands '-S-'" (1.9a→2.0) |
| User options (`@foo`), `set -a` append | **2.3** | "'set -a' for appending to user options (@foo)" (2.2→2.3) |
| `#{pane_pipe}` | **2.6** | "Add a pane_pipe format to show if pipe-pane is active" (2.5→2.6) |
| `refresh-client -F` client flags | **3.1** | (3.0a→3.1) |
| **`refresh-client -B` format subscriptions / `%subscription-changed`** | **3.2** | "Add a way for control mode clients to subscribe to a format and be notified of changes rather than having to poll" (3.1c→3.2) |
| **`pause-after` / `%pause` / `%continue` / `%extended-output` / `refresh-client -A`** | **3.2** | "Add support for pausing a pane when the output buffered for a control mode client gets too far behind" (3.1c→3.2) |
| Control-mode output rate limiting (fairness) | **3.2** | "Instead of sending all data to control mode clients as fast as possible, add a limit of how much data will be sent" (3.1c→3.2) |
| `-f` client flags on `attach-session` / `new-session`; `client_flags` format | **3.2** | "Change the existing client flags for control mode to apply for any client" (3.1c→3.2) |
| Pane/window hooks became pane/window **options** (`set-hook -p`) | **3.2** | hook re-scoping list (3.1c→3.2) |
| `%client-detached` | **3.2** | "Add client-detached notification in control mode" (3.1c→3.2) |
| `%config-error`; `allow-passthrough all` | **3.4** | (3.3a→3.4) |
| `capture-pane -M` (copy-mode screen) | **3.6** | "Add -M flag to capture-pane to use the copy mode screen" (3.5a→3.6) |
| `#{pane_pipe_pid}` | **3.7** | "Add pane_pipe_pid with pipe file descriptor" (3.6b→3.7) |
| OSC 133 hooks (`pane-command-started`, `pane-command-finished`, `pane-shell-prompt`); `set-hook -B` monitor hooks; `wait-for -E` | **3.8 (unreleased)** | top of `CHANGES` |

**Practical floor for Jackdaw: tmux 3.2** (Feb 2021). Everything load-bearing — subscriptions,
pause semantics, client flags — landed together in 3.2. Below 3.2 the design does not work at
all and would fall back to polling.

**3.8 is worth watching, not waiting for.** Its OSC 133 hooks (`pane-command-started` /
`pane-command-finished` / `pane-shell-prompt`) would give real shell-level command boundaries
as events, which is strictly better than title scraping for the non-TUI case.

---

## 1. Reading pane output

### What was run

**Scrollback is lossy and small by default.** Emit 5000 lines into a pane with the default
`history-limit`:

```
$ tmux -f /dev/null -L jdaudit show-options -g history-limit
history-limit 2000

$ tmux ... send-keys -t %0 'for i in $(seq 1 5000); do echo "L$i"; done' Enter
$ tmux ... list-panes -a -F 'hist=#{history_size} limit=#{history_limit} bytes=#{history_bytes}'
hist=1978 limit=2000 bytes=280280

$ tmux ... capture-pane -p -S - -t %0 | head -3
L3000
L3001
L3002
```

Lines L1–L2999 are gone. `capture-pane` is a window onto a ring buffer, not a log.

**`capture-pane` gives the rendered screen; `pipe-pane` gives raw pre-render bytes.** A pane
running a repainting TUI:

```
$ tmux ... pipe-pane -o -t %0 'cat >> tui.out'
$ tmux ... send-keys -t %0 'for i in 1 2 3 4 5; do printf "\033[H\033[2JStatus: step %d of 5\n" $i; sleep 0.3; done' Enter

$ cat -v tui.out | tail -6
^[[?2004l^M^[[H^[[2JStatus: step 1 of 5^M
^[[H^[[2JStatus: step 2 of 5^M
^[[H^[[2JStatus: step 3 of 5^M
^[[H^[[2JStatus: step 4 of 5^M
^[[H^[[2JStatus: step 5 of 5^M

$ tmux ... capture-pane -p -t %0 | grep Status
Status: step 5 of 5
```

This is the single most consequential fact in the audit. Claude Code is a repainting TUI. Every
signal herdr derives from a pane — status glyph, spinner, prompt state — lives in the
*rendered screen*, and the only tmux API that produces a rendered screen is `capture-pane`,
which is **pull-only**. There is no push channel for rendered screen state.

**Escape handling in `capture-pane -e` is normalising, not byte-exact.** `printf "\033[31mRED\033[0m"`
comes back as `^[[31mRED^[[39m` — tmux re-emits its own SGR, it does not replay the source bytes.

**Line wrapping.** `capture-pane` splits a wrapped 200-char line into two 80-col rows; `-J`
rejoins it (verified: `-J` yields a single 200-char run). `-J` is mandatory for any content
extraction.

**`pipe-pane` properties.** Enumerable via `#{pane_pipe}` (0/1) and `#{pane_pipe_pid}` (3.7+).
It runs with no client attached. It **survives `respawn-pane -k`** — `pane_pipe_pid` was
unchanged and post-respawn output kept arriving in the same file. It does not survive a server
restart (nothing does).

### Control mode

A control client attached to session `A` (`tmux -C attach -t A`), driven through a fifo:

```
%begin 1787603214 303 0
%end 1787603214 303 0
%session-changed $0 A
%output %0 echo MARK_CURRENT_WINDOW\015\012\033[?2004l\015MARK_CURRENT_WINDOW\015\012
%output %1 echo MARK_OTHER_WINDOW\015\012\033[?2004l\015MARK_OTHER_WINDOW\015\012
%layout-change @0 c196,80x24,0,0[80x12,0,0,0,80x11,0,13,3] ... *
%output %3 \033[?2004h
%window-pane-changed @0 %3
%layout-change @0 b25d,80x24,0,0,0 b25d,80x24,0,0,0 *
%window-pane-changed @0 %0
%subscription-changed jdsub $0 @0 0 %0 : bash
%subscription-changed jdsub $0 @0 0 %0 : sleep
%window-renamed @0 sleep
%subscription-changed jdsub $0 @0 0 %0 : bash
%exit
```

Established:

- `%output` **does** arrive for panes in non-current windows (`%1`) of the attached session.
- `%output` does **not** arrive for panes in a *different session*. A marker echoed into
  session `B` never appeared in the stream (`grep -c MARK_SESSION_B` → 0), though
  `%sessions-changed` did fire. **Control mode is session-scoped**: one control client per
  session, or one session for everything.
- `%layout-change`, `%window-pane-changed` (active-pane change), `%window-renamed`,
  `%sessions-changed`, `%client-detached` all arrive. Topology and focus-within-session are
  genuinely event-driven.
- A control client counts as an attached client: `session_attached=1`, `client_flags=attached,focused,control-mode,...`.
  **`session_attached` is therefore not a human-presence signal once Jackdaw is running.**

### Control mode drops output under a slow reader — proven

With `-f pause-after=1` and a deliberately slow consumer (a `while read` loop with a 20 ms
sleep per line) flooding 100 000 lines:

```
--- pause/continue counts (slow reader) ---
1          # %pause
0          # %continue
--- max age seen ---
668        # ms of buffering before the pause
--- first %pause line ---
%pause %0
```

tmux emitted `%pause %0` and stopped sending that pane's output. `man tmux` says resuming is
`refresh-client -A %0:continue`; that command was issued in this run and **no `%continue` was
observed**, so the resume path is documented but not experiment-confirmed here. Under
`pause-after`, `%output` is replaced by
`%extended-output %0 <age-ms> : <data>` — the `age` field is the buffering delay and is
directly usable as a lag metric (observed 0–668 ms).

Without `pause-after` there is no `%pause`, but since 3.2 tmux still rate-limits and buffers
control-mode output in the server (`CHANGES`: "add a limit of how much data will be sent to
the client and try to use it for panes with some degree of fairness"). Choosing no
`pause-after` therefore trades *dropped output* for *unbounded server-side buffering* under a
sustained flood. Neither branch is "the stream is reliable".

### The stream that actually works: `refresh-client -B`

A control client with `-f no-output` (so `%output` never flows at all) plus format
subscriptions on all panes:

```
$ printf 'refresh-client -B jdtitle:%%*:"#{pane_title}"\n' >&9
$ printf 'refresh-client -B jdcwd:%%*:"#{pane_current_path}"\n' >&9
$ printf 'refresh-client -B jdcmd:%%*:"#{pane_current_command}"\n' >&9

%subscription-changed jdcmd   $0 @0 0 %0 : bash
%subscription-changed jdcwd   $0 @0 0 %0 : /home/andy/dev/andybarilla/jackdaw/...
%subscription-changed jdtitle $0 @0 0 %0 : * Working on issue 3
%subscription-changed jdtitle $0 @0 0 %0 : o Waiting for input
%subscription-changed jdcwd   $0 @0 0 %0 : /tmp
%subscription-changed jdtitle $0 @0 0 %0 : x Done
```

`%*` subscribes for every pane in the attached session. Because `no-output` suppresses
`%output` entirely, there is no backlog and therefore no `%pause` exposure.

**`%*` is dynamic, not a snapshot.** Subscribing first and *then* creating panes:

```
$ printf 'refresh-client -B jdtitle:%%*:"#{pane_title}"\n' >&9    # subscribe first
$ tmux ... split-window -t A -d 'bash --norc --noprofile'          # new pane, after
$ tmux ... new-window   -t A -d 'bash --norc --noprofile'          # new window, after

%subscription-changed jdtitle $0 @0 0 %0 : OLDPANE
%layout-change @0 c195,80x24,0,0[...] ... *
%subscription-changed jdtitle $0 @0 0 %1 : NEWPANE
%window-add @1
%subscription-changed jdtitle $0 @1 1 %2 : NEWWINDOWPANE
```

Panes and whole windows created after the subscription are covered automatically, and each new
pane fires an initial `%subscription-changed` with its current value. This matters: agents are
spawned into new panes constantly, and if `%*` had snapshotted the pane set, the stream manager
would have had to re-issue every `-B` on every `after-split-window`. It does not.

**The push channel is a 1 Hz sampler, not a true event stream.** `man tmux` states changes are
reported "at most once a second", and the observed cadence matches. A transition that happens
and reverts inside one second is invisible, and Jackdaw's event timestamps derived from
subscriptions carry up to ~1 s of skew. The map's "state transitions are timestamped events,
not a polled field" holds at the *interface* — the daemon publishes events — but the underlying
sampling is tmux's, at 1 Hz, and the daemon cannot do better without falling back to `%output`
(which is pausable) or to its own faster `capture-pane` poll. This is a requirement to write
down, not a defect to fix.

This matters more than it looks, because `#{pane_title}` is exactly the field herdr's status
detection reads. `herdr api snapshot` shows `terminal_title: "✳ PR merge workflow for IC
contributions"` with the Claude Code status glyph in it, and tmux picks the same OSC 2 title up:

```
$ tmux ... send-keys -t %0 'printf "\033]2;* Working on issue 3\007"' Enter
$ tmux ... display-message -p -t %0 'pane_title=[#{pane_title}]'
pane_title=[* Working on issue 3]
```

### Polling cost, measured

```
$ time ( for i in $(seq 1 50); do tmux ... capture-pane -p -t %0 > /dev/null; done )
real 0m0.113s
```

~2.3 ms per capture *including process spawn*. Polling 20 panes at 1 Hz costs ~46 ms of CPU
per second via the CLI, and far less through a persistent control-mode connection. **Polling
`capture-pane` is affordable.** The reason to prefer events is latency and change detection,
not cost.

### Gap list — output

**tmux gives this**
- Rendered-screen read via `capture-pane -p -e -J -S -`, cheap enough to poll.
- Raw pre-render byte stream via `pipe-pane`, client-independent, surviving `respawn-pane`.
- Push notifications for topology, active pane, window rename, session set.
- Push notifications for **any format**, per pane, ≤1 Hz, via `refresh-client -B` — including
  `pane_title`, `pane_current_command`, `pane_current_path`.
- Explicit backpressure signalling (`%pause` / `%extended-output` age) if you opt into it.

**Jackdaw must build this**
- **A durable transcript.** `history-limit` 2000 loses 3000 of 5000 lines. Jackdaw must set a
  large `history-limit` *and* own an append-only per-pane log, fed by `pipe-pane` at pane
  creation, with its own rotation. herdr's `pane_output_changed` + `revision` implies a
  monotonically versioned buffer; tmux has no revision counter.
- **A VT parser**, if it consumes `pipe-pane` or `%output`. Both are raw repaint streams. Any
  "what does this pane say right now" answer derived from them requires emulating a terminal.
  The cheap alternative — and the recommendation — is to treat the byte stream purely as a
  *change signal* and read state with `capture-pane`.
- **A resync path.** Whatever it subscribes to, the daemon must be able to say "I may have
  missed bytes" and re-establish truth from `capture-pane`. With `pause-after` this is
  mandatory (`%pause` is an explicit data-loss notification); without it, it is still needed
  after a control-client reconnect.
- **`pane.wait_for_output` / `agent wait`.** No tmux equivalent. `wait-for` is an unrelated
  named-channel primitive, not an output matcher. Jackdaw builds pattern-matching-with-timeout
  on top of its own stream.
- **One control client per session**, with lifecycle management: reconnect on `%exit` and
  re-establish the `-B` subscriptions, which are per-client and not persisted anywhere. New
  panes need no re-subscription (`%*` is dynamic), but a *new session* does need a new client.
- **A cross-session view.** Nothing in tmux gives one stream over all sessions.

**Recommended architecture.** One control-mode client per session with `-f no-output`;
`refresh-client -B` subscriptions for `pane_title`, `pane_current_command`, `pane_current_path`
and any `@jackdaw_*` option; `%layout-change` / `%window-pane-changed` / `%sessions-changed`
for topology; `pipe-pane` into a Jackdaw-owned log for the durable transcript; `capture-pane`
on demand for rendered screen. This never touches `%output` and therefore never risks `%pause`.

---

## 2. Focus and process

### Focus

```
$ tmux ... list-clients -F 'name=#{client_name} flags=#{client_flags} session=#{client_session} readonly=#{client_readonly} control=#{client_control_mode}'
name=/dev/pts/19 flags=attached,focused,UTF-8 session=A activity=... readonly=0 control=0

$ tmux ... list-panes -a -F 'pane=#{pane_id} active=#{pane_active} winactive=#{window_active} sessattached=#{session_attached}'
pane=%1 active=1 winactive=1 sessattached=1
pane=%2 active=0 winactive=1 sessattached=1
```

herdr's `focused` is one boolean per pane. tmux has no such field. The nearest equivalent is a
conjunction that must be computed:

`focused(pane) = pane_active AND window_active AND (some non-control client is attached to
this session AND that client is on this window) AND client_flags contains "focused"`

Three problems with it:

1. **`session_attached` is polluted by Jackdaw itself.** The control client counts as attached
   (`flags=attached,focused,control-mode`). Jackdaw must exclude clients where
   `#{client_control_mode}` is 1.
2. **The `focused` client flag is not trustworthy as OS-window focus.** A client attached
   through `script(1)` — with no terminal capable of focus reporting at all — still reported
   `flags=attached,focused`. Real focus tracking needs `focus-events on` *and* an outer
   terminal that supports focus reporting (`focus` terminal feature per `man tmux`), which
   propagates as `client-focus-in` / `client-focus-out` hooks. **Not verified end-to-end** —
   there was no interactive terminal available in this session.
3. **Multiple clients.** With two clients on one session, "the focused pane" is genuinely
   ambiguous; `active-pane` client flag makes it more so by letting a client have its own
   active pane.

This makes the corrupted-line hazard *worse* under tmux than under herdr, not equal. The
`supervisor.md` HARD-GATE ("Judge occupancy from `focused` alone") is currently resting on a
field herdr computes and tmux does not.

### Foreground process and cwd

```
pane=%0 cmd=bash path=/home/andy/dev/.../worktrees/agent-... pid=4141330 tty=/dev/pts/5
# after: cd /etc && sleep 20
pane_current_command=sleep
pane_current_path=/etc
tpgid now=4141387  cwd(tpgid)=/etc comm=sleep
```

tmux already resolves the tty foreground process group internally. `#{pane_current_command}`
and `#{pane_current_path}` track the *foreground* process, and match a procfs walk
(`/proc/<pane_pid>/stat` field 8 → `tpgid`, then `/proc/<tpgid>/cwd`). So:

- herdr `foreground_cwd` → `#{pane_current_path}`. Direct.
- herdr `cwd` (the pane's own shell) → `readlink /proc/#{pane_pid}/cwd`. Needs procfs, so it is
  Linux-specific; on macOS this needs `lsof`/`proc_pidinfo` instead.

Both are subscribable via `refresh-client -B`, so these are push, not poll.

### Gap list — focus and process

**tmux gives this**
- `#{pane_active}`, `#{window_active}`, `#{session_attached}`, `#{client_flags}`,
  `#{client_session}`, `#{client_activity}`, `#{client_readonly}`, `#{client_control_mode}`.
- `#{pane_current_command}` and `#{pane_current_path}` resolved to the foreground process.
- `client-focus-in` / `client-focus-out` / `pane-focus-in` / `pane-focus-out` hooks when
  `focus-events` is on and the outer terminal supports it.
- Push notification of all of the above via `-B` subscriptions and `%window-pane-changed`.

**Jackdaw must build this**
- A single `focused` predicate, defined and documented, excluding its own control clients, and
  a stated answer for the multi-client case. This is a spec decision, not a lookup.
- A real-focus signal: enable `focus-events`, subscribe to the client-focus hooks, and treat
  "no focus-capable terminal" as a distinct third state rather than folding it into
  focused/unfocused. The `supervisor.md` gate needs to know the difference between "no human
  here" and "cannot tell".
- Per-machine implementations of pane-shell `cwd` (procfs on Linux, something else on macOS).

---

## 3. Per-pane durable metadata

```
$ tmux ... set-option -p -t %0 @jackdaw_role 'lead-jackdaw'
$ tmux ... set-option -p -t %0 @jackdaw_issue '3'
$ tmux ... show-options -p -t %0
@jackdaw_issue 3
@jackdaw_role lead-jackdaw

$ tmux ... display-message -p -t %0 '#{@jackdaw_role} / #{@jackdaw_issue} / #{@does_not_exist}|'
lead-jackdaw / 3 / |

$ tmux ... list-panes -a -F '#{pane_id} role=#{@jackdaw_role}'
%0 role=lead-jackdaw
```

They work, they enumerate (`show-options -p`), they expand in formats, and they are queryable
across all panes in one `list-panes -a`. They survive the pane's program being replaced:

```
$ tmux ... respawn-pane -k -t %0 'bash --norc --noprofile'
after respawn-pane, %0 role=[lead-jackdaw]
```

A new pane inherits nothing (`%1 role=[]`). An unset key expands to the empty string — there
is no way to distinguish unset from empty.

### They do not survive a server restart, and neither do pane ids

```
before kill-server:
%0 @0 $0
%1 @0 $0

$ tmux -f /dev/null -L jdaudit kill-server
$ tmux -f /dev/null -L jdaudit new-session -d -s A2 ...

after kill-server + new server:
%0 @0 $0
user option after restart: []
```

Pane ids restart at `%0`, window ids at `@0`, session ids at `$0`. **`%0` after a restart is a
different pane from `%0` before it, and nothing in tmux says so.** This settles the ticket's
question outright.

Compare herdr, whose pane ids are workspace-scoped and human-meaningful (`w6X:p1`, `w8H:p1`)
and which carries `revision` and `state_change_seq` per pane.

### Gap list — metadata

**tmux gives this**
- Arbitrary string key/value per pane (`set -p @k v`), enumerable, format-expandable,
  subscribable (`refresh-client -B` on `#{@k}` pushes changes), surviving `respawn-pane`.

**Jackdaw must build this**
- **An external durable store, authoritative.** tmux user options are a *cache and a
  cross-reference*, not the record. Roles, agent names, worktree links, handoffs, interventions
  all live in Jackdaw's own store.
- **A stable identity that is not the tmux pane id.** Mint a Jackdaw pane UUID, write it into
  `@jackdaw_id` at pane creation, and key the external store by it. On daemon start,
  re-enumerate panes and rebuild the `%N` → UUID map from `@jackdaw_id`.
- **An explicit "the server restarted" transition.** `#{pid}` (tmux server pid) and
  `#{socket_path}` are available; a change in `#{pid}` means every `%N` in the store is stale
  and every pane is a new pane. Without this the daemon will happily attach `lead-alare`'s
  identity to whatever `%0` happens to be after a restart.
- A convention for unset-vs-empty, since tmux collapses them.

---

## 4. Server ownership

```
$ tmux ... display-message -p '#{socket_path}  pid=#{pid}  version=#{version}'
/tmp/tmux-1000/jdaudit  pid=4149345  version=3.7c

$ ls -la /tmp/tmux-1000/
drwx------  andy andy  .
srw-rw----  andy andy  jdaudit

$ tmux ... show-options -g exit-empty
exit-empty on
$ tmux ... show-options -g destroy-unattached
destroy-unattached off

$ tmux ... kill-session -t A
$ tmux ... list-sessions
no server running on /tmp/tmux-1000/jdaudit
```

- **`exit-empty` defaults to on.** Killing the last session kills the whole server, taking
  every pane option, every hook, and the pane-id space with it. A Jackdaw-owned server must
  either set `exit-empty off` or keep a keepalive session — otherwise the fleet dies the moment
  the last agent exits.
- `destroy-unattached off` by default, so detaching is safe: sessions and panes persist with no
  clients. Verified throughout — every experiment above ran with zero attached clients.
- The socket file is left behind after the server exits (a stale `srw-rw----` entry remains),
  so socket-file existence is not a liveness test.
- `/tmp` here is **tmpfs** (`findmnt -no FSTYPE /tmp` → `tmpfs`). The socket directory does not
  survive a reboot, and neither does the server, which is a process. `TMUX_TMPDIR` is unset.

**Recommendation: Jackdaw runs its own server on `-L jackdaw`.** Reasons, all grounded above:

1. Global state is genuinely global. `set-hook -g`, `history-limit`, `exit-empty`,
   `focus-events`, `allow-passthrough` are server- or global-option scoped. Setting them on the
   user's server changes the user's tmux, and `supervisor.md`'s whole posture is "do not
   disturb the human".
2. The user's server dies when the user kills it. A shared server means "the user ran
   `kill-server`" and "the fleet died" are the same event.
3. Pane-id collisions. On a shared server, the human's panes occupy the same `%N` space, and
   Jackdaw would have to filter every enumeration.
4. `tmux attach` is still the handoff surface — `tmux -L jackdaw attach -t <session>` costs the
   human one flag, and can be wrapped by the Jackdaw CLI.

The cost is that the human's own tmux sessions are invisible to Jackdaw. Given the map already
scopes Jackdaw to supervising *agent* panes, that is the correct trade.

### Gap list — server ownership

**tmux gives this**
- Independent named servers (`-L`), persistence across detach, and `attach` UX for free.

**Jackdaw must build this**
- Server lifecycle: start-if-absent on daemon start (`new-session -d` with `exit-empty off`
  applied immediately), health check by `#{pid}` rather than socket existence, and a
  server-restart detection path (see §3).
- **Reboot recovery.** Nothing tmux-side survives a reboot. Jackdaw's store must be able to
  reconstruct the fleet — sessions, panes, cwds, roles, which agent was on which issue — and
  either respawn it or present it as "these efforts were running when the machine went down".
  This is a first-class daemon requirement, not a nicety; it is the thing that makes Jackdaw a
  supervision *plane* rather than a tmux wrapper.
- A `kill-pane` / user-closed-pane reconciliation path: `pane-exited` fires (see §6), and
  Jackdaw must decide restart-vs-record. herdr's `pane_exited` / `pane_closed` distinction maps
  onto tmux's `pane-died` (with `remain-on-exit`) vs `pane-exited`.
- Cross-machine: **tmux appears to be absent on `apbmbp`.** `ssh apbmbp 'zsh -lc "tmux -V"'`
  → `command not found` (login PATH, per `supervisor.md`'s PATH gate), and
  `ls -l /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux` → no such file for all
  three. `brew list --versions tmux` could not run because `brew` itself is not on the SSH
  PATH, so the Homebrew inventory was not queried and this is not a conclusive negative.
  Treat it as: tmux is not on that machine's login PATH or in any standard location, so
  migrating TalosTitle onto Jackdaw almost certainly requires installing and version-pinning
  tmux there first, and the 3.2 floor is unverified on that machine either way.

---

## 5. Safe input

### The hazard reproduces exactly

```
$ tmux ... send-keys -t %0 -l 'restart the session'   # 'human' types, no Enter
$ tmux ... send-keys -t %0 '/exit' Enter              # 'daemon' writes

$ tmux ... capture-pane -p -t %0 | grep restart
bash-5.3$ restart the session/exit
bash: restart: command not found
```

This is verbatim the corruption `supervisor.md` documents. tmux offers **no interlock**.
`send-keys` writes into the pane's pty; a human's keystrokes arrive through the same pty from
a client. Nothing arbitrates.

What tmux does offer, and what each is actually good for:

| Mechanism | Verified | What it does | What it does *not* do |
|---|---|---|---|
| `send-keys -l` | yes | Literal text, no key-name interpretation | Nothing about concurrency |
| `send-keys -H 41 42 43` | yes (`ABC` appeared) | Hex byte input | Nothing about concurrency |
| `paste-buffer -p` | partially — command accepted, bracketed markers not separately confirmed | Wraps the paste in bracketed-paste markers so a bracketed-paste-aware reader treats it as one atomic paste rather than typed keys | Does not stop interleaving; and only helps if the pane program honours bracketed paste |
| `attach -r` / `-f read-only` | yes — `flags=attached,ignore-size,read-only`, `client_readonly=1` | Makes a *client* read-only; only detach/switch keys work | Does **not** make a pane read-only, and does not block `send-keys` from the daemon |
| `#{pane_in_mode}` / `#{pane_mode}` | yes — `in_mode=1 mode=copy-mode` | Detects copy mode; input would go to the mode, not the program | Says nothing about half-typed input at a shell prompt |
| `wait-for -L` / `-U` | yes — second locker blocked until `-U` | A real server-side named mutex | Only interlocks tmux *commands*; a human at the keyboard never takes the lock |

`wait-for -L jd:write:<pane>` is a genuinely useful primitive for serialising *Jackdaw's own*
writers (daemon vs `jackdaw agent prompt` from a role file vs a second machine over the mesh) —
worth adopting — but it does not solve the human case.

### Gap list — safe input

**tmux gives this**
- Literal and hex input, bracketed paste, copy-mode detection, read-only clients for humans,
  and a server-side lock channel for serialising its own writers.

**Jackdaw must build this**
- **A write lease per pane**, held in Jackdaw's store, keyed by the Jackdaw pane id, taken
  before any `send-keys` and enforced for every Jackdaw writer including remote ones.
- **An occupancy predicate** for the human case, since no lock can cover it. The honest inputs
  are: the `focused` conjunction from §2, `client-focus-in`/`-out` hooks, `#{client_activity}`
  (time of last client activity — a proxy for "someone typed recently"), and `#{pane_in_mode}`.
  `client_activity` is the one signal tmux has that herdr's `focused` does not, and an
  activity-recency window is probably a better gate than focus alone.
- **A safe-write protocol** rather than a bare `send-keys`. The minimum that survives the
  reproduction above: send a `C-u` (kill-line) before the payload where the target program's
  line discipline allows it, or drive input as a bracketed paste, and read the pane back after
  writing to confirm what landed. `supervisor.md` already has a "read the pane back and confirm
  the prompt text appears" gate for the remote case; under tmux that becomes universal.
- A policy for panes Jackdaw did not create. On a Jackdaw-owned server (§4) this is nearly
  empty, which is another argument for the private server.

---

## 6. Hooks

```
$ tmux ... set-hook -g pane-exited "run-shell -b '<script> pane-exited hook=#{hook} hook_pane=#{hook_pane} hook_window=#{hook_window} hook_session=#{hook_session} pane_id=#{pane_id}'"
...
$ cat hooks2.log
after-split-window pane_id=%1 hook_pane=
pane-exited hook=pane-exited hook_pane=%1 hook_window=@0 hook_session= pane_id=%0
window-linked hook_window=@1
client-attached hook_client=/dev/pts/18
client-detached hook_client=/dev/pts/18
```

- Hooks fire, and `run-shell -b '<cmd>'` is a cheap, backgrounded external notify path — good
  enough to poke a unix socket or write a fifo.
- `show-hooks -g` enumerates them, including which are set. Hooks are options, so since 3.2
  they can be scoped per pane (`set-hook -p`) and per window as well as globally.
- **Hook context is inconsistent.** `#{hook_pane}` was populated for `pane-exited` (`%1`) but
  *empty* for `after-split-window`, where the new pane is `#{pane_id}` instead. `#{hook_session}`
  was empty in both. Jackdaw cannot use one uniform payload template; each hook needs its
  context established individually.
- `after-*` command hooks exist for essentially every command (`show-hooks -g` lists
  `after-bind-key`, `after-capture-pane`, `after-kill-pane`, …), which gives a broad audit
  surface.
- `alert-activity` did not fire in the run above. It is gated on `monitor-activity` and on
  there being a client to alert; the exact condition was **not established**.
- `session-closed` did not fire on `kill-session` — the server exited first because
  `exit-empty` is on (§4). Another argument for `exit-empty off`.

**There is no output hook.** `grep -c 'pane-output\|output-changed'` over `man tmux` → 0.
Nothing fires when a pane produces output. This is precisely why §1 carries the entire
streaming design, and why `refresh-client -B` on `#{pane_title}` matters so much: it is the
only push signal that tracks what an agent is *doing*.

tmux 3.8 changes this materially — `pane-command-started`, `pane-command-finished` and
`pane-shell-prompt` fire from OSC 133 — but only for programs that emit OSC 133, and 3.8 is
unreleased.

### Gap list — hooks

**tmux gives this**
- Lifecycle events for panes (`pane-exited`, `pane-died`, `pane-focus-in/out`,
  `pane-mode-changed`), windows (`window-linked`, `window-renamed`, `window-layout-changed`,
  `window-pane-changed`), clients (`client-attached`, `client-detached`, `client-focus-in/out`,
  `client-resized`, `client-session-changed`) and sessions, plus `after-<command>` hooks for
  every command.
- A cheap external notify path (`run-shell -b`).
- Global, per-session, per-window and per-pane scoping.

**Jackdaw must build this**
- Per-hook context templates, since `#{hook_pane}` / `#{hook_session}` are not uniformly
  populated.
- Hook installation and repair as part of daemon startup — hooks live in the server and die
  with it.
- **All output-derived signal.** No hook exists for output; agent status detection is entirely
  Jackdaw's problem, fed by `-B` title subscriptions plus `capture-pane`.
- Deduplication between the hook path and the control-mode notification path — `man tmux`
  states that every control-mode notification is also a hook, so the same event can arrive
  twice if both are wired.

---

## 7. Capability map, herdr → tmux

| herdr | tmux | Verdict |
|---|---|---|
| `pane.cwd` | `readlink /proc/#{pane_pid}/cwd` | Build; platform-specific |
| `pane.foreground_cwd` | `#{pane_current_path}` | Free |
| `pane.focused` | conjunction of `pane_active` + `window_active` + non-control client + client focus | Build; weaker than herdr |
| `pane` metadata / agent authority | `set -p @k v` + external store | Partly free; store is Jackdaw's |
| `pane_id` stability | `%N`, resets on server restart | **Build** — Jackdaw pane UUID required |
| `agent_status` | nothing; `#{pane_title}` via `-B` is the raw signal | **Build** — all of it |
| `pane.wait_for_output` / `agent wait` | nothing | **Build** |
| `events.subscribe` | control mode + `refresh-client -B` | Mostly free, session-scoped, needs a resync path |
| `pane_output_changed` + `revision` | `%output` (raw, pausable); no revision counter | Build the revision |
| workspaces | sessions | Free |
| tabs | windows | Free |
| layout export/apply, split ratios | `#{window_layout}` string, `select-layout`, `split-window -l`/`-p`, `resize-pane` | Free |
| `pane split` | `split-window` | Free |
| worktree create/open/remove tied to panes | nothing | **Build** — git plumbing plus the pane↔worktree link in Jackdaw's store |
| `agent read` | `capture-pane -p -e -J -S -` | Free (bounded by `history-limit`) |
| `agent start` / `prompt` / `rename` | `new-window`/`split-window`, `send-keys`, `select-pane -T` / `@jackdaw_name` | Build the semantics; primitives are free |
| `focused`-gated safe write | nothing | **Build** — lease + occupancy + read-back |
| durable transcript | `pipe-pane` (raw) | Build the log and the parser/policy |

---

## 8. Sizing note

The gaps cluster into five components, and none of them is small:

1. **Identity and store.** Jackdaw pane UUIDs, the `@jackdaw_id` cross-reference, server-restart
   detection, reboot reconstruction. Unavoidable — it is what the pane-id experiment proves.
2. **Stream manager.** One control client per session, `no-output` + `-B` subscriptions, reconnect
   and re-subscribe, resync from `capture-pane`, hook installation and repair.
3. **Transcript.** `pipe-pane` into a Jackdaw log, rotation, and the decision about whether
   anything ever parses the VT stream or whether `capture-pane` is the only reader.
4. **Status detection.** Title-glyph interpretation and whatever harness-native signals exist.
   Entirely Jackdaw's, exactly as the map anticipates.
5. **Safe input.** Lease, occupancy predicate, safe-write protocol with read-back.

Item 1 is the one that would be easy to under-scope, because tmux's user options look like they
solve it right up until `kill-server`.

---

## What could not be verified

- **Whether Claude Code's status title reaches `#{pane_title}` under tmux. This is the largest
  single risk in the document.** What was proven is that tmux carries an OSC 2 title into
  `#{pane_title}` (§1), and that Claude Code emits status-glyph titles — but the glyph evidence
  (`✳ PR merge workflow…`) comes from `herdr api snapshot`, i.e. herdr's own PTY, not from a
  Claude Code running inside a tmux pane. No agent was launched under tmux in this audit.
  Consequence if it does not hold: the `-B` title subscription carries nothing useful, the
  recommended push architecture loses its status signal, and status detection falls back to
  polling `capture-pane` and parsing the rendered screen. That changes the *size* of sizing-note
  item 4, not just its implementation, so it should be the first thing tested before the daemon
  is specified.
- **Real terminal focus.** No interactive terminal was available. Whether `focus-events on` plus
  `client-focus-in`/`client-focus-out` gives a trustworthy human-presence signal on the user's
  actual terminal (WezTerm, judging by the `WEZTERM_*` user vars seen in the `pipe-pane`
  capture) is untested. The `focused` client flag appeared even for a `script(1)` pty with no
  focus reporting, so it is not a substitute.
- **`paste-buffer -p` bracketed markers.** The command was accepted; the `ESC[200~` / `ESC[201~`
  wrapping was not separately confirmed on the wire.
- **`alert-activity` firing conditions.** It did not fire with `monitor-activity on` and no
  attached client. The exact gating was not established.
- **Unbounded-buffering behaviour without `pause-after`.** `CHANGES` says output is rate-limited
  and buffered per pane since 3.2; the actual memory ceiling under a sustained flood was not
  measured. The audit avoids the question by recommending `no-output`.
- **Reboot survival.** Inferred, not tested — `/tmp` is tmpfs and the server is a process, so
  nothing survives. No reboot was performed.
- **`apbmbp` (macOS).** tmux is not installed there. Every version-floor and every procfs-based
  technique in this document is unverified on that machine, and `#{pane_pid}` → `/proc` does not
  exist on macOS at all.
- **Behaviour under the user's real `~/.config/tmux/tmux.conf`.** All experiments used
  `-f /dev/null`. That config sets at least `base-index 1` (observed when it was loaded) and
  will change other defaults. On a Jackdaw-owned server this is moot, since Jackdaw should
  start it with its own config file.
