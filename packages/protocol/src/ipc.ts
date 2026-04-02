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
