<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { Terminal as XTerm } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { TerminalOutputPayload, TerminalExitedPayload } from '$lib/types';

  interface Props {
    ptyId: string;
  }

  let { ptyId }: Props = $props();

  let containerEl: HTMLDivElement;
  let exited = $state(false);

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

    const dataDisposable = term.onData((data: string) => {
      const encoded = btoa(data);
      invoke('write_terminal', { sessionId: ptyId, data: encoded });
    });

    let unlistenOutput: (() => void) | undefined;
    listen<TerminalOutputPayload>('terminal-output', (event) => {
      if (event.payload.session_id !== ptyId) return;
      const bytes = Uint8Array.from(atob(event.payload.data), (c) => c.charCodeAt(0));
      term.write(bytes);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    let unlistenExit: (() => void) | undefined;
    listen<TerminalExitedPayload>('terminal-exited', (event) => {
      if (event.payload.session_id !== ptyId) return;
      exited = true;
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    }).then((fn) => {
      unlistenExit = fn;
    });

    // Use ResizeObserver for both initial sizing and subsequent resizes.
    // The first callback fires once the container has resolved dimensions.
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      fitAddon.fit();
      if (!exited) {
        invoke('resize_terminal', {
          sessionId: ptyId,
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

<div class="terminal-wrapper">
  <div class="terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .terminal-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .terminal-container {
    position: absolute;
    inset: 0;
    padding: 8px;
  }

  .terminal-container :global(.xterm) {
    height: 100%;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
