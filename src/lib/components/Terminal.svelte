<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { TerminalOutputPayload, TerminalExitedPayload } from '$lib/types';

  interface Props {
    sessionId: string;
  }

  let { sessionId }: Props = $props();

  let containerEl: HTMLDivElement;
  let exited = $state(false);
  let exitCode = $state<number | null>(null);

  onMount(() => {
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#ff2d7840',
      },
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);

    // Initial fit after rendering
    requestAnimationFrame(() => {
      fitAddon.fit();
      invoke('resize_terminal', {
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    });

    // Forward keystrokes to PTY
    const dataDisposable = term.onData((data: string) => {
      const encoded = btoa(data);
      invoke('write_terminal', { sessionId, data: encoded });
    });

    // Listen for PTY output
    let unlistenOutput: (() => void) | undefined;
    listen<TerminalOutputPayload>('terminal-output', (event) => {
      if (event.payload.session_id !== sessionId) return;
      const bytes = Uint8Array.from(atob(event.payload.data), (c) => c.charCodeAt(0));
      term.write(bytes);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    // Listen for PTY exit
    let unlistenExit: (() => void) | undefined;
    listen<TerminalExitedPayload>('terminal-exited', (event) => {
      if (event.payload.session_id !== sessionId) return;
      exited = true;
      exitCode = event.payload.exit_code;
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    }).then((fn) => {
      unlistenExit = fn;
    });

    // Resize on container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (!exited) {
        invoke('resize_terminal', {
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(containerEl);

    return () => {
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      term.dispose();
    };
  });
</script>

<div class="terminal-container" bind:this={containerEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .terminal-container :global(.xterm) {
    height: 100%;
    padding: 8px;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
