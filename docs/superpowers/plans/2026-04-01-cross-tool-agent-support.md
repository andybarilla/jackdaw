# Cross-Tool Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Jackdaw to monitor OpenCode sessions via a shared protocol package and OpenCode plugin, establishing the adapter pattern for future tool integrations.

**Architecture:** Three components — `@jackdaw/protocol` (shared npm package with canonical tool vocabulary and IPC helpers), `@jackdaw/opencode` (thin OpenCode plugin), and backend/frontend changes to Jackdaw for new event types and tool name normalization.

**Tech Stack:** TypeScript (npm packages), Rust (Tauri backend), Svelte 5 (frontend)

---

### Task 1: Set Up npm Workspaces

**Files:**
- Modify: `package.json`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts` (empty placeholder)
- Create: `packages/opencode/package.json`
- Create: `packages/opencode/tsconfig.json`
- Create: `packages/opencode/src/index.ts` (empty placeholder)

- [ ] **Step 1: Add workspaces to root package.json**

Add the `workspaces` field to `package.json`:

```json
{
  "workspaces": [
    "packages/*"
  ]
}
```

- [ ] **Step 2: Create `packages/protocol/package.json`**

```json
{
  "name": "@jackdaw/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "~5.6.2",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/protocol/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `packages/protocol/src/index.ts`**

```ts
// Placeholder — populated in Task 2
export {};
```

- [ ] **Step 5: Create `packages/opencode/package.json`**

```json
{
  "name": "@jackdaw/opencode",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@jackdaw/protocol": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~5.6.2",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 6: Create `packages/opencode/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `packages/opencode/src/index.ts`**

```ts
// Placeholder — populated in Task 4
export {};
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: Workspaces linked, `node_modules` updated.

- [ ] **Step 9: Verify workspace setup**

Run: `npm ls --workspaces`
Expected: Shows `@jackdaw/protocol` and `@jackdaw/opencode` as workspace packages.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json packages/
git commit -m "chore: set up npm workspaces for protocol and opencode packages"
```

---

### Task 2: `@jackdaw/protocol` — Types and Tool Vocabulary

**Files:**
- Create: `packages/protocol/src/types.ts`
- Create: `packages/protocol/src/tools.ts`
- Create: `packages/protocol/src/tools.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write failing tests for `normalizeToolName`**

Create `packages/protocol/src/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeToolName } from './tools';

describe('normalizeToolName', () => {
  it('normalizes Claude Code tool names', () => {
    expect(normalizeToolName('claude-code', 'Bash')).toBe('shell');
    expect(normalizeToolName('claude-code', 'Read')).toBe('file_read');
    expect(normalizeToolName('claude-code', 'Write')).toBe('file_write');
    expect(normalizeToolName('claude-code', 'Edit')).toBe('file_edit');
    expect(normalizeToolName('claude-code', 'Glob')).toBe('file_search');
    expect(normalizeToolName('claude-code', 'Grep')).toBe('content_search');
    expect(normalizeToolName('claude-code', 'Agent')).toBe('agent');
    expect(normalizeToolName('claude-code', 'WebFetch')).toBe('web_fetch');
    expect(normalizeToolName('claude-code', 'WebSearch')).toBe('web_search');
  });

  it('normalizes OpenCode tool names', () => {
    expect(normalizeToolName('opencode', 'bash')).toBe('shell');
    expect(normalizeToolName('opencode', 'shell')).toBe('shell');
    expect(normalizeToolName('opencode', 'read')).toBe('file_read');
    expect(normalizeToolName('opencode', 'write')).toBe('file_write');
    expect(normalizeToolName('opencode', 'edit')).toBe('file_edit');
    expect(normalizeToolName('opencode', 'glob')).toBe('file_search');
    expect(normalizeToolName('opencode', 'grep')).toBe('content_search');
    expect(normalizeToolName('opencode', 'agent')).toBe('agent');
    expect(normalizeToolName('opencode', 'subagent')).toBe('agent');
    expect(normalizeToolName('opencode', 'web_fetch')).toBe('web_fetch');
    expect(normalizeToolName('opencode', 'web_search')).toBe('web_search');
  });

  it('passes through unknown tool names unchanged', () => {
    expect(normalizeToolName('claude-code', 'UnknownTool')).toBe('UnknownTool');
    expect(normalizeToolName('opencode', 'custom_tool')).toBe('custom_tool');
  });

  it('passes through unknown sources unchanged', () => {
    expect(normalizeToolName('aider', 'Bash')).toBe('Bash');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && npx vitest run`
Expected: FAIL — `./tools` module not found.

- [ ] **Step 3: Create types**

Create `packages/protocol/src/types.ts`:

```ts
export interface HookPayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  spawned_session?: string;
  source_tool?: string;
}
```

- [ ] **Step 4: Implement `normalizeToolName`**

Create `packages/protocol/src/tools.ts`:

```ts
type ToolMap = Record<string, string>;

const TOOL_MAPS: Record<string, ToolMap> = {
  'claude-code': {
    Bash: 'shell',
    Read: 'file_read',
    Write: 'file_write',
    Edit: 'file_edit',
    Glob: 'file_search',
    Grep: 'content_search',
    Agent: 'agent',
    WebFetch: 'web_fetch',
    WebSearch: 'web_search',
  },
  opencode: {
    bash: 'shell',
    shell: 'shell',
    read: 'file_read',
    write: 'file_write',
    edit: 'file_edit',
    glob: 'file_search',
    grep: 'content_search',
    agent: 'agent',
    subagent: 'agent',
    web_fetch: 'web_fetch',
    web_search: 'web_search',
  },
};

export function normalizeToolName(source: string, toolName: string): string {
  return TOOL_MAPS[source]?.[toolName] ?? toolName;
}
```

- [ ] **Step 5: Update index.ts exports**

Update `packages/protocol/src/index.ts`:

```ts
export { normalizeToolName } from './tools';
export type { HookPayload } from './types';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/protocol && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/
git commit -m "feat(protocol): add HookPayload type and tool name normalization"
```

---

### Task 3: `@jackdaw/protocol` — IPC Client

**Files:**
- Create: `packages/protocol/src/ipc.ts`
- Create: `packages/protocol/src/ipc.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write failing tests for IPC client**

Create `packages/protocol/src/ipc.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { sendToJackdaw, getSocketPath } from './ipc';
import type { HookPayload } from './types';

function tmpSocketPath(): string {
  return join(tmpdir(), `jackdaw-test-${randomBytes(4).toString('hex')}.sock`);
}

describe('getSocketPath', () => {
  it('returns a non-empty string', () => {
    const path = getSocketPath();
    expect(path).toBeTruthy();
    expect(typeof path).toBe('string');
  });
});

describe('sendToJackdaw', () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('sends JSON payload over socket', async () => {
    const socketPath = tmpSocketPath();
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      server = createServer((conn) => {
        let buf = '';
        conn.on('data', (chunk) => { buf += chunk.toString(); });
        conn.on('end', () => { received.push(buf); });
      });
      server.listen(socketPath, resolve);
    });

    const payload: HookPayload = {
      session_id: 'test-123',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
      source_tool: 'opencode',
    };

    await sendToJackdaw(payload, socketPath);

    // Give server time to process
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0].trimEnd());
    expect(parsed.session_id).toBe('test-123');
    expect(parsed.hook_event_name).toBe('SessionStart');
    expect(parsed.source_tool).toBe('opencode');
  });

  it('resolves silently when socket is not available', async () => {
    const payload: HookPayload = {
      session_id: 'test-456',
      cwd: '/tmp',
      hook_event_name: 'Stop',
    };

    // Should not throw
    await sendToJackdaw(payload, '/tmp/nonexistent-jackdaw.sock');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && npx vitest run`
Expected: FAIL — `./ipc` module not found.

- [ ] **Step 3: Implement IPC client**

Create `packages/protocol/src/ipc.ts`:

```ts
import { connect } from 'net';
import { homedir, platform } from 'os';
import { join } from 'path';
import type { HookPayload } from './types';

export function getSocketPath(): string {
  if (platform() === 'win32') {
    return '\\\\.\\pipe\\jackdaw';
  }
  return join(homedir(), '.jackdaw', 'jackdaw.sock');
}

let loggedFailure = false;

export function sendToJackdaw(
  payload: HookPayload,
  socketPath?: string,
): Promise<void> {
  const target = socketPath ?? getSocketPath();
  const data = JSON.stringify(payload) + '\n';

  return new Promise((resolve) => {
    const socket = connect(target, () => {
      socket.end(data, () => resolve());
    });
    socket.on('error', () => {
      if (!loggedFailure) {
        console.error(`[jackdaw] socket not available at ${target}`);
        loggedFailure = true;
      }
      resolve();
    });
  });
}
```

- [ ] **Step 4: Update index.ts exports**

Update `packages/protocol/src/index.ts`:

```ts
export { normalizeToolName } from './tools';
export { sendToJackdaw, getSocketPath } from './ipc';
export type { HookPayload } from './types';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/protocol && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/
git commit -m "feat(protocol): add IPC client with sendToJackdaw and getSocketPath"
```

---

### Task 4: `@jackdaw/opencode` — OpenCode Plugin

**Files:**
- Create: `packages/opencode/src/plugin.ts`
- Create: `packages/opencode/src/plugin.test.ts`
- Modify: `packages/opencode/src/index.ts`

- [ ] **Step 1: Write failing tests for event mapping**

Create `packages/opencode/src/plugin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @jackdaw/protocol
vi.mock('@jackdaw/protocol', () => ({
  sendToJackdaw: vi.fn().mockResolvedValue(undefined),
  normalizeToolName: vi.fn((source: string, name: string) => {
    const map: Record<string, string> = { bash: 'shell', read: 'file_read', edit: 'file_edit' };
    return map[name] ?? name;
  }),
}));

import { sendToJackdaw } from '@jackdaw/protocol';
import { mapEventToPayloads, mapToolEvent } from './plugin';

const sendMock = vi.mocked(sendToJackdaw);

beforeEach(() => {
  sendMock.mockClear();
});

describe('mapEventToPayloads', () => {
  it('maps session.created to SessionStart', () => {
    const payloads = mapEventToPayloads({
      type: 'session.created',
      properties: { sessionId: 'ses-1', cwd: '/project' },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].hook_event_name).toBe('SessionStart');
    expect(payloads[0].session_id).toBe('ses-1');
    expect(payloads[0].cwd).toBe('/project');
    expect(payloads[0].source_tool).toBe('opencode');
  });

  it('maps session.idle to Stop', () => {
    const payloads = mapEventToPayloads({
      type: 'session.idle',
      properties: { sessionId: 'ses-1', cwd: '/project' },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].hook_event_name).toBe('Stop');
  });

  it('maps session.deleted to SessionEnd', () => {
    const payloads = mapEventToPayloads({
      type: 'session.deleted',
      properties: { sessionId: 'ses-1', cwd: '/project' },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].hook_event_name).toBe('SessionEnd');
  });

  it('maps permission.asked to PermissionRequest', () => {
    const payloads = mapEventToPayloads({
      type: 'permission.asked',
      properties: {
        sessionId: 'ses-1',
        cwd: '/project',
        toolName: 'bash',
        toolInput: { command: 'rm -rf /' },
      },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].hook_event_name).toBe('PermissionRequest');
    expect(payloads[0].tool_name).toBe('shell');
    expect(payloads[0].tool_input).toEqual({ command: 'rm -rf /' });
  });

  it('maps permission.replied to PermissionReply', () => {
    const payloads = mapEventToPayloads({
      type: 'permission.replied',
      properties: { sessionId: 'ses-1', cwd: '/project', approved: true },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].hook_event_name).toBe('PermissionReply');
  });

  it('returns empty array for unmapped events', () => {
    const payloads = mapEventToPayloads({
      type: 'lsp.updated',
      properties: {},
    });
    expect(payloads).toHaveLength(0);
  });
});

describe('mapToolEvent', () => {
  it('creates PreToolUse payload with normalized tool name', () => {
    const payload = mapToolEvent('before', {
      sessionId: 'ses-1',
      cwd: '/project',
      toolName: 'bash',
      toolUseId: 'tu-1',
      toolInput: { command: 'echo hi' },
    });
    expect(payload.hook_event_name).toBe('PreToolUse');
    expect(payload.tool_name).toBe('shell');
    expect(payload.tool_use_id).toBe('tu-1');
    expect(payload.source_tool).toBe('opencode');
  });

  it('creates PostToolUse payload with normalized tool name', () => {
    const payload = mapToolEvent('after', {
      sessionId: 'ses-1',
      cwd: '/project',
      toolName: 'read',
      toolUseId: 'tu-2',
      toolInput: { file_path: '/foo.ts' },
    });
    expect(payload.hook_event_name).toBe('PostToolUse');
    expect(payload.tool_name).toBe('file_read');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && npx vitest run`
Expected: FAIL — `./plugin` module not found.

- [ ] **Step 3: Implement plugin event mapping**

Create `packages/opencode/src/plugin.ts`:

```ts
import { sendToJackdaw, normalizeToolName } from '@jackdaw/protocol';
import type { HookPayload } from '@jackdaw/protocol';

interface OpenCodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

interface ToolHookContext {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
}

const EVENT_MAP: Record<string, string> = {
  'session.created': 'SessionStart',
  'session.idle': 'Stop',
  'session.deleted': 'SessionEnd',
  'permission.asked': 'PermissionRequest',
  'permission.replied': 'PermissionReply',
};

function basePayload(props: Record<string, unknown>): Pick<HookPayload, 'session_id' | 'cwd' | 'source_tool'> {
  return {
    session_id: String(props.sessionId ?? ''),
    cwd: String(props.cwd ?? ''),
    source_tool: 'opencode',
  };
}

export function mapEventToPayloads(event: OpenCodeEvent): HookPayload[] {
  const eventName = EVENT_MAP[event.type];
  if (!eventName) return [];

  const payload: HookPayload = {
    ...basePayload(event.properties),
    hook_event_name: eventName,
  };

  if (event.type === 'permission.asked' && event.properties.toolName) {
    payload.tool_name = normalizeToolName('opencode', String(event.properties.toolName));
    if (event.properties.toolInput) {
      payload.tool_input = event.properties.toolInput as Record<string, unknown>;
    }
  }

  return [payload];
}

export function mapToolEvent(
  phase: 'before' | 'after',
  ctx: ToolHookContext,
): HookPayload {
  return {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: phase === 'before' ? 'PreToolUse' : 'PostToolUse',
    tool_name: normalizeToolName('opencode', ctx.toolName),
    tool_use_id: ctx.toolUseId,
    tool_input: ctx.toolInput,
    source_tool: 'opencode',
  };
}

export async function handleEvent(event: OpenCodeEvent): Promise<void> {
  const payloads = mapEventToPayloads(event);
  for (const payload of payloads) {
    await sendToJackdaw(payload);
  }
}

export async function handleToolBefore(ctx: ToolHookContext): Promise<void> {
  await sendToJackdaw(mapToolEvent('before', ctx));
}

export async function handleToolAfter(ctx: ToolHookContext): Promise<void> {
  await sendToJackdaw(mapToolEvent('after', ctx));
}
```

- [ ] **Step 4: Update index.ts exports**

Update `packages/opencode/src/index.ts`:

```ts
export { handleEvent, handleToolBefore, handleToolAfter } from './plugin';
export { mapEventToPayloads, mapToolEvent } from './plugin';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/opencode && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/
git commit -m "feat(opencode): add OpenCode plugin with event mapping to Jackdaw protocol"
```

---

### Task 5: Backend — Add `source_tool` Field

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Write failing test for `source_tool` on HookPayload**

Add to the `#[cfg(test)]` module in `src-tauri/src/state.rs`:

```rust
#[test]
fn hook_payload_deserializes_source_tool() {
    let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart","source_tool":"opencode"}"#;
    let payload: HookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.source_tool.as_deref(), Some("opencode"));
}

#[test]
fn hook_payload_source_tool_defaults_to_none() {
    let json = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionStart"}"#;
    let payload: HookPayload = serde_json::from_str(json).unwrap();
    assert!(payload.source_tool.is_none());
}

#[test]
fn session_serializes_source_tool() {
    let mut session = Session::new("s1".into(), "/tmp".into());
    session.source_tool = Some("opencode".into());
    let json = serde_json::to_value(&session).unwrap();
    assert_eq!(json["source_tool"], "opencode");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `source_tool` field not found.

- [ ] **Step 3: Add `source_tool` to `HookPayload`**

In `src-tauri/src/state.rs`, add to `HookPayload` struct after `spawned_session`:

```rust
    #[serde(default)]
    pub source_tool: Option<String>,
```

- [ ] **Step 4: Add `source_tool` to `Session`**

In `src-tauri/src/state.rs`, add to `Session` struct after `alert_tier`:

```rust
    pub source_tool: Option<String>,
```

And in `Session::new()`, add to the initializer:

```rust
    source_tool: None,
```

- [ ] **Step 5: Run Rust tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS.

- [ ] **Step 6: Add `source_tool` to TypeScript `Session` interface**

In `src/lib/types.ts`, add to the `Session` interface after `alert_tier`:

```ts
  source_tool: string | null;
```

- [ ] **Step 7: Run frontend type check**

Run: `npm run check`
Expected: PASS (or type errors if `source_tool` is accessed somewhere — fix as needed).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/state.rs src/lib/types.ts
git commit -m "feat: add source_tool field to HookPayload and Session"
```

---

### Task 6: Backend — Add `PermissionRequest` and `PermissionReply` Events

**Files:**
- Modify: `src-tauri/src/server.rs`
- Modify: `src-tauri/src/hooks.rs` (add new hook events)
- Modify: `src-tauri/src/notify.rs` (alert tier for PermissionRequest)

- [ ] **Step 1: Write failing tests for new event types**

Add to the `#[cfg(test)]` module in `src-tauri/src/server.rs`:

```rust
#[test]
fn permission_request_sets_pending_approval() {
    let state = test_state();
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;
        sessions.insert("s1".into(), session);
    }

    let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"PermissionRequest","tool_name":"shell","source_tool":"opencode"}"#;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(handle_event_test(&state, payload));

    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get("s1").unwrap();
    assert!(session.pending_approval);
    assert!(session.has_unread);
}

#[test]
fn permission_reply_clears_pending_approval() {
    let state = test_state();
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;
        session.pending_approval = true;
        sessions.insert("s1".into(), session);
    }

    let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"PermissionReply","source_tool":"opencode"}"#;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(handle_event_test(&state, payload));

    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get("s1").unwrap();
    assert!(!session.pending_approval);
}

#[test]
fn notification_still_works_as_permission_request() {
    let state = test_state();
    {
        let mut sessions = state.sessions.lock().unwrap();
        let mut session = Session::new("s1".into(), "/tmp".into());
        session.processing = true;
        sessions.insert("s1".into(), session);
    }

    let payload = r#"{"session_id":"s1","cwd":"/tmp","hook_event_name":"Notification"}"#;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(handle_event_test(&state, payload));

    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get("s1").unwrap();
    assert!(session.pending_approval);
    assert!(session.has_unread);
}
```

Note: These tests rely on existing test helpers `test_state()` and `handle_event_test()` in server.rs. If these don't exist, check the existing test module and use the equivalent helpers.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `PermissionRequest` and `PermissionReply` not handled in `handle_event`.

- [ ] **Step 3: Add event handlers in `server.rs`**

In `src-tauri/src/server.rs`, in the `handle_event` function's match block (around line 228), add these arms before the `_ => {}` catch-all:

```rust
            "PermissionRequest" => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    if session.processing {
                        session.pending_approval = true;
                        session.has_unread = true;
                    }
                }
            }
            "PermissionReply" => {
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.pending_approval = false;
                }
            }
```

The existing `"Notification"` arm stays as-is for backwards compatibility — it already has the same behavior as `PermissionRequest`.

- [ ] **Step 4: Store `source_tool` when creating sessions**

In `server.rs`'s `handle_event`, where new sessions are created (around line 197), set `source_tool` from the payload. After `sessions.insert(session_id.clone(), session);`, add:

```rust
                // Store source_tool from the payload that created this session
                if let Some(session) = sessions.get_mut(&session_id) {
                    session.source_tool = payload_source_tool.clone();
                }
```

This requires extracting `payload.source_tool` into a local variable alongside the other destructured fields near line 162:

```rust
    let payload_source_tool = payload.source_tool;
```

- [ ] **Step 5: Add `PermissionRequest` to alert tier resolution**

In `src-tauri/src/notify.rs`, in `resolve_alert_tier`, add a match arm for `"PermissionRequest"` that maps to `prefs.on_approval_needed` (same as `"Notification"`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/server.rs src-tauri/src/notify.rs
git commit -m "feat: add PermissionRequest and PermissionReply event types"
```

---

### Task 7: Backend — Normalize Tool Names in `extract_summary`

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Write failing tests for canonical tool names**

Add to the `#[cfg(test)]` module in `src-tauri/src/state.rs`:

```rust
#[test]
fn extract_summary_canonical_shell() {
    let input = serde_json::json!({"command": "ls -la"});
    assert_eq!(extract_summary("shell", &Some(input)), Some("ls -la".into()));
}

#[test]
fn extract_summary_canonical_file_read() {
    let input = serde_json::json!({"file_path": "/foo/bar.rs"});
    assert_eq!(extract_summary("file_read", &Some(input)), Some("/foo/bar.rs".into()));
}

#[test]
fn extract_summary_canonical_file_write() {
    let input = serde_json::json!({"file_path": "/foo/out.txt"});
    assert_eq!(extract_summary("file_write", &Some(input)), Some("/foo/out.txt".into()));
}

#[test]
fn extract_summary_canonical_file_edit() {
    let input = serde_json::json!({"file_path": "/foo/bar.rs"});
    assert_eq!(extract_summary("file_edit", &Some(input)), Some("/foo/bar.rs".into()));
}

#[test]
fn extract_summary_canonical_file_search() {
    let input = serde_json::json!({"pattern": "**/*.rs"});
    assert_eq!(extract_summary("file_search", &Some(input)), Some("**/*.rs".into()));
}

#[test]
fn extract_summary_canonical_content_search() {
    let input = serde_json::json!({"pattern": "fn main"});
    assert_eq!(extract_summary("content_search", &Some(input)), Some("fn main".into()));
}

#[test]
fn extract_summary_canonical_agent() {
    let input = serde_json::json!({"description": "search for foo"});
    assert_eq!(extract_summary("agent", &Some(input)), Some("search for foo".into()));
}

#[test]
fn extract_summary_claude_code_names_still_work() {
    let input = serde_json::json!({"command": "echo hi"});
    assert_eq!(extract_summary("Bash", &Some(input)), Some("echo hi".into()));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL — canonical names like `"shell"` return `None`.

- [ ] **Step 3: Update `extract_summary` to handle canonical names**

Replace the `extract_summary` function in `src-tauri/src/state.rs`:

```rust
pub fn extract_summary(tool_name: &str, tool_input: &Option<serde_json::Value>) -> Option<String> {
    let input = tool_input.as_ref()?;
    let value = match tool_name {
        // Canonical names (from @jackdaw/protocol)
        "shell" | "Bash" => input.get("command")?.as_str(),
        "file_edit" | "file_read" | "file_write" | "Edit" | "Read" | "Write" => {
            input.get("file_path")?.as_str()
        }
        "file_search" | "content_search" | "Glob" | "Grep" => input.get("pattern")?.as_str(),
        "agent" | "Agent" => input.get("description")?.as_str(),
        _ => None,
    };
    value.map(|s| s.chars().take(120).collect())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat: normalize tool names in extract_summary for cross-tool support"
```

---

### Task 8: Frontend — Source Tool Display and Tool Name Labels

**Files:**
- Modify: `src/lib/components/ToolIcon.svelte`
- Modify: `src/lib/components/SessionCard.svelte`
- Create: `src/lib/tools.ts`
- Create: `src/lib/tools.test.ts`

- [ ] **Step 1: Write failing test for `displayToolName`**

Create `src/lib/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { displayToolName } from './tools';

describe('displayToolName', () => {
  it('converts canonical names to human-friendly labels', () => {
    expect(displayToolName('shell')).toBe('Shell');
    expect(displayToolName('file_read')).toBe('File Read');
    expect(displayToolName('file_write')).toBe('File Write');
    expect(displayToolName('file_edit')).toBe('File Edit');
    expect(displayToolName('file_search')).toBe('File Search');
    expect(displayToolName('content_search')).toBe('Content Search');
    expect(displayToolName('agent')).toBe('Agent');
    expect(displayToolName('web_fetch')).toBe('Web Fetch');
    expect(displayToolName('web_search')).toBe('Web Search');
  });

  it('passes through Claude Code names unchanged', () => {
    expect(displayToolName('Bash')).toBe('Bash');
    expect(displayToolName('Read')).toBe('Read');
    expect(displayToolName('Agent')).toBe('Agent');
  });

  it('passes through unknown names unchanged', () => {
    expect(displayToolName('CustomTool')).toBe('CustomTool');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./tools` module not found.

- [ ] **Step 3: Implement `displayToolName`**

Create `src/lib/tools.ts`:

```ts
const DISPLAY_NAMES: Record<string, string> = {
  shell: 'Shell',
  file_read: 'File Read',
  file_write: 'File Write',
  file_edit: 'File Edit',
  file_search: 'File Search',
  content_search: 'Content Search',
  agent: 'Agent',
  web_fetch: 'Web Fetch',
  web_search: 'Web Search',
};

export function displayToolName(toolName: string): string {
  return DISPLAY_NAMES[toolName] ?? toolName;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 5: Update `ToolIcon.svelte` to handle canonical names**

In `src/lib/components/ToolIcon.svelte`, update the `toolConfig` to include canonical names:

```ts
  const toolConfig: Record<string, { icon: typeof Terminal; colorClass: string }> = {
    // Canonical names
    shell: { icon: Terminal, colorClass: 'tool-green' },
    file_read: { icon: FileText, colorClass: 'tool-blue' },
    file_edit: { icon: Pencil, colorClass: 'tool-orange' },
    file_write: { icon: FilePlus, colorClass: 'tool-orange' },
    file_search: { icon: FolderSearch, colorClass: 'tool-purple' },
    content_search: { icon: Search, colorClass: 'tool-purple' },
    agent: { icon: Bot, colorClass: 'tool-cyan' },
    // Claude Code names (backwards compat)
    Bash: { icon: Terminal, colorClass: 'tool-green' },
    Read: { icon: FileText, colorClass: 'tool-blue' },
    Edit: { icon: Pencil, colorClass: 'tool-orange' },
    Write: { icon: FilePlus, colorClass: 'tool-orange' },
    Glob: { icon: FolderSearch, colorClass: 'tool-purple' },
    Grep: { icon: Search, colorClass: 'tool-purple' },
    Agent: { icon: Bot, colorClass: 'tool-cyan' },
  };
```

- [ ] **Step 6: Update `SessionCard.svelte` to display human-friendly tool names and source tool**

In `src/lib/components/SessionCard.svelte`:

Add import:
```ts
  import { displayToolName } from '$lib/tools';
```

In the tool display section (around line 153), change:
```svelte
          <span class="tool-name">{session.current_tool.tool_name}</span>
```
to:
```svelte
          <span class="tool-name">{displayToolName(session.current_tool.tool_name)}</span>
```

In the metadata row section (after the git branch block, around line 136), add the source tool label:
```svelte
  {#if session.source_tool && session.source_tool !== 'claude-code'}
    <div class="metadata-row">
      <span class="source-label">{session.source_tool}</span>
    </div>
  {/if}
```

Add CSS for the source label in the `<style>` block:
```css
  .source-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
```

- [ ] **Step 7: Also update tool names in expanded history section**

In `SessionCard.svelte`, find where `recentHistory` is rendered (the expanded section showing tool history). Each tool history item shows `tool.tool_name` — wrap it with `displayToolName()`:

Find the history rendering (likely around line 175+) and change tool name references from:
```svelte
{tool.tool_name}
```
to:
```svelte
{displayToolName(tool.tool_name)}
```

- [ ] **Step 8: Run type check and tests**

Run: `npm run check && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tools.ts src/lib/tools.test.ts src/lib/components/ToolIcon.svelte src/lib/components/SessionCard.svelte
git commit -m "feat: display human-friendly tool names and source tool indicator"
```

---

### Task 9: Backend — Clean Up `jackdaw-send` References

**Files:**
- Modify: `src-tauri/src/hooks.rs`

- [ ] **Step 1: Verify existing tests document current behavior**

Run: `cd src-tauri && cargo test hooks`
Expected: All hooks tests PASS (baseline).

- [ ] **Step 2: Update `HOOK_EVENTS` to include new event types**

In `src-tauri/src/hooks.rs`, update the `HOOK_EVENTS` array (line 34) to include the new events:

```rust
const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
    "UserPromptSubmit",
    "SubagentStart",
    "SubagentStop",
    "Notification",
];
```

Note: `PermissionRequest` and `PermissionReply` are NOT added here — these are OpenCode-specific events sent by the OpenCode plugin, not Claude Code hooks. Claude Code will continue sending `Notification` which Jackdaw already handles. The `HOOK_EVENTS` array only lists Claude Code hook event names.

- [ ] **Step 3: Clean up `is_jackdaw_matcher_group` detection**

The detection in `is_jackdaw_matcher_group` (line 134) already handles both `"jackdaw-send"` and `"jackdaw" + "send"`. This backwards compat is still useful for users who haven't re-installed hooks yet. No change needed here.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test hooks`
Expected: All hooks tests PASS.

- [ ] **Step 5: Commit** (only if changes were made)

```bash
git add src-tauri/src/hooks.rs
git commit -m "chore: clean up hook event references"
```

---

### Task 10: Integration Testing and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS.

- [ ] **Step 2: Run all frontend tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Run all package tests**

Run: `cd packages/protocol && npx vitest run && cd ../opencode && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Build verification**

Run: `npm run tauri build`
Expected: Build succeeds.

- [ ] **Step 6: Manual smoke test**

1. Start Jackdaw (`npm run tauri dev`)
2. Send a test event with `source_tool` via the socket:
```bash
echo '{"session_id":"test-oc","cwd":"/tmp","hook_event_name":"SessionStart","source_tool":"opencode"}' | jackdaw send
```
3. Verify session appears in dashboard with "opencode" source label
4. Send a tool event with canonical name:
```bash
echo '{"session_id":"test-oc","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"shell","tool_input":{"command":"echo hello"},"source_tool":"opencode"}' | jackdaw send
```
5. Verify tool shows as "Shell" with correct icon
6. Send PermissionRequest:
```bash
echo '{"session_id":"test-oc","cwd":"/tmp","hook_event_name":"PermissionRequest","tool_name":"shell","source_tool":"opencode"}' | jackdaw send
```
7. Verify APPROVAL badge appears
8. Send PermissionReply:
```bash
echo '{"session_id":"test-oc","cwd":"/tmp","hook_event_name":"PermissionReply","source_tool":"opencode"}' | jackdaw send
```
9. Verify APPROVAL badge clears

- [ ] **Step 7: Final commit** (if any fixes needed)
