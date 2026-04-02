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
