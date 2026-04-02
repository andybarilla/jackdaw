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
