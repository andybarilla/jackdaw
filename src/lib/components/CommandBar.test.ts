// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CommandBar from './CommandBar.svelte';
import type { CustomCommand } from '$lib/types';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() =>
    Promise.resolve({ stdout: 'ok\n', stderr: '', exit_code: 0, timed_out: false })
  ),
}));

function makeCommands(count: number): CustomCommand[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Cmd${i + 1}`,
    command: `echo ${i + 1}`,
    icon: null,
    timeout: 30,
  }));
}

describe('CommandBar', () => {
  it('renders up to 3 command buttons', () => {
    render(CommandBar, { props: { commands: makeCommands(3), cwd: '/tmp' } });
    expect(screen.getByText('Cmd1')).toBeTruthy();
    expect(screen.getByText('Cmd2')).toBeTruthy();
    expect(screen.getByText('Cmd3')).toBeTruthy();
  });

  it('shows overflow button when more than 3 commands', () => {
    render(CommandBar, { props: { commands: makeCommands(5), cwd: '/tmp' } });
    expect(screen.getByText('Cmd1')).toBeTruthy();
    expect(screen.getByText('Cmd2')).toBeTruthy();
    expect(screen.getByText('Cmd3')).toBeTruthy();
    expect(screen.getByText('···')).toBeTruthy();
    // Cmd4 and Cmd5 should not be visible until overflow is opened
    expect(screen.queryByText('Cmd4')).toBeNull();
  });

  it('renders no buttons when commands array is empty', () => {
    const { container } = render(CommandBar, { props: { commands: [], cwd: '/tmp' } });
    const buttons = container.querySelectorAll('.cmd-btn');
    expect(buttons.length).toBe(0);
  });
});
