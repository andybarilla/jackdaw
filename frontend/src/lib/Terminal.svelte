<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { SearchAddon } from "@xterm/addon-search";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { EventsOn, EventsEmit } from "../../wailsjs/runtime/runtime";
  import { AttachSession } from "../../wailsjs/go/main/App";
  import "@xterm/xterm/css/xterm.css";
  import { getTheme } from "./config.svelte";
  import { getXtermTheme } from "./themes";
  import type { TerminalApi } from "./types";

  interface Props {
    sessionId: string;
    visible?: boolean;
    onReady?: (api: TerminalApi) => void;
  }

  let { sessionId, visible = true, onReady }: Props = $props();
  let terminalEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let searchAddon: SearchAddon;
  let cleanups: Array<() => void> = [];

  let opened = false;

  function fitAndRefresh(): void {
    fitAddon.fit();
    terminal.refresh(0, terminal.rows - 1);
  }

  $effect(() => {
    if (!visible || !terminal) return;

    if (!opened) {
      opened = true;
      terminal.open(terminalEl);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL not available, fall back to canvas renderer
      }

      fitAndRefresh();

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

      let resizeTimer: ReturnType<typeof setTimeout>;
      const resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!visible) return;
          fitAndRefresh();
          if (terminal.cols > 0 && terminal.rows > 0) {
            EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
          }
        }, 50);
      });
      resizeObserver.observe(terminalEl);
      cleanups.push(() => {
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
      });

      EventsEmit("terminal-resize", sessionId, terminal.cols, terminal.rows);
      AttachSession(sessionId);

      onReady?.({ searchAddon, focus: () => terminal.focus() });
    } else {
      // Already opened, just becoming visible again — double-rAF for layout settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitAndRefresh();
        });
      });
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
    searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
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
