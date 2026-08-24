# Harness lifecycle signals: native events or screen-scraping?

Research for [#2](https://github.com/andybarilla/jackdaw/issues/2), under map [#1](https://github.com/andybarilla/jackdaw/issues/1).
Date: 2026-08-24. Verified on Andy's Linux workstation (CachyOS).

## Verdict

**"Native signals first, scraping as fallback" is a real cross-harness strategy. It is decisively not a Claude-Code-only special case.**

**Six of the eight** harnesses surveyed can tell an external supervisor "I am blocked waiting for a human approval" through a structured channel reachable from a tmux pane, without anyone reading a rendered terminal cell — five of them for free, and a sixth (`opencode`) once Jackdaw supplies a launch flag. Two cannot: `cursor`, whose approval event lives only on a channel that replaces the TUI, and `pi`, which has no built-in approval gate to report on at all.

Of those six, two (`claude`, `codex`) were machine-verified here; the other four rest on vendor documentation or upstream source.

That is the answer to the load-bearing question. The interesting nuance is not *whether* native signals exist but **what it costs to reach them**, and that splits the field three ways:

- **Free — hooks fire in the ordinary interactive TUI, no launch flag needed.** `claude`, `codex`, `droid`, `qwen`, `hermes`. Each fires an out-of-process hook (or hook-equivalent) on permission request. Point it at Jackdaw's socket and you are done.
- **Requires Jackdaw to control the launch.** `opencode` (`--port`/`--hostname`/`--mdns`, otherwise the TUI's HTTP server is in-process-only and unreachable) and `qwen` again if you want its richer sidecar (`--json-fd`/`--json-file`). Fine for Jackdaw, which launches its own panes — but it means the adapter contract needs a **launch-argument contribution** step, not just an observation step.
- **Only on a channel that replaces the TUI.** `cursor` — its `session/request_permission` lives on `cursor-agent acp` (JSON-RPC over stdio), and its hooks can *decide* permission but never announce that the agent is stuck. Under a tmux substrate this is not usable.

`pi` sits alone: rich in-TUI events including a documented `agent_settled` intended for status integrations, and no approval concept at all to observe.

**The confidence is not uniform, and the tier a harness sits in is not the same claim as how well it was checked.** Only `claude` (2.1.241), `codex-cli` (0.147.0) and `pi` (0.84.1) were verified against binaries, bundled docs and real session files on this machine. `opencode`'s on-disk layer was verified against a real but roughly year-stale database with no binary present. `droid`, `cursor`, `qwen` and `hermes` are documentation and upstream-source only — nothing was executed. The provenance column says which is which.

### Consequences for the design

1. **The adapter contract cannot be `getState() -> State`.** It must declare, per transition, whether the harness is observed natively, derived from the session artifact, or scraped. Partial coverage is real (`pi` has no approval signal; `opencode` collapses awaiting-input and finished into one `idle`).
2. **Adapters must contribute launch arguments, not just observe.** `opencode` needs `--port`; `qwen`'s sidecar needs `--json-fd`. Jackdaw launches its own panes, so this is cheap — but only if the plugin interface has a hook for it. This is the single most actionable finding here and it is easy to miss.
3. **Session artifacts on disk are the genuinely cross-harness layer, and #1 bet correctly.** All eight write a durable machine-readable record — JSONL for claude / codex / pi / qwen / droid / cursor, SQLite for opencode and hermes.
4. **Headless JSON modes are mostly not a supervision channel.** `claude --print --output-format stream-json`, `codex exec --json`, `pi --mode rpc`, `opencode run --format json`, `droid exec`, `cursor-agent --print` all *replace* the TUI. The one genuine exception is qwen's Dual Output, which is explicitly a sidecar on the live TUI — and its own docs cite Claude Code's lack of exactly that as the gap it fills.
5. **The TTY question is settled by construction.** Every TUI wants a real terminal (codex refuses to start without one); tmux supplies exactly that. It would only have bitten a PTY-owning daemon, which #1 already ruled out.
6. **Scraping's remaining job is small.** It is a fallback for `pi`, for `cursor` under tmux, and for any harness Jackdaw does not launch itself. That is a far smaller surface than herdr's per-harness regex manifest catalog.

## Method and trust

- Installed and directly inspected on this machine: `claude` 2.1.241, `codex-cli` 0.147.0, `pi` 0.84.1.
- On disk, binary absent: `opencode` (real session database, Jun–Jul 2026, read-only).
- Not installed; official docs and upstream source only: `droid`, `cursor`, `qwen`, `hermes`.
- `herdr integration list` was used only as a *pointer* to which harnesses plausibly expose extension points. No claim below rests on herdr's manifests.

Two distinctions are enforced throughout, because collapsing either would flatter the story:

1. **Interactive TUI vs headless.** Jackdaw supervises live interactive panes under tmux. A harness that only streams JSON in `--print`/`exec` mode gives Jackdaw nothing for a live pane.
2. **"Has hooks" vs "covers the blocking transition."** Nearly anything with a hook system can signal session-start and turn-end. The transition that decides whether scraping can be retired is *blocked on approval* — and there is a further trap: several harnesses let a hook **decide** permission without ever emitting an event saying the agent is currently **stuck**. Deciding is not observing.

## Per-harness table

"Interactive" means: signals available while the harness runs its normal TUI in a tmux pane. "launch flag" means the signal exists but only if the process was started with a specific argument — which Jackdaw can supply.

| Harness | Provenance | Native lifecycle mechanism (interactive) | Headless structured output | started | working | awaiting input | blocked on approval | finished | Session artifacts on disk |
|---|---|---|---|---|---|---|---|---|---|
| **claude** (Claude Code 2.1.241) | machine-verified | Hook engine, 31 events incl. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PermissionDenied`, `Notification`, `Elicitation`, `Stop`, `TeammateIdle`, `SessionEnd` | `-p/--print --output-format stream-json` (print-only) | yes | yes | yes (`Notification`) | **yes** (`PermissionRequest`) | yes (`Stop`, `SessionEnd`) | `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` |
| **codex** (codex-cli 0.147.0) | machine-verified | Hook engine via `hooks.json`, 10 events: `session_start`, `session_end`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `permission_request`, `pre_compact`, `post_compact`, `subagent_start`, `subagent_stop`. Plus `notify` external program (`agent-turn-complete`) | `codex exec --json` (JSONL, exec-only); `app-server` / `mcp-server` / `exec-server` are separate non-TUI modes | yes | yes | yes (`notify`) | **yes** (`permission_request`) | yes (`session_end`, `notify`) | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`; index `~/.codex/session_index.jsonl` |
| **qwen** (qwen-code) | docs + upstream source | Hook engine, 17 events incl. `PermissionRequest`, `Notification` (`permission_prompt`/`idle_prompt`), `SessionStart/End`, `Stop`, `PreToolUse`/`PostToolUse`; executors `command`/`http`/`function`/`prompt`. **Plus Dual Output** — a structured JSON sidecar on the live TUI (`--json-fd`, `--json-file`, `--input-file`) | `--output-format json` or `stream-json`; `qwen serve` daemon with SSE `/session/:id/events` (spawns its own `--acp` child, not the TUI) | yes (`system`/`session_start`) | yes (`stream_event`) | yes | **yes, and answerable** (`control_request`/`can_use_tool` ↔ `confirmation_response`) | yes (`system`/`session_end`) | `~/.qwen/tmp/<project_id>/chats/<sessionId>.jsonl` (append-only, `uuid`/`parentUuid` tree) |
| **droid** (Factory) | docs only | Hook engine, 9 events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`. `Notification` carries `notification_type` ∈ {`permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`} | `droid exec -o json` / `stream-json` / `stream-jsonrpc` (exec-only); JSON-RPC adds `droid.request_permission`, `droid.ask_user` | yes | yes | yes (`idle_prompt`) | **yes** (`permission_prompt`) | yes (`Stop`, `SessionEnd`) | JSONL under `~/.factory/projects/…`, given to hooks as `transcript_path` |
| **hermes** (NousResearch Hermes Agent) | docs + upstream source | 37 `VALID_HOOKS`; in-process Python plugins **and** out-of-process shell hooks declared in `~/.hermes/config.yaml`, which fire in both CLI and gateway. Incl. `on_session_start`, `pre/post_tool_call`, `pre_approval_request`, `post_approval_response`, `post_llm_call`, `on_session_end`, `on_session_finalize` | `hermes acp` (JSON-RPC/stdio, separate mode); OpenAI-compatible HTTP+SSE on the gateway; no run-level `--json` | yes | yes | yes (`post_llm_call`, `on_session_end` turn-end) | **yes, observe-only** (`pre_approval_request` with `surface:"cli"`, `post_approval_response` with `choice`) | yes (`on_session_finalize` teardown, distinct from turn-end) | `~/.hermes/state.db` (SQLite, WAL) |
| **opencode** (sst/opencode) | stale local DB + upstream source | 21 in-process JS/TS plugin hooks incl. `permission.ask`, `tool.execute.before/after`, plus a generic bus `event` hook. Bus events incl. `permission.asked`, `permission.replied`, `session.status`, `session.created`. **Externally reachable only with `--port`/`--hostname`/`--mdns`** — the default TUI runs its server in a Worker behind in-process RPC at `http://opencode.internal` | `opencode run --format json` (NDJSON: `tool_use`, `step_start`, `step_finish`, `text`, `reasoning`, `error`); `opencode serve` + `GET /event` SSE | yes (`server.connected`, `session.created`) | yes (`session.status` `busy`) | **collapsed** — `session.status` `idle` covers awaiting-input *and* finished | **yes with launch flag, answerable** (`permission.asked` → `POST /session/:id/permissions/:permissionID`) | see awaiting-input | SQLite `~/.local/share/opencode/opencode.db`; event-sourced `event`/`event_sequence`/`session`/`session_message`/`part` |
| **cursor** (cursor-agent) | docs only | Hook engine (`hooks.json`), 18 agent events incl. `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `beforeShellExecution`, `stop`, `afterAgentResponse`, `subagentStart/Stop`. CLI firing confirmed by the CLI changelog | `--print --output-format json` or `stream-json` (print-only, NDJSON); `cursor-agent acp` (JSON-RPC/stdio) | yes | yes | partial — no hook for "idle, waiting on human" | **no** in TUI or print mode; only via `acp` (`session/request_permission`) | yes (`stop`, `sessionEnd`) | JSONL, "Claude Code-compatible"; **path undocumented** — runtime-only via `transcript_path` / `CURSOR_TRANSCRIPT_PATH` |
| **pi** (0.84.1) | machine-verified | TypeScript extension events in-TUI: `session_start`, `before_agent_start`, `agent_start`, `turn_start`/`turn_end`, `message_*`, `tool_execution_start/update/end`, `tool_call`, `tool_result`, `agent_end`, `agent_settled`, `input`, `session_shutdown` | `--mode json`, `--mode rpc` (JSONL over stdio; replaces the TUI), `--print` | yes | yes | yes (`agent_settled`) | **no — no built-in approval gate exists** | yes (`agent_settled`, `session_shutdown`) | `~/.pi/agent/sessions/--<cwd-dashes>--/<ts>_<uuid>.jsonl` (v3, tree via `id`/`parentId`) |

TTY is omitted as a column because the answer is uniform: every harness here runs a TUI that wants a real terminal, and tmux provides one. See [TTY](#the-tty-question).

## Evidence

### claude (Claude Code 2.1.241) — machine-verified

The canonical hook-event list, taken from the single array literal that defines it in the shipped bundle at `~/.local/share/claude/versions/2.1.241` — not from grepping for names already expected, which would be self-confirming, and `PermissionRequest` is precisely the name the verdict rests on:

```js
Lq=["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification",
"UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop","StopFailure",
"SubagentStart","SubagentStop","PreCompact","PostCompact","PermissionRequest",
"PermissionDenied","Setup","TeammateIdle","TaskCreated","TaskCompleted","Elicitation",
"ElicitationResult","ConfigChange","WorktreeCreate","WorktreeRemove","InstructionsLoaded",
"CwdChanged","FileChanged","DirectoryAdded","MessageDisplay"]
```

Thirty-one events — the richest hook surface surveyed. The plugin cache on this machine only exercises eight of them; installed plugins using a subset is not evidence the rest are unavailable.

Hooks live under a `hooks` key in `~/.claude/settings.json` and fire in the interactive TUI (verified live: this machine has a `SessionStart` hook installed and running).

Structured output is print-mode only, and `claude --help` says so repeatedly:

```
--output-format <format>   Output format (only works with --print):
                           (only works with --print and --output-format=stream-json)
```

Transcripts: `~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl`, one JSON object per line, e.g. `{"type":"permission-mode","permissionMode":"auto","sessionId":"64bb5609-…"}`.

### codex (codex-cli 0.147.0) — machine-verified

Hook event names and config filename, from the binary's own strings:

```
pre_tool_use permission_request post_tool_use pre_compact post_compact
session_start session_end user_prompt_submit subagent_start subagent_stop
...
hooks.json
```

The binary carries a wire schema (`PermissionRequestHookSpecificOutputWire`, `PreToolUseHookSpecificOutputWire`, `SessionStartHookSpecificOutputWire`, …) and enforcement messages including `PermissionRequest hook denied approval` and `Command blocked by PreToolUse hook`. Hooks are trust-gated — `codex exec --dangerously-bypass-hook-trust` exists to skip "persisted hook trust", which confirms hooks run by default.

Separately, a `notify` config key invokes an external program with a JSON payload of type `agent-turn-complete` carrying `thread-id`, `turn-id`, `cwd`, `input-messages`, `last-assistant-message`. Clean turn-finished signal, independent of hooks.

Headless: `codex exec --json` → "Print events to stdout as JSONL". Exec-only. Codex also has `app-server` (JSON-RPC), `mcp-server`, `exec-server`, and a TUI `--remote <ws://|unix://>` flag connecting the TUI to a remote app server — an interesting future path, but a different launch topology.

Rollouts, 829 of them on this machine:

```
~/.codex/sessions/2026/08/23/rollout-2026-08-23T16-21-34-01a030b7-…jsonl
```

Line types observed: `session_meta`, `turn_context`, `world_state`, `event_msg`, `response_item`. `session_meta` carries `session_id`, `cwd`, `originator`, `cli_version`, `source`, `model_provider`.

TTY, verbatim from the binary:

```
TERM is set to "dumb". Refusing to start the interactive TUI because no terminal is
available for a confirmation prompt (stdin/stderr is not a TTY).
```

### qwen (qwen-code) — docs + upstream source, not installed

The most supervision-friendly harness surveyed, and the one whose absence from the original assumption is most surprising.

Seventeen hook events, from `docs/users/features/hooks.md` upstream: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `SessionDelete`, `MessageDisplay`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `Notification`, `PermissionRequest`, `PermissionDenied`, `TodoCreated`, `TodoCompleted`. Configured in `.qwen/settings.json`. Four executor types — `command` (JSON via stdin/stdout), `http` (POST to a URL), `function`, `prompt`. The `http` executor is notable for Jackdaw: a hook can POST straight to a daemon with no shell shim.

Verbatim rows:

> `| PermissionRequest | When permission dialog is shown | Tool id |`
> `| Notification | When notifications are sent | Type (permission_prompt, idle_prompt, auth_success) |`

The decisive feature is **Dual Output** (`docs/users/features/dual-output.md`):

> "Dual Output is a sidecar mode for the interactive TUI: while Qwen Code keeps rendering normally on `stdout`, it concurrently emits a structured JSON event stream to a separate channel so an external program … can observe and steer the session."

Flags `--json-fd <n>` (n ≥ 3), `--json-file <path>` (regular file, FIFO, or `/dev/fd/N`), `--input-file <path>` for a JSONL reverse channel; also `dualOutput.jsonFile` / `dualOutput.inputFile` in `~/.qwen/settings.json`. The schema is the same as `--output-format=stream-json` with `includePartialMessages` always on.

The docs draw the comparison themselves:

> "Claude Code exposes a similar stream-json event format … but only in non-interactive mode — it has no equivalent of running the TUI and a structured sidecar channel at the same time. Dual Output fills that gap."

Approval is not merely observable but answerable:

```json
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"run_shell_command", …}}
{"type":"confirmation_response","request_id":"…","allowed":true}
```

and `control_response` is emitted whether the decision came from the TUI's native approval UI or from an external `confirmation_response` — so a supervisor sees the outcome either way.

Session start and end are explicit frames (`system`/`session_start`, `system`/`session_end`), with the doc noting consumers should treat a closed stream without `session_end` as abnormal termination. That is a well-designed supervision contract.

`qwen serve` (default `http://127.0.0.1:4170`) offers SSE `GET /session/:id/events` with `Last-Event-ID` replay and `GET /session/:id/status`, plus `permission_request`/`permission_resolved`. Important caveat: it spawns its own `qwen --acp` child; it is **not** the interactive TUI, and the co-hosted mode is explicitly marked unshipped ("Mode 2 — Stage 1.5 `qwen --serve` co-hosted TUI (not in this PR)").

Transcripts, from `packages/core/src/services/chatRecordingService.ts`:

> "Storage Format: JSONL files with tree-structured records."
> "File location: `~/.qwen/tmp/<project_id>/chats/`"

Filename `${sessionId}.jsonl`, append-only, `uuid`/`parentUuid`.

### droid (Factory) — docs only, not installed

`docs.factory.ai/harness/hooks` documents nine hook events — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd` — configured in `~/.factory/hooks.json` (user), `.factory/hooks.json` (project), or a `hooks` key in the matching `settings.json`, and managed in-TUI via `/hooks`.

The decisive one is `Notification` and its `notification_type`:

> `permission_prompt` — "Droid is waiting for permission to run an action."
> `idle_prompt` — "Droid is waiting for user input, including immediately after the user cancels a turn."
> `elicitation_dialog` — "Droid needs structured input in an elicitation dialog."

A native, in-TUI, blocked-on-approval signal *and* a native awaiting-input signal, cleanly distinguished. On the documented surface droid is the equal of claude and codex.

Deciding vs observing: `PreToolUse` can return `permissionDecision: "allow" | "deny" | "ask"`, which makes the hook an approver. That is a different thing from `Notification`/`permission_prompt`, which reports that droid is currently stuck. Only the latter is a supervision signal.

Transcripts: `transcript_path` is a documented hook-input field, and the doc's own example payload shows JSONL under `~/.factory/projects/…`. Factory never writes the layout out in prose, so treat the exact filename shape as unconfirmed.

Headless: `droid exec -o text|json|stream-json|stream-jsonrpc`. JSON-RPC mode adds server-to-client requests `droid.request_permission` and `droid.ask_user` — a custom-client topology, not a tmux pane.

**Could not verify:** whether hooks fire during `droid exec` (hooks page, droid-exec page, CLI reference and changelog are all silent), and the exact on-disk transcript filename.

### hermes (NousResearch Hermes Agent) — docs + upstream source, not installed

Identity established from two discriminating constraints, both confirmed verbatim upstream: plugins live in `~/.hermes/plugins/<name>/` with `plugin.yaml` and `__init__.py`. It self-describes as a general-purpose agent with a full TUI, not narrowly a coding harness — worth noting before treating it as a peer of the others.

`hermes_cli/plugins.py` defines `VALID_HOOKS` with **37 names** (the published docs say 26 — stale). Relevant subset: `on_session_start`, `on_session_end`, `on_session_finalize`, `on_session_reset`, `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_stream_start`/`on_stream_delta`/`on_stream_end`, `subagent_start`, `subagent_stop`, `pre_approval_request`, `post_approval_response`.

The approval hooks carry their own comment in source:

> `# Approval lifecycle hooks. Fired by tools/approval.py when a dangerous`
> `# command needs an approval decision -- fires for CLI-interactive prompts,`
> `# gateway/ACP approvals, and smart-mode auxiliary-LLM decisions.`
> `# Observers only: return values are ignored.`

Kwargs include `surface: "cli" | "gateway" | "smart"`; `post_approval_response` adds `choice: "once" | "session" | "always" | "deny" | "timeout" | "smart_approve" | "smart_deny"`. Pairing the two events gives a clean blocked-window with a reason for its close.

Crucially for an out-of-process supervisor, hermes has **shell hooks** as well as in-process Python plugins — declared in `~/.hermes/config.yaml` under `hooks:` and run as subprocesses, "in both CLI and gateway sessions", with a stdin payload of `{"hook_event_name", "tool_name", "tool_input", "session_id", "cwd", "extra"}`. Only `transform_api_error_classification` is excluded.

The observe-only constraint matters: a supervisor can detect the block but cannot answer it through this channel.

Turn-end and teardown are separate, which is better than most: `post_llm_call` / `on_session_end` fire at turn finalization (with `turn_exit_reason`, `completed`, `failed`, `interrupted`), while `on_session_finalize` fires at CLI/TUI/gateway teardown.

Storage: `~/.hermes/state.db`, SQLite in WAL mode, rooted at `$HERMES_HOME` or `~/.hermes/`. Optional ShareGPT JSONL trajectories exist but are a library-level switch — "the `hermes` CLI does not expose a config key or flag for it".

Other modes: `hermes acp` (JSON-RPC over stdio, a separate mode, renders approval prompts among other things) and an OpenAI-compatible gateway HTTP API with SSE. Neither observes a running TUI.

**Could not verify:** whether any flag exposes a structured event stream from the *interactive* hermes TUI. No official documentation covers it, and shell hooks appear to be the only out-of-process channel for a live TUI.

### opencode (sst/opencode) — stale local artifact + upstream source

Plugin hooks, from `packages/plugin/src/index.ts` (`export interface Hooks`): `dispose`, `event`, `config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `shell.env`, `tool.execute.after`, plus several `experimental.*` and `tool.definition`.

```ts
"permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
```

Bus events (independently confirmed against `opencode.ai/docs/plugins/`): `permission.asked`, `permission.replied`, `session.created`, `session.updated`, `session.idle`, `session.status`, `session.error`, `session.compacted`, `session.deleted`, `session.diff`, `message.updated`, `message.part.updated`, `tool.execute.before`, `tool.execute.after`, `server.connected`, `file.edited`, `todo.updated`, `tui.*`, and more.

`session.status` is the state field, and it is coarse:

```ts
export const Info = Schema.Union([ {type:"idle"}, {type:"retry", …}, {type:"busy"} ])
export const Status = Event.define({ type: "session.status", schema: { sessionID, status: Info } })
// deprecated
export const Idle = Event.define({ type: "session.idle", schema: { sessionID } })
```

**The catch, and it is the most consequential detail in this document.** The docs say the TUI "randomly assigns a port and hostname", but `packages/opencode/src/cli/cmd/tui.ts` on `dev` HEAD shows the default TUI opens no TCP listener at all:

```ts
const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true
const transport = external
  ? { url: (await client.call("server", network)).url, … }
  : { url: "http://opencode.internal", fetch: createWorkerFetch(client), events: createEventSource(client) }
```

The server runs inside a Worker reached by in-process RPC against a synthetic host. So the TUI *is* backed by the same server, but by default nothing outside the process can reach it. Launching `opencode --port 4096` (or `--hostname`, or `--mdns`) publishes a real endpoint, at which point `GET /event` (SSE) delivers the full bus and `POST /session/:id/permissions/:permissionID` answers approvals. `opencode attach <url>` is a further option. The docs and the `dev` source genuinely disagree here and both are reported; a release build should be checked before relying on either.

`opencode run --format json` emits NDJSON, but its `emit()` type set is only `tool_use`, `step_start`, `step_finish`, `text`, `reasoning`, `error` — no permission type and no completion type — and run mode never blocks on a permission anyway:

```ts
if (event.type === "permission.asked") { …
  if (auto) { await client.permission.reply({ requestID: permission.id, reply: "once" }) }
  else { … "permission requested: … ; auto-rejecting"; await client.permission.reply({ requestID: permission.id, reply: "reject" }) } }
```

Storage, verified against the real database on this machine (285 MB, last written 2026-07-06, opened read-only). Tables include `event`, `event_sequence`, `session`, `session_message`, `part`, `permission`, `project`, `workspace`, `todo`, `session_share`. The `event` table is an event-sourced log keyed by `(aggregate_id, seq)` with versioned `type`. Real types present:

```
session.created.1            session.next.prompted.1
session.updated.1            session.next.step.started.1
session.next.step.ended.2    session.next.step.failed.2
session.next.tool.called.1   session.next.tool.success.1
session.next.tool.failed.1   session.next.tool.input.started.1
session.next.text.started.1  session.next.reasoning.started.1
message.updated.1            message.part.updated.1
```

with rich payloads, e.g. a `session.next.tool.called.1`:

```json
{"timestamp":1782759135796,"sessionID":"ses_0eb5f2b23ffeawZIjHUL3Td0Of",
 "assistantMessageID":"msg_…","callID":"call_…","tool":"bash",
 "input":{"command":"git status --short --branch","workdir":"…"}}
```

This is the strongest on-disk lifecycle record surveyed: opencode persists the transitions themselves, not just the conversation. Two caveats. No permission event appears in this sample — but absence in one sample is not absence from the vocabulary, and upstream source confirms `permission.asked` exists, so the row is corrected from the source rather than the sample. And the `permission` *table* holds project-scoped granted permissions (`action`, `resource`, `time_created`) — a grant ledger, not a pending-approval signal; do not mistake one for the other. The database is roughly a year stale; the path resolution in `packages/core/src/database/database.ts` confirms `~/.local/share/opencode/opencode.db` remains the default for release channels.

### cursor (cursor-agent) — docs only, not installed

`cursor.com/docs/hooks` documents 18 agent hook events (`sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought`) plus tab and app-lifecycle hooks, configured in `hooks.json` with enterprise → team → project → user precedence.

A documentation caveat: that page is IDE-framed throughout, and neither the CLI overview nor `cli-config.json` mentions hooks. CLI-scoped confirmation comes from the CLI changelog:

> "**Hooks fire reliably.** `afterAgentThought`/`afterAgentResponse` events emit in the CLI, and Claude Code-format hook responses are accepted."

**Cursor has no in-TUI blocked-on-approval signal.** Its hooks let you *decide* permission (`beforeShellExecution` returning `permission: "allow"/"deny"/"ask"`), but nothing fires because Cursor's own approval prompt is on screen. The approval event exists only on `cursor-agent acp` (JSON-RPC 2.0 over stdio, "hidden from default command help output"), which sends `session/request_permission` and warns "If your client does not answer permission requests, tool execution can block." Awaiting-input is likewise ACP-only (`cursor/ask_question`).

Structured output is explicitly gated:

> "This option is only valid when printing (`--print`) or when print mode is inferred (non-TTY stdout or piped stdin)."

`stream-json` emits NDJSON with `system/init`, `user`, `assistant`, `tool_call` (started/completed) and a terminal `result`. No permission event in that schema, and headless approval mostly resolves as a non-zero exit — untrusted workspaces "fail with guidance" unless `--trust`/`--force` is passed.

Transcripts: "headless transcripts write Claude Code-compatible JSONL" and "transcripts persist to disk for tooling and hooks"; hooks receive `transcript_path` / `CURSOR_TRANSCRIPT_PATH`. **The on-disk path is documented nowhere first-party** — runtime-discoverable only.

Two near-misses that are *not* programmatic channels: the `notifications` setting ("Send a terminal notification when the agent finishes or needs input") and `display.showStatusIndicators` ("Enable terminal title status indicators"). The second is rendered terminal state — scraping with extra steps.

### pi (0.84.1) — machine-verified

pi ships its docs inside the npm package (`@earendil-works/pi-coding-agent/docs/`), a first-party primary source.

`docs/extensions.md` diagrams the in-TUI lifecycle: `project_trust` → `session_start` → `input` → `before_agent_start` → `agent_start` → (`turn_start` → `tool_execution_start` → `tool_call` → `tool_execution_end` → `turn_end`)* → `agent_end` → `agent_settled`, with `session_shutdown` on exit.

`agent_settled` is documented for exactly Jackdaw's use case:

> `agent_end` fires when that run ends, but Pi may still auto-retry, auto-compact and retry, or continue with queued follow-up messages. **Use `agent_settled` for status integrations** that need to know Pi will not continue running automatically.

What pi lacks is an approval gate to observe. The docs list "Permission gates (confirm before `rm -rf`, `sudo`, etc.)" as an example of something an *extension* can build using `tool_call` (which "can block") plus `ctx.ui.confirm()`. There is no `permission_request` equivalent. Jackdaw's own archive corroborates from the other direction — `docs/sdk-limited-feature-deferrals.md` (2026-05-04):

> **Approval and halt controls** … Deferred/unavailable in this MVP. … No approve, decline, pause, resume, or halt command endpoint should be added until the gate is satisfied.

Headless: `--mode rpc` is "headless operation … via a JSON protocol over stdin/stdout", strict JSONL with LF framing. It replaces the TUI.

Sessions: `docs/session-format.md` gives `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`, version 3, a tree via `id`/`parentId`. Verified against a real file:

```json
{"type":"session","version":3,"id":"019ff7bc-…","timestamp":"2026-08-12T20:49:03.694Z","cwd":"/home/andy"}
{"type":"model_change","id":"f8c819a5","parentId":null,…}
{"type":"message","id":"0c89ddfc","parentId":"356ec548",…}
```

pi ships `docs/tmux.md`; it only asks for `extended-keys on` / `extended-keys-format csi-u` so modified Enter keys survive.

### The TTY question

Uniform and undramatic. Every harness surveyed runs a TUI that expects a real terminal; codex states it outright, refusing to start when `stdin/stderr` is not a TTY. tmux gives each pane a real PTY, so the constraint is satisfied by construction under #1's substrate decision. It would only have mattered for a PTY-owning daemon, which #1 already ruled out.

The interesting version of question 4 is not "does it tolerate a wrapper" but "does the wrapper get to choose the launch arguments" — and there, Jackdaw's control of launch is what unlocks opencode's `--port` and qwen's `--json-fd`.

## What herdr's own design shows

Corroborating, not load-bearing. herdr supports 17 harnesses and is the incumbent Jackdaw replaces, so how it actually detects state is informative.

Its Claude integration installed on this machine (`~/.claude/hooks/herdr-agent-state.sh`, `HERDR_INTEGRATION_VERSION=7`) handles exactly one action:

```sh
case "$action" in
  session) ;;
  *) exit 0 ;;
esac
```

and forwards `pane_id`, `agent_session_id`, `agent_session_path`, `session_start_source` over `HERDR_SOCKET_PATH`. A **session-identity correlator**, not a state reporter. The binary's agent model carries `agent_status` with vocabulary `working` / `blocked` / `idle` / `unknown`, alongside `screen_detection_skipped`, `terminal_title_stripped`, and a `detection` variant.

The mechanism is explicit. herdr ships an agent-detection **manifest catalog**, refreshed remotely:

```
HERDR_AGENT_DETECTION_MANIFEST_CATALOG_URL
https://herdr.dev/agent-detection/index.toml
```

with per-agent match rules using `contains` / `regex` / `line_regex` / `all` / `any` / `not`, resolving to `visible_idle`, `visible_working`, `visible_blocker`, `skip_state_update`. An actual embedded rule:

```toml
{ contains = ["hermes needs your"] }
```

That is regex-matching rendered pane text, shipped as a versioned per-harness manifest.

This is a herdr implementation choice, not evidence that native signals are absent — six of the eight harnesses here can report approval-blocking natively on a channel a tmux pane can reach, and herdr draws on none of it. The reading that matters: herdr gets adequate results from scraping, so Jackdaw's native-signals path must earn its complexity. On this evidence it does, comfortably — a hook that fires on `permission_request` is exact, instant and version-stable, where a regex on a prompt box breaks every time a harness restyles its UI.

## Follow-ups this leaves open

- **Install and verify `qwen`.** It is the strongest harness in this survey and the only one with a structured sidecar on a live TUI. Dual Output is not doc-only vapour — `--json-fd` / `--json-file` / `--input-file` are registered as real yargs options in `packages/cli/src/config/config.ts` (with a mutual-exclusion check), implemented in `packages/cli/src/dualOutput/DualOutputBridge.ts`, wired into `packages/cli/src/ui/startInteractiveUI.tsx`, and covered by tests and both SDKs' schemas. That was checked because qwen's docs tree demonstrably carries unshipped prose elsewhere ("Mode 2 — Stage 1.5 `qwen --serve` co-hosted TUI (not in this PR)"). What remains unverified is behaviour of a *released build*, not existence. qwen belongs in the first round of adapter prototypes.
- **Resolve the opencode contradiction.** Docs claim the TUI assigns a random port; `dev` HEAD shows no listener without `--port`/`--hostname`/`--mdns`. Check a release build. This decides whether opencode's adapter needs a launch-argument contribution.
- **Confirm `droid`, `cursor`, `hermes` against real installs.** All three look plausible on paper; none was executed.
- **Establish whether droid hooks fire during `droid exec`.** Undocumented; decides whether droid has one supervision channel or two.
- **Find cursor's on-disk transcript path empirically.** It exists but is documented nowhere first-party.
- **Re-verify opencode's session artifacts against a current install.** The database inspected here is roughly a year stale.
