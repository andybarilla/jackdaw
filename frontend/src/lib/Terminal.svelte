<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { EventsOn, EventsEmit } from "../../wailsjs/runtime/runtime";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    sessionId: string;
  }

  let { sessionId }: Props = $props();
  let terminalEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let cleanups: Array<() => void> = [];

  onMount(() => {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
      },
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(terminalEl);

    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    fitAddon.fit();

    terminal.onData((data: string) => {
      EventsEmit("terminal-input", sessionId, data);
    });

    const cancelOutput = EventsOn(
      `terminal-output-${sessionId}`,
      (data: string) => {
        terminal.write(data);
      },
    );
    cleanups.push(cancelOutput);

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
    });
    resizeObserver.observe(terminalEl);
    cleanups.push(() => resizeObserver.disconnect());

    EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
    terminal?.dispose();
  });
</script>

<div class="terminal-container" bind:this={terminalEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
  }
</style>
