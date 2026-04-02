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
