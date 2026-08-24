# Harness lifecycle signals: native events or screen-scraping?

Research for [#2](https://github.com/andybarilla/jackdaw/issues/2), under map [#1](https://github.com/andybarilla/jackdaw/issues/1).
Date: 2026-08-24. Verified on Andy's Linux workstation (CachyOS).

## Verdict

**"Native signals first, scraping as fallback" is a real cross-harness strategy, but not a uniform one.** It is not Claude-Code-only. It also does not generalise to all eight harnesses. The honest shape is three tiers:

- **Tier 1 — full native lifecycle including approval-blocking, in the interactive TUI.** `claude`, `codex`. Both ship an in-process hook engine that fires on session start/end, prompt submit, tool use, and — critically — *permission request*. A supervisor can learn all five states without reading a single rendered cell.
- **Tier 2 — native lifecycle events, but no native approval-blocking signal.** `pi`, `opencode`. Both emit rich structured events in interactive mode (pi via TypeScript extensions, opencode via a persisted event log and plugin hooks). Neither exposes a *built-in* approval-prompt event that a supervisor can subscribe to; pi's own docs frame permission gates as something an extension implements, and Jackdaw's own archive already recorded pi approval control as unavailable. `awaiting input` is inferable from settle/idle events; `blocked on approval` is not.
- **Tier 3 — unverified.** `droid`, `qwen`, `cursor`, `hermes`. See [Unverified](#unverified) — this is a finding, not a gap filled with guesses.

The load-bearing consequence for the adapter contract: **the adapter interface must be able to report partial state coverage.** A harness adapter cannot be a flat `getState() -> State`; it must declare *which transitions it can observe natively* and let the supervisor fall back per-transition. An adapter that natively sees start/working/finished but not blocked-on-approval is the common case, not the exception.

The second consequence: **session artifacts on disk are the genuinely cross-harness layer** — and issue #1 already bet on this correctly. Every harness verified here writes a durable, machine-readable session record (JSONL for claude/codex/pi, SQLite for opencode). That is the harness-agnostic substrate. Lifecycle *events* are not.

## Method and trust

- Locally installed and directly inspected: `claude` 2.1.241, `codex-cli` 0.147.0, `pi` 0.84.1.
- On disk but binary removed: `opencode` (real session database from Jun–Jul 2026 inspected read-only).
- Not installed, no first-party artifact on this machine: `droid`, `qwen`, `cursor`, `hermes`.
- `herdr integration list` was used only as a *pointer* to which harnesses plausibly expose extension points. Nothing in this document rests on herdr's manifests.

Two distinctions are enforced throughout, because collapsing either would flatter the cross-harness story:

1. **Interactive TUI vs headless.** Jackdaw supervises live interactive panes under tmux. A harness that only streams JSON in `--print`/`exec` mode gives Jackdaw *nothing* for a live pane. Both are recorded, separately.
2. **"Has hooks" vs "covers the blocking transition."** Nearly anything with a hook system can signal session-start and turn-end. The transition that decides whether scraping can be retired is *blocked on approval*.

## Per-harness table

Interactive column = signals available while the harness runs its normal TUI in a tmux pane.

| Harness | Native lifecycle mechanism (interactive) | Headless structured output | started | working | awaiting input | blocked on approval | finished | Session artifacts on disk | TTY |
|---|---|---|---|---|---|---|---|---|---|
| **claude** (Claude Code 2.1.241) | Hook engine, 12 events incl. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `SessionEnd` | `-p/--print --output-format stream-json` (print-only) | yes | yes | yes (`Notification`) | **yes** (`PermissionRequest`) | yes (`Stop`, `SessionEnd`) | `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` | real TTY; satisfied by tmux |
| **codex** (codex-cli 0.147.0) | Hook engine via `hooks.json`, 10 events: `session_start`, `session_end`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `permission_request`, `pre_compact`, `post_compact`, `subagent_start`, `subagent_stop`. Plus `notify` external program (`agent-turn-complete`) | `codex exec --json` (JSONL, exec-only); `codex app-server` / `mcp-server` / `exec-server` are separate non-TUI modes | yes | yes | yes (`notify` turn-complete) | **yes** (`permission_request`) | yes (`session_end`, `notify`) | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`; index at `~/.codex/session_index.jsonl` | TUI refuses to start without a TTY; satisfied by tmux |
| **pi** (0.84.1) | TypeScript extension events in-TUI: `session_start`, `before_agent_start`, `agent_start`, `turn_start`/`turn_end`, `message_*`, `tool_execution_start/update/end`, `tool_call`, `tool_result`, `agent_end`, `agent_settled`, `input`, `session_shutdown` | `--mode json`, `--mode rpc` (JSONL over stdio; replaces the TUI), `--print` | yes | yes | yes (`agent_settled`) | **no built-in signal** | yes (`agent_settled`, `session_shutdown`) | `~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<ts>_<uuid>.jsonl` | TUI; satisfied by tmux (pi ships tmux setup docs) |
| **opencode** | Persisted event log + plugin hooks (see caveat) | HTTP/SSE server mode | yes (`session.created`) | yes (`session.next.step.started`, `tool.called`) | partial (`step.ended`) | **not observed** | yes (`session.next.step.ended`) | SQLite `~/.local/share/opencode/opencode.db`, event-sourced tables `event`/`event_sequence`/`session`/`session_message`/`part` | TUI; not re-verified (binary absent) |
| **droid** | unverified | unverified | ? | ? | ? | ? | ? | unverified | unverified |
| **qwen** | unverified | unverified | ? | ? | ? | ? | ? | unverified | unverified |
| **cursor** | unverified | unverified | ? | ? | ? | ? | ? | unverified | unverified |
| **hermes** | unverified | unverified | ? | ? | ? | ? | ? | unverified | unverified |

## Evidence

### claude (Claude Code 2.1.241)

Hook event names, extracted from the shipped binary at `~/.local/share/claude/versions/2.1.241`:

```
Notification, PermissionRequest, PostCompact, PostToolUse, PreCompact, PreToolUse,
SessionEnd, SessionStart, Stop, SubagentStart, SubagentStop, UserPromptSubmit
```

Hooks are configured in `~/.claude/settings.json` under a `hooks` key and fire in the interactive TUI — verified live: this machine has a `SessionStart` hook installed and the process is running interactively.

Structured output is **print-mode only**. `claude --help` repeatedly qualifies it:

```
--output-format <format>   Output format (only works with --print):
                           (only works with --print and --output-format=stream-json)
```

So `stream-json` is not a supervision channel for a live pane; hooks are.

Transcripts: `~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl`, one JSON object per line, e.g.

```json
{"type":"permission-mode","permissionMode":"auto","sessionId":"64bb5609-..."}
```

The `PermissionRequest` hook is what makes claude Tier 1: a supervisor learns "this pane is blocked waiting for a human" from an event, not from matching a prompt box on screen.

### codex (codex-cli 0.147.0)

Hook system is real and first-party. From the binary's own strings, the registered event names and the config file:

```
pre_tool_use permission_request post_tool_use pre_compact post_compact
session_start session_end user_prompt_submit subagent_start subagent_stop
...
hooks.json
```

The binary also carries a wire schema (`PermissionRequestHookSpecificOutputWire`, `PreToolUseHookSpecificOutputWire`, `SessionStartHookSpecificOutputWire`, …) and enforcement messages such as `PermissionRequest hook denied approval` and `Command blocked by PreToolUse hook`. Hooks are trust-gated — `codex exec --dangerously-bypass-hook-trust` exists precisely to skip "persisted hook trust", which confirms hooks run by default subject to trust.

Separately, codex has a `notify` config key invoking an external program with a JSON payload of type `agent-turn-complete` carrying `thread-id`, `turn-id`, `cwd`, `input-messages`, `last-assistant-message`. That is a clean turn-finished signal independent of hooks.

Headless JSON is `codex exec --json` → "Print events to stdout as JSONL". Again exec-only. Codex additionally exposes `app-server` (JSON-RPC), `mcp-server` (stdio), `exec-server`, and a TUI `--remote <ws://|unix://>` flag that connects the TUI to a remote app server — an interesting future path, but it requires launching codex in that topology rather than as a plain pane.

Rollout files are real and plentiful (829 on this machine):

```
~/.codex/sessions/2026/08/23/rollout-2026-08-23T16-21-34-01a030b7-...jsonl
```

Line types observed in one file: `session_meta`, `turn_context`, `world_state`, `event_msg`, `response_item`. `session_meta` carries `session_id`, `cwd`, `originator`, `cli_version`, `source`, `model_provider`.

TTY: the binary refuses the TUI without one —

```
TERM is set to "dumb". Refusing to start the interactive TUI because no terminal is
available for a confirmation prompt (stdin/stderr is not a TTY).
```

### pi (0.84.1)

pi ships its own docs inside the npm package (`@earendil-works/pi-coding-agent/docs/`), which is a first-party primary source.

`docs/extensions.md` documents the in-TUI lifecycle explicitly, including a diagram: `project_trust` → `session_start` → `input` → `before_agent_start` → `agent_start` → (`turn_start` → `tool_execution_start` → `tool_call` → `tool_execution_end` → `turn_end`)* → `agent_end` → `agent_settled`, and `session_shutdown` on exit.

`agent_settled` is documented for exactly Jackdaw's use case:

> `agent_end` fires when that run ends, but Pi may still auto-retry, auto-compact and retry, or continue with queued follow-up messages. **Use `agent_settled` for status integrations** that need to know Pi will not continue running automatically.

That is a documented, native "finished / awaiting input" signal in the interactive TUI. Good.

What pi does **not** have is a built-in approval gate to observe. The docs list "Permission gates (confirm before `rm -rf`, `sudo`, etc.)" as an *example of something an extension can build* using `tool_call` (which "can block") plus `ctx.ui.confirm()`. There is no `permission_request`-equivalent event. Jackdaw's own archive corroborates this from the other direction — `docs/sdk-limited-feature-deferrals.md` (2026-05-04) states:

> **Approval and halt controls** … Deferred/unavailable in this MVP. … No approve, decline, pause, resume, or halt command endpoint should be added until the gate is satisfied.

and

> `Pi approval/halt capability is not available for this session.`

Headless: `--mode rpc` is documented as "headless operation … via a JSON protocol over stdin/stdout", strict JSONL with LF framing. It replaces the TUI rather than augmenting it. `--mode json` and `-p/--print` likewise.

Sessions: `docs/session-format.md` gives the path as `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`, version 3, a *tree* via `id`/`parentId`. Verified against a real file:

```json
{"type":"session","version":3,"id":"019ff7bc-...","timestamp":"2026-08-12T20:49:03.694Z","cwd":"/home/andy"}
{"type":"model_change","id":"f8c819a5","parentId":null,...}
{"type":"message","id":"0c89ddfc","parentId":"356ec548",...}
```

tmux: pi ships `docs/tmux.md` and works under tmux; it only asks for `extended-keys on` / `extended-keys-format csi-u` so modified Enter keys survive. No obstacle.

### opencode

No binary on this machine, so the *live* signalling story here is docs-derived and marked accordingly. What is directly verified is the on-disk artifact layer, from the real database at `~/.local/share/opencode/opencode.db` (285 MB, last written 2026-07-06), opened read-only.

Tables: `event`, `event_sequence`, `session`, `session_message`, `part`, `permission`, `project`, `workspace`, `todo`, `session_share`, …

The `event` table is an event-sourced log keyed by `(aggregate_id, seq)` with a versioned `type`. Real event types present:

```
session.created.1            session.next.prompted.1
session.updated.1            session.next.step.started.1
session.next.step.ended.2    session.next.step.failed.2
session.next.tool.called.1   session.next.tool.success.1
session.next.tool.failed.1   session.next.tool.input.started.1
session.next.text.started.1  session.next.reasoning.started.1
message.updated.1            message.part.updated.1
```

Payloads are rich, e.g. a `session.next.tool.called.1`:

```json
{"timestamp":1782759135796,"sessionID":"ses_0eb5f2b23ffeawZIjHUL3Td0Of",
 "assistantMessageID":"msg_...","callID":"call_...","tool":"bash",
 "input":{"command":"git status --short --branch","workdir":"..."}}
```

This is the strongest on-disk lifecycle record of any harness surveyed: opencode persists the transitions themselves, not just the conversation.

Two honest caveats. First, **no permission/approval event type appears in this log** — the `permission` *table* holds project-scoped granted permissions (`action`, `resource`, `time_created`), which is a grant ledger, not a pending-approval signal. Second, this database is from a version roughly a year stale relative to today; the schema and event vocabulary may have moved. The opencode row should be re-verified against a live install before the adapter contract is frozen.

### Unverified

| Harness | Why not verified |
|---|---|
| **droid** (Factory) | Not installed; no `~/.factory` on this machine; no first-party artifact available to inspect. |
| **qwen** | Not installed; no `~/.qwen`. |
| **cursor** | Not installed; no `~/.cursor`; no `cursor`/`cursor-agent` on `PATH`. |
| **hermes** | Not installed; no `~/.hermes`. The product identity behind this name was not established with confidence from a first-party source. |

For all four, the only local signal is that `herdr integration list` offers an installer, and `herdr integration status` names a target path (`~/.factory/hooks/herdr-agent-state.sh`, `~/.qwen/hooks/herdr-agent-session.sh`, `~/.cursor/herdr-agent-state.sh`, `~/.hermes/plugins/herdr-agent-state/__init__.py`). That is a hint that *some* extension point exists in each, and the file extensions hint at its shape (shell hook vs Python plugin). It is not evidence of which events fire, and it is deliberately not used as such here. One detail worth chasing later: qwen's file is named `herdr-agent-session.sh`, not `-state.sh`, which reads like session-identity only rather than state transitions.

Verifying these four requires installing them. That is a follow-up task, not something to paper over.

## What herdr's own design suggests

Corroborating, not load-bearing. herdr supports 17 harnesses and is the incumbent Jackdaw replaces, so how it actually detects state is informative.

The herdr Claude integration installed on this machine (`~/.claude/hooks/herdr-agent-state.sh`, `HERDR_INTEGRATION_VERSION=7`) handles exactly one action:

```sh
case "$action" in
  session) ;;
  *) exit 0 ;;
esac
```

and the payload it forwards over `HERDR_SOCKET_PATH` is `pane_id`, `agent_session_id`, `agent_session_path`, `session_start_source`. It is a **session-identity correlator**, not a state reporter. Meanwhile the herdr binary's own agent model carries `agent_status` with the vocabulary `working` / `blocked` / `idle` / `unknown`, alongside fields named `screen_detection_skipped`, `terminal_title_stripped`, and a `detection` variant.

Read together: herdr's cross-harness state detection is primarily screen/terminal-title detection, with hooks used to bind a pane to a session id. That is the incumbent's answer to "does this generalise" — and it is closer to "no" than the charting assumption implied. Jackdaw can beat it for claude and codex specifically, because both now expose approval-level hooks that herdr's v7 claude integration does not use.

## Implications for the adapter contract

1. **Per-transition capability declaration.** An adapter declares, per lifecycle transition, whether it observes it natively, derives it from the session artifact, or needs scraping. The supervisor composes. A boolean "supports native signals" would be wrong for four of the eight harnesses.
2. **Two distinct native mechanisms, not one.** Push (hooks/notify programs invoked by the harness, needing a socket or endpoint to call) and pull (tailing the session artifact on disk). Claude and codex offer both; opencode's is strongest on pull. The plugin interface should not assume push.
3. **Headless JSON modes are not a supervision channel.** `claude --print --output-format stream-json`, `codex exec --json`, and `pi --mode rpc` all *replace* the interactive TUI. Under the tmux substrate decision they are irrelevant to supervising a live pane. Do not let them inflate the capability matrix.
4. **The TTY question is settled by construction.** Every TUI surveyed wants a real terminal — codex refuses to start without one — and tmux supplies exactly that. Launching behind a wrapper is a non-issue for the tmux design; it would only have been a problem for a PTY-owning daemon, which #1 already ruled out.
5. **Approval-blocking is where scraping survives.** For pi, opencode, and everything unverified, "this pane is waiting on a human" is not natively observable today. If Jackdaw wants that state universally, scraping stays in the design — but scoped to one transition rather than being the whole detector.
