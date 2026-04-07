<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { EventsOn, EventsEmit } from "../../wailsjs/runtime/runtime";
  import { AttachSession } from "../../wailsjs/go/main/App";
  import "@xterm/xterm/css/xterm.css";
  import { getTheme } from "./config.svelte";
  import { getXtermTheme } from "./themes";

  interface Props {
    sessionId: string;
    visible?: boolean;
  }

  let { sessionId, visible = true }: Props = $props();
  let terminalEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let cleanups: Array<() => void> = [];

  $effect(() => {
    if (visible && fitAddon) {
      // Re-fit after becoming visible so xterm measures correctly
      requestAnimationFrame(() => fitAddon.fit());
    }
  });

  onMount(() => {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: getXtermTheme(getTheme()),
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

    // Start the read loop on the backend — ensures replay arrives after we're subscribed
    AttachSession(sessionId);
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
