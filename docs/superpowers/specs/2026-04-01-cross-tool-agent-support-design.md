# Cross-Tool Agent Support: OpenCode Adapter

## Overview

Add support for monitoring OpenCode sessions in Jackdaw, establishing the adapter pattern for future tool integrations (Codex, Aider, Gemini CLI).

The approach: a thin OpenCode plugin forwards events to Jackdaw's IPC socket using a shared protocol package (`@jackdaw/protocol`) that defines canonical tool names and the wire format. Jackdaw's backend handles state management and the new event types.

## Components

### `@jackdaw/protocol` (npm package)

Shared TypeScript package defining the canonical wire format and generic tool vocabulary.

**Generic tool vocabulary:**

| Canonical | Claude Code | OpenCode |
|---|---|---|
| `shell` | Bash | bash/shell |
| `file_read` | Read | read |
| `file_write` | Write | write |
| `file_edit` | Edit | edit |
| `file_search` | Glob | glob |
| `content_search` | Grep | grep |
| `agent` | Agent | agent/subagent |
| `web_fetch` | WebFetch | web_fetch |
| `web_search` | WebSearch | web_search |

Unmapped tool names pass through as-is.

**Exports:**

- `ToolNameMap` — typed mapping per source tool
- `normalizeToolName(source: string, toolName: string): string` — canonical lookup with passthrough fallback
- `HookPayload` — TypeScript interface matching Jackdaw's Rust struct
- `sendToJackdaw(payload: HookPayload): Promise<void>` — connects to IPC socket, writes JSON + newline, disconnects
- `getSocketPath(): string` — `~/.jackdaw/jackdaw.sock` (Unix) or `\\.\pipe\jackdaw` (Windows)

No runtime dependencies beyond Node/Bun built-ins (`net`, `path`, `os`).

### `@jackdaw/opencode` (OpenCode plugin)

Subscribes to OpenCode lifecycle events and forwards them to Jackdaw via `@jackdaw/protocol`.

**Event mapping:**

| OpenCode Event | Jackdaw Event | Notes |
|---|---|---|
| `session.created` | `SessionStart` | |
| `session.idle` | `Stop` | Session waiting for user input |
| `session.deleted` | `SessionEnd` | |
| `tool.execute.before` | `PreToolUse` | Tool name normalized via `@jackdaw/protocol` |
| `tool.execute.after` | `PostToolUse` | |
| `permission.asked` | `PermissionRequest` | New event type |
| `permission.replied` | `PermissionReply` | New event type |

**Plugin structure:**

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { sendToJackdaw, normalizeToolName } from "@jackdaw/protocol"

export const JackdawPlugin: Plugin = async ({ project }) => {
  return {
    event: async ({ event }) => {
      // Map session lifecycle events to HookPayload, call sendToJackdaw()
    },
    "tool.execute.before": async (input, output) => {
      // Send PreToolUse with normalized tool name
    },
    "tool.execute.after": async (input, output) => {
      // Send PostToolUse with normalized tool name
    },
  }
}
```

**Failure handling:** If the Jackdaw socket isn't available, log once and silently skip. No retries, no queuing — fire-and-forget.

**Distribution:** Developed in the Jackdaw monorepo, published to npm. Users install via `npm install @jackdaw/opencode` and add to their `opencode.json` plugins list.

### Jackdaw Backend Changes

**New event types:**

- `PermissionRequest` — sets `pending_approval = true`, `has_unread = true`. Includes tool name and input that triggered the permission prompt.
- `PermissionReply` — clears `pending_approval`. Carries `approved: bool` so the UI can show accept/deny. If OpenCode's `permission.replied` event doesn't expose an explicit approval value, infer from the event payload or default to `true`.

Claude Code's `Notification` event maps to `PermissionRequest` internally. The `Notification` wire name continues to work for backwards compatibility.

**Tool name normalization:**

`extract_summary()` in `state.rs` matches on canonical vocabulary (`shell`, `file_read`, `file_edit`, etc.) as primary keys, with Claude Code names (`Bash`, `Read`, `Edit`, etc.) as fallback aliases. Events from `@jackdaw/opencode` (already normalized) match immediately; events from `jackdaw send` (Claude Code raw names) match via alias.

**New `HookPayload` field:**

- `source_tool: Option<String>` — identifies the originating tool (`"claude-code"`, `"opencode"`, etc.). Set by the protocol package, displayed in the frontend.

**Remove `jackdaw-send` binary:**

Delete `src-tauri/src/bin/jackdaw-send.rs`. The `jackdaw send` subcommand stays.

### Frontend Changes

- **Source indicator:** Small label on the session card showing the source tool (e.g., `Claude Code`, `OpenCode`). Driven by `source_tool` field on `Session`.
- **Tool name display:** Canonical names rendered as human-friendly labels (`shell` → `Shell`, `file_read` → `File Read`, etc.).
- **Permission states:** `PermissionRequest`/`PermissionReply` drive the existing `pending_approval` badge — no new UI elements.

## Testing

- **`@jackdaw/protocol`:** Unit tests for `normalizeToolName` (all known mappings, unknown passthrough, case handling). Integration test for `sendToJackdaw` against a mock Unix socket.
- **`@jackdaw/opencode`:** Unit tests for each event mapping (OpenCode event → correct `HookPayload`). Test socket failure handling. Mock `sendToJackdaw` to verify payloads.
- **Backend (Rust):** Extend `state.rs` tests for `PermissionRequest`/`PermissionReply` state transitions. Test `extract_summary` with canonical tool names and Claude Code aliases. Test `Notification` backwards compat.
- **Frontend:** Test `source_tool` rendering on session cards. Test human-friendly tool name labels.

## Out of Scope

- LSP diagnostics, file watcher, and message-level OpenCode events
- SSE pull-mode integration (may add later as alternative)
- Adapters for Codex, Aider, Gemini CLI (future work following same pattern)
- Migrating Claude Code hooks to use `@jackdaw/protocol` (Claude Code hooks continue using `jackdaw send` as-is; backend normalizes on receipt)
