<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn, EventsEmit } from "../wailsjs/runtime/runtime";
  import {
    CreateSession,
    ListSessions,
    KillSession,
    RenameSession,
    CreateTerminal,
    KillTerminal,
    GetConfig,
    SetConfig,
    DismissNotification,
    GetWorktreeStatus,
    CleanupWorktree,
  } from "../wailsjs/go/main/App";
  import type { LayoutNode, PaneContent, Path } from "./lib/layout";
  import {
    emptyLeaf,
    splitLeaf,
    closeLeaf,
    updateRatio,
    setLeafContent,
    getLeafContent,
    findLeafBySessionId,
    findLeafByTerminalId,
    collectSessionIds,
    collectTerminalIds,
  } from "./lib/layout";
  import type { SessionInfo, TerminalApi, AppNotification, WorktreeStatus } from "./lib/types";
  import { addNotification, dismissNotification } from "./lib/notifications.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import ToastContainer from "./lib/ToastContainer.svelte";
  import SplitPane from "./lib/SplitPane.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";
  import WorktreeCleanupDialog from "./lib/WorktreeCleanupDialog.svelte";
  import { getKeymap, getToastDuration } from "./lib/config.svelte";
  import { matchKeybinding } from "./lib/keybindings";

  let sessions = $state<SessionInfo[]>([]);
  let layoutTree = $state<LayoutNode>(emptyLeaf());
  let focusedPath = $state<number[]>([]);
  let showNewDialog = $state(false);
  let sidebarVisible = $state(true);
  let searchVisible = $state(false);
  let terminalApis = $state<Record<string, TerminalApi>>({});
  let cleanups: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingQuickPickPath: number[] | null = null;
  let worktreeCleanup = $state<{
    sessionId: string;
    sessionName: string;
    branchName: string;
    status: WorktreeStatus | null;
  } | null>(null);

  function collectLeafPaths(node: LayoutNode, prefix: number[] = []): number[][] {
    if (node.type === "leaf") return [prefix];
    return [
      ...collectLeafPaths(node.children[0], [...prefix, 0]),
      ...collectLeafPaths(node.children[1], [...prefix, 1]),
    ];
  }

  function pathsEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function cycleFocus(delta: number): void {
    const paths = collectLeafPaths(layoutTree);
    if (paths.length === 0) return;
    const currentIdx = paths.findIndex((p) => pathsEqual(p, focusedPath));
    const nextIdx = (currentIdx + delta + paths.length) % paths.length;
    focusedPath = paths[nextIdx];
    focusTerminalAtPath(focusedPath);
  }

  function asPath(p: number[]): Path {
    return p as Path;
  }

  function focusTerminalAtPath(path: number[]): void {
    try {
      const content = getLeafContent(layoutTree, asPath(path));
      if (content) {
        const id = content.type === "session" ? content.sessionId : content.id;
        requestAnimationFrame(() => terminalApis[id]?.focus());
      }
    } catch {
      // path invalid, ignore
    }
  }

  function getFocusedContent(): PaneContent {
    try {
      return getLeafContent(layoutTree, asPath(focusedPath));
    } catch {
      return null;
    }
  }

  function getWorkDirFromSiblingPane(): string {
    // Try to find a sibling pane's workdir
    if (focusedPath.length > 0) {
      const siblingPath = [...focusedPath];
      siblingPath[siblingPath.length - 1] = siblingPath[siblingPath.length - 1] === 0 ? 1 : 0;
      try {
        const sibContent = getLeafContent(layoutTree, asPath(siblingPath));
        if (sibContent?.type === "session") {
          const s = sessions.find((sess) => sess.id === sibContent.sessionId);
          if (s) return s.work_dir;
        } else if (sibContent?.type === "terminal") {
          return sibContent.workDir;
        }
      } catch {
        // ignore
      }
    }
    return "~";
  }

  const actions: Record<string, () => void> = {
    "session.new": () => (showNewDialog = true),
    "session.kill": () => {
      const content = getFocusedContent();
      if (content?.type === "session") handleKill(content.sessionId);
    },
    "session.next": () => {
      if (sessions.length === 0) return;
      const content = getFocusedContent();
      const currentId = content?.type === "session" ? content.sessionId : null;
      const currentIdx = currentId ? sessions.findIndex((s) => s.id === currentId) : -1;
      const nextIdx = (currentIdx + 1) % sessions.length;
      const nextSession = sessions[nextIdx];
      const path = findLeafBySessionId(layoutTree, nextSession.id);
      if (path) {
        focusedPath = path;
        focusTerminalAtPath(path);
      }
    },
    "session.prev": () => {
      if (sessions.length === 0) return;
      const content = getFocusedContent();
      const currentId = content?.type === "session" ? content.sessionId : null;
      const currentIdx = currentId ? sessions.findIndex((s) => s.id === currentId) : -1;
      const prevIdx = (currentIdx - 1 + sessions.length) % sessions.length;
      const prevSession = sessions[prevIdx];
      const path = findLeafBySessionId(layoutTree, prevSession.id);
      if (path) {
        focusedPath = path;
        focusTerminalAtPath(path);
      }
    },
    "app.toggleSidebar": () => (sidebarVisible = !sidebarVisible),
    "terminal.search": () => {
      const content = getFocusedContent();
      if (content) searchVisible = !searchVisible;
    },
    "pane.splitVertical": () => {
      layoutTree = splitLeaf(layoutTree, asPath(focusedPath), "vertical");
      focusedPath = [...focusedPath, 1];
    },
    "pane.splitHorizontal": () => {
      layoutTree = splitLeaf(layoutTree, asPath(focusedPath), "horizontal");
      focusedPath = [...focusedPath, 1];
    },
    "pane.close": () => handleClosePane(),
    "pane.focusUp": () => cycleFocus(-1),
    "pane.focusDown": () => cycleFocus(1),
    "pane.focusLeft": () => cycleFocus(-1),
    "pane.focusRight": () => cycleFocus(1),
  };

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const action = matchKeybinding(event, getKeymap());
    if (action && actions[action]) {
      event.preventDefault();
      actions[action]();
    }
  }

  function collapsePane(path: number[]): void {
    const paths = collectLeafPaths(layoutTree);
    if (paths.length <= 1) {
      layoutTree = emptyLeaf();
      focusedPath = [];
      return;
    }

    layoutTree = closeLeaf(layoutTree, asPath(path));
    const newPaths = collectLeafPaths(layoutTree);
    focusedPath = newPaths[0] ?? [];
    focusTerminalAtPath(focusedPath);
  }

  async function handleClosePane(): Promise<void> {
    const content = getFocusedContent();
    if (content) {
      const id = content.type === "session" ? content.sessionId : content.id;
      try {
        if (content.type === "session") {
          await KillSession(id);
        } else {
          await KillTerminal(id);
        }
      } catch {
        // process may already be dead
      }
      delete terminalApis[id];
    }

    collapsePane(focusedPath);
  }

  // Reset search when focus changes
  $effect(() => {
    void focusedPath;
    searchVisible = false;
  });

  // Persist layout on changes (debounced)
  $effect(() => {
    void layoutTree;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const cfg = await GetConfig();
        // layout is json.RawMessage in Go — assign the raw object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cfg as any).layout = layoutTree;
        await SetConfig(cfg);
      } catch {
        // config save failed, ignore
      }
    }, 500);
  });

  onMount(async () => {
    sessions = ((await ListSessions()) || []) as SessionInfo[];

    // Load persisted layout
    try {
      const cfg = await GetConfig();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawLayout = (cfg as any).layout;
      if (rawLayout && typeof rawLayout === "object" && rawLayout !== null && "type" in rawLayout) {
        layoutTree = rawLayout as LayoutNode;

        // Clean up stale sessions and terminals
        const layoutSessionIds = collectSessionIds(layoutTree);
        const liveSessionIds = new Set(sessions.map((s) => s.id));

        let cleaned = layoutTree;
        for (const sid of layoutSessionIds) {
          if (!liveSessionIds.has(sid)) {
            const path = findLeafBySessionId(cleaned, sid);
            if (path) {
              cleaned = setLeafContent(cleaned, path, null);
            }
          }
        }

        // Terminals don't survive restart — clear all terminal panes
        const termIds = collectTerminalIds(cleaned);
        for (const tid of termIds) {
          const tpath = findLeafByTerminalId(cleaned, tid);
          if (tpath) {
            cleaned = setLeafContent(cleaned, tpath, null);
          }
        }

        layoutTree = cleaned;
      }
    } catch {
      // No persisted layout, use default
    }

    // Set initial focus
    const paths = collectLeafPaths(layoutTree);
    if (paths.length > 0) focusedPath = paths[0];

    const cancelSessions = EventsOn("sessions-updated", (updated: unknown) => {
      const newSessions = (updated || []) as SessionInfo[];
      sessions = newSessions;

      // Collapse panes for exited sessions
      for (const s of newSessions) {
        if (s.status === "exited") {
          const path = findLeafBySessionId(layoutTree, s.id);
          if (path) {
            if (s.worktree_enabled && s.worktree_path) {
              GetWorktreeStatus(s.id).then((status) => {
                worktreeCleanup = {
                  sessionId: s.id,
                  sessionName: s.name,
                  branchName: s.branch_name || "",
                  status,
                };
              }).catch(() => {
                worktreeCleanup = {
                  sessionId: s.id,
                  sessionName: s.name,
                  branchName: s.branch_name || "",
                  status: null,
                };
              });
            }
            delete terminalApis[s.id];
            collapsePane(path);
          }
        }
      }
    });
    cleanups.push(cancelSessions);

    const cancelTermExit = EventsOn("terminal-exited", (id: unknown) => {
      if (typeof id !== "string") return;
      const path = findLeafByTerminalId(layoutTree, id);
      if (path) {
        delete terminalApis[id];
        collapsePane(path);
      }
    });
    cleanups.push(cancelTermExit);

    const cancelNotification = EventsOn("notification-fired", (data: unknown) => {
      const notif = data as AppNotification;
      addNotification(notif);
    });
    cleanups.push(cancelNotification);

    // Track window focus for desktop notification gating
    const handleFocus = () => EventsEmit("window-focus-changed", true);
    const handleBlur = () => EventsEmit("window-focus-changed", false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    cleanups.push(() => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    });
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
    if (saveTimer) clearTimeout(saveTimer);
  });

  async function handleNewSession(workDir: string, worktreeEnabled: boolean, branchName: string): Promise<void> {
    showNewDialog = false;
    const info = await CreateSession(workDir, worktreeEnabled, branchName);

    if (pendingQuickPickPath) {
      layoutTree = setLeafContent(layoutTree, asPath(pendingQuickPickPath), {
        type: "session",
        sessionId: info.id,
      });
      focusedPath = pendingQuickPickPath;
      pendingQuickPickPath = null;
    } else {
      // Assign to focused pane only if it's empty
      const content = getFocusedContent();
      if (content === null) {
        layoutTree = setLeafContent(layoutTree, asPath(focusedPath), {
          type: "session",
          sessionId: info.id,
        });
      }
      // Otherwise session is created but unassigned — visible in sidebar
    }
    requestAnimationFrame(() => terminalApis[info.id]?.focus());
  }

  async function handleKill(id: string): Promise<void> {
    await KillSession(id);
    delete terminalApis[id];
    // Clear the pane content
    const path = findLeafBySessionId(layoutTree, id);
    if (path) {
      layoutTree = setLeafContent(layoutTree, asPath(path), null);
    }
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await RenameSession(id, name);
  }

  function handleSidebarSelect(id: string): void {
    // Dismiss any active notification for this session
    dismissNotification(id);
    DismissNotification(id);

    // If session already in a pane, focus that pane
    const existingPath = findLeafBySessionId(layoutTree, id);
    if (existingPath) {
      focusedPath = existingPath;
      focusTerminalAtPath(existingPath);
      return;
    }

    // Assign session to the focused pane (replacing any existing content)
    layoutTree = setLeafContent(layoutTree, asPath(focusedPath), {
      type: "session",
      sessionId: id,
    });
    requestAnimationFrame(() => terminalApis[id]?.focus());
  }

  function handleGoToSession(sessionID: string): void {
    handleSidebarSelect(sessionID);
  }

  async function handleWorktreeKeep(): Promise<void> {
    if (!worktreeCleanup) return;
    await CleanupWorktree(worktreeCleanup.sessionId, false);
    worktreeCleanup = null;
  }

  async function handleWorktreeDelete(): Promise<void> {
    if (!worktreeCleanup) return;
    await CleanupWorktree(worktreeCleanup.sessionId, true);
    worktreeCleanup = null;
  }

  async function handleQuickPick(
    path: number[],
    choice: "terminal" | "session",
  ): Promise<void> {
    if (choice === "session") {
      pendingQuickPickPath = path;
      showNewDialog = true;
      return;
    }

    // Terminal choice
    const workDir = getWorkDirFromSiblingPane();
    const info = await CreateTerminal(workDir);
    layoutTree = setLeafContent(layoutTree, asPath(path), {
      type: "terminal",
      id: info.id,
      workDir: info.work_dir,
    });
    focusedPath = path;
    requestAnimationFrame(() => terminalApis[info.id]?.focus());
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  {#if sidebarVisible}
    <Sidebar
      {sessions}
      activeSessionId={null}
      onSelect={handleSidebarSelect}
      onNew={() => (showNewDialog = true)}
      onKill={handleKill}
      onRename={handleRename}
    />
  {/if}

  <div class="content">
    <SplitPane
      node={layoutTree}
      path={[]}
      {focusedPath}
      {searchVisible}
      {terminalApis}
      onFocus={(path) => {
        focusedPath = path;
        focusTerminalAtPath(path);
      }}
      onRatioChange={(path, ratio) => {
        layoutTree = updateRatio(layoutTree, asPath(path), ratio);
      }}
      onQuickPick={handleQuickPick}
      onTerminalReady={(id, api) => {
        terminalApis[id] = api;
      }}
    />
  </div>

  {#if showNewDialog}
    <NewSessionDialog
      onSubmit={handleNewSession}
      onCancel={() => {
        showNewDialog = false;
        pendingQuickPickPath = null;
      }}
    />
  {/if}

  <ToastContainer toastDuration={getToastDuration()} onGoToSession={handleGoToSession} />

  {#if worktreeCleanup}
    <WorktreeCleanupDialog
      sessionName={worktreeCleanup.sessionName}
      branchName={worktreeCleanup.branchName}
      status={worktreeCleanup.status}
      onKeep={handleWorktreeKeep}
      onDelete={handleWorktreeDelete}
    />
  {/if}
</main>

<style>
  main {
    display: flex;
    height: 100%;
  }

  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
</style>
