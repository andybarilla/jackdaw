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

  let { sessionId: initialSessionId }: Props = $props();

  let containerEl: HTMLDivElement;
  let exited = $state(false);
  let exitCode = $state<number | null>(null);
  // Mutable ID that tracks rekeys — the PTY session ID changes when Claude hooks link it
  let currentSessionId = initialSessionId;

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
        sessionId: currentSessionId,
        cols: term.cols,
        rows: term.rows,
      });
    });

    // Forward keystrokes to PTY
    const dataDisposable = term.onData((data: string) => {
      const encoded = btoa(data);
      invoke('write_terminal', { sessionId: currentSessionId, data: encoded });
    });

    // Listen for session rekey (when Claude hooks link the PTY session to Claude's session ID)
    let unlistenRekey: (() => void) | undefined;
    listen<{ old_id: string; new_id: string }>('session-rekey', (event) => {
      if (event.payload.old_id === currentSessionId) {
        currentSessionId = event.payload.new_id;
      }
    }).then((fn) => { unlistenRekey = fn; });

    // Listen for PTY output — match on both old and new IDs since the reader thread
    // may still emit with the original PTY session ID
    let unlistenOutput: (() => void) | undefined;
    listen<TerminalOutputPayload>('terminal-output', (event) => {
      if (event.payload.session_id !== currentSessionId && event.payload.session_id !== initialSessionId) return;
      const bytes = Uint8Array.from(atob(event.payload.data), (c) => c.charCodeAt(0));
      term.write(bytes);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    // Listen for PTY exit
    let unlistenExit: (() => void) | undefined;
    listen<TerminalExitedPayload>('terminal-exited', (event) => {
      if (event.payload.session_id !== currentSessionId && event.payload.session_id !== initialSessionId) return;
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
          sessionId: currentSessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(containerEl);

    return () => {
      dataDisposable.dispose();
      unlistenRekey?.();
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
