<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { SearchAddon } from "@xterm/addon-search";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { AttachSession, GetSessionHistory, GetWSPort } from "../../wailsjs/go/main/App";
  import { connectSession, type WSConnection } from "./ws";
  import "@xterm/xterm/css/xterm.css";
  import {
    getTheme,
    getKeymap,
    getTerminalFontFamily,
    getTerminalFontSize,
  } from "./config.svelte";
  import { getXtermTheme } from "./themes";
  import { matchKeybinding } from "./keybindings";
  import type { TerminalApi } from "./types";

  interface Props {
    sessionId: string;
    visible?: boolean;
    readonly?: boolean;
    onReady?: (api: TerminalApi) => void;
    onOpenUrl?: (url: string) => void;
  }

  let { sessionId, visible = true, readonly = false, onReady, onOpenUrl }: Props = $props();
  let terminalEl: HTMLDivElement;
  let terminal = $state<Terminal | undefined>(undefined);
  let fitAddon: FitAddon;
  let searchAddon: SearchAddon;
  let cleanups: Array<() => void> = [];
  let wsConn: WSConnection | undefined;

  let opened = false;
  let currentlyVisible = false;
  let rafId: number | undefined;

  function fitAndRefresh(): void {
    fitAddon.fit();
    terminal!.refresh(0, terminal!.rows - 1);
  }

  $effect(() => {
    currentlyVisible = visible;

    if (!visible || !terminal) {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
      return;
    }

    const term = terminal;

    if (!opened) {
      opened = true;
      term.open(terminalEl);

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available, fall back to canvas renderer
      }

      fitAndRefresh();

      // Replay history before subscribing to live output
      GetSessionHistory(sessionId).then((history) => {
        if (history) term.write(history);
      }).catch(() => {});

      if (!readonly) {
        // Connect WebSocket for terminal I/O
        GetWSPort().then((port) => {
          if (port <= 0) return;
          wsConn = connectSession(port, sessionId, (data) => {
            term.write(data);
          }, () => {
            // Send initial resize on connect/reconnect
            if (term.cols > 0 && term.rows > 0) {
              wsConn?.resize(term.cols, term.rows);
            }
          });
          cleanups.push(() => {
            wsConn?.close();
            wsConn = undefined;
          });
        }).catch(() => {});

        const inputDisposable = term.onData((data: string) => {
          wsConn?.send(data);
        });
        cleanups.push(() => inputDisposable.dispose());
      }

      let resizeTimer: ReturnType<typeof setTimeout>;
      const resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!currentlyVisible) return;
          fitAndRefresh();
          if (!readonly && term.cols > 0 && term.rows > 0) {
            wsConn?.resize(term.cols, term.rows);
          }
        }, 50);
      });
      resizeObserver.observe(terminalEl);

      const handlePaneResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!currentlyVisible) return;
          fitAndRefresh();
          if (!readonly && term.cols > 0 && term.rows > 0) {
            wsConn?.resize(term.cols, term.rows);
          }
        }, 50);
      };
      window.addEventListener("pane-resize", handlePaneResize);

      cleanups.push(() => {
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        window.removeEventListener("pane-resize", handlePaneResize);
      });

      if (!readonly) {
        // Initial resize will be sent once WS connects
        AttachSession(sessionId).catch(() => {
          // Plain terminals don't need AttachSession
        });
      }

      onReady?.({ searchAddon, focus: () => term.focus(), send: (data: string) => wsConn?.send(data) });
    } else {
      // Already opened, just becoming visible again — double-rAF for layout settle
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          rafId = undefined;
          fitAndRefresh();
          if (term.cols > 0 && term.rows > 0) {
            wsConn?.resize(term.cols, term.rows);
          }
        });
      });
    }

    return () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    };
  });

  $effect(() => {
    const family = getTerminalFontFamily();
    const size = getTerminalFontSize();
    if (!terminal || !opened) return;
    terminal.options.fontFamily = family;
    terminal.options.fontSize = size;
    fitAddon.fit();
  });

  onMount(() => {
    terminal = new Terminal({
      cursorBlink: !readonly,
      disableStdin: readonly,
      fontSize: getTerminalFontSize(),
      fontFamily: getTerminalFontFamily(),
      theme: getXtermTheme(getTheme()),
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, url) => {
      if (onOpenUrl) {
        onOpenUrl(url);
      } else {
        window.open(url);
      }
    }));
    searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);

    // Let app-level keybindings pass through xterm
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (matchKeybinding(event, getKeymap())) {
        return false; // don't handle — let it bubble to window handler
      }
      return true;
    });
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
