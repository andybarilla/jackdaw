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
    MergeSession,
  } from "../wailsjs/go/main/App";
  import type { LayoutNode, PaneContent, Path, FindResult, DropZone, TabDragData } from "./lib/layout";
  import {
    emptyLeaf,
    splitLeaf,
    closeLeaf,
    updateRatio,
    setLeafContent,
    getLeafContent,
    getLeaf,
    findLeafBySessionId,
    findLeafByTerminalId,
    findLeafByDiffSessionId,
    collectSessionIds,
    collectTerminalIds,
    collectDiffSessionIds,
    addTab,
    removeTab,
    setActiveTab,
    reorderTab,
    unsplitPane,
    migrateLayout,
    moveTab,
    collapseEmptyLeaves,
    replaceNodeAtPath,
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
  let sidebarWidth = $state(280);
  let searchVisible = $state(false);
  let terminalApis = $state<Record<string, TerminalApi>>({});
  let cleanups: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingQuickPickPath: number[] | null = null;
  let worktreeCleanup = $state<{
    sessionId: string;
    sessionName: string;
    branchName: string;
    baseBranch: string;
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
        const id = content.type === "session" ? content.sessionId : content.type === "terminal" ? content.id : null;
        if (id) requestAnimationFrame(() => terminalApis[id]?.focus());
      }
    } catch {
      // path invalid, ignore
    }
  }

  function getFocusedContent(): PaneContent | null {
    try {
      return getLeafContent(layoutTree, asPath(focusedPath));
    } catch {
      return null;
    }
  }

  function getWorkDirFromSiblingPane(): string {
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

  function cycleTab(delta: number): void {
    try {
      const leaf = getLeaf(layoutTree, asPath(focusedPath));
      if (leaf.contents.length < 2) return;
      const next = (leaf.activeIndex + delta + leaf.contents.length) % leaf.contents.length;
      layoutTree = setActiveTab(layoutTree, asPath(focusedPath), next);
      focusTerminalAtPath(focusedPath);
    } catch {
      // ignore
    }
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
      const found = findLeafBySessionId(layoutTree, nextSession.id);
      if (found) {
        focusedPath = found.path as number[];
        layoutTree = setActiveTab(layoutTree, found.path, found.tabIndex);
        focusTerminalAtPath(found.path as number[]);
      }
    },
    "session.prev": () => {
      if (sessions.length === 0) return;
      const content = getFocusedContent();
      const currentId = content?.type === "session" ? content.sessionId : null;
      const currentIdx = currentId ? sessions.findIndex((s) => s.id === currentId) : -1;
      const prevIdx = (currentIdx - 1 + sessions.length) % sessions.length;
      const prevSession = sessions[prevIdx];
      const found = findLeafBySessionId(layoutTree, prevSession.id);
      if (found) {
        focusedPath = found.path as number[];
        layoutTree = setActiveTab(layoutTree, found.path, found.tabIndex);
        focusTerminalAtPath(found.path as number[]);
      }
    },
    "session.viewDiff": () => {
      const content = getFocusedContent();
      if (content?.type === "session") openDiffForSession(content.sessionId);
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
    "pane.unsplit": () => handleUnsplitPane(),
    "pane.focusUp": () => cycleFocus(-1),
    "pane.focusDown": () => cycleFocus(1),
    "pane.focusLeft": () => cycleFocus(-1),
    "pane.focusRight": () => cycleFocus(1),
    "tab.next": () => cycleTab(1),
    "tab.prev": () => cycleTab(-1),
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
      if (content.type === "session") {
        try { await KillSession(content.sessionId); } catch { /* may already be dead */ }
        delete terminalApis[content.sessionId];
      } else if (content.type === "terminal") {
        try { await KillTerminal(content.id); } catch { /* may already be dead */ }
        delete terminalApis[content.id];
      }
    }

    // Remove active tab
    try {
      const leaf = getLeaf(layoutTree, asPath(focusedPath));
      if (leaf.contents.length <= 1) {
        // Last tab or empty — collapse pane
        collapsePane(focusedPath);
      } else {
        // Remove just the active tab
        layoutTree = removeTab(layoutTree, asPath(focusedPath), leaf.activeIndex);
        focusTerminalAtPath(focusedPath);
      }
    } catch {
      collapsePane(focusedPath);
    }
  }

  function handleUnsplitPane(): void {
    const result = unsplitPane(layoutTree, asPath(focusedPath));
    if (!result) return;
    layoutTree = result.layout;
    focusedPath = focusedPath.slice(0, -1);
    focusTerminalAtPath(focusedPath);
  }

  // Reset search when focus changes
  $effect(() => {
    void focusedPath;
    searchVisible = false;
  });

  // Persist layout on changes (debounced)
  $effect(() => {
    void layoutTree;
    void sidebarWidth;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const cfg = await GetConfig();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cfg as any).layout = layoutTree;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cfg as any).sidebar_width = sidebarWidth;
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
      const rawSidebarWidth = (cfg as any).sidebar_width;
      if (typeof rawSidebarWidth === "number" && rawSidebarWidth >= 180 && rawSidebarWidth <= 480) {
        sidebarWidth = rawSidebarWidth;
      }
      const rawLayout = (cfg as any).layout;
      if (rawLayout && typeof rawLayout === "object" && rawLayout !== null && "type" in rawLayout) {
        // Migrate from old format if needed
        layoutTree = migrateLayout(rawLayout);

        // Clean up stale sessions
        const layoutSessionIds = collectSessionIds(layoutTree);
        const liveSessionIds = new Set(sessions.map((s) => s.id));

        let cleaned = layoutTree;
        for (const sid of layoutSessionIds) {
          if (!liveSessionIds.has(sid)) {
            let found = findLeafBySessionId(cleaned, sid);
            while (found) {
              cleaned = removeTab(cleaned, found.path, found.tabIndex);
              found = findLeafBySessionId(cleaned, sid);
            }
          }
        }

        // Restore terminal panes by spawning fresh shells with the same workDir
        const termIds = collectTerminalIds(cleaned);
        for (const tid of termIds) {
          const found = findLeafByTerminalId(cleaned, tid);
          if (!found) continue;
          const leaf = getLeaf(cleaned, found.path);
          const tab = leaf.contents[found.tabIndex];
          if (tab.type !== "terminal") continue;
          try {
            const info = await CreateTerminal(tab.workDir);
            const newContents = [...leaf.contents];
            newContents[found.tabIndex] = { type: "terminal", id: info.id, workDir: info.work_dir };
            cleaned = replaceNodeAtPath(cleaned, found.path, {
              type: "leaf",
              contents: newContents,
              activeIndex: leaf.activeIndex,
            });
          } catch {
            cleaned = removeTab(cleaned, found.path, found.tabIndex);
          }
        }

        // Diff panes don't survive restart — clear them
        const diffSids = collectDiffSessionIds(cleaned);
        for (const dsid of diffSids) {
          let found = findLeafByDiffSessionId(cleaned, dsid);
          while (found) {
            cleaned = removeTab(cleaned, found.path, found.tabIndex);
            found = findLeafByDiffSessionId(cleaned, dsid);
          }
        }

        layoutTree = collapseEmptyLeaves(cleaned);
      }
    } catch {
      // No persisted layout, use default
    }

    // After layout restoration, give split panes time to settle then re-fit terminals
    setTimeout(() => window.dispatchEvent(new Event("pane-resize")), 200);

    // Set initial focus
    const paths = collectLeafPaths(layoutTree);
    if (paths.length > 0) focusedPath = paths[0];

    const cancelSessions = EventsOn("sessions-updated", (updated: unknown) => {
      const newSessions = (updated || []) as SessionInfo[];
      sessions = newSessions;

      // Remove tabs for exited sessions
      for (const s of newSessions) {
        if (s.status === "exited") {
          const found = findLeafBySessionId(layoutTree, s.id);
          if (found) {
            if (s.worktree_enabled && s.worktree_path) {
              GetWorktreeStatus(s.id).then((status) => {
                worktreeCleanup = {
                  sessionId: s.id,
                  sessionName: s.name,
                  branchName: s.branch_name || "",
                  baseBranch: s.base_branch || "main",
                  status,
                };
              }).catch(() => {
                worktreeCleanup = {
                  sessionId: s.id,
                  sessionName: s.name,
                  branchName: s.branch_name || "",
                  baseBranch: s.base_branch || "main",
                  status: null,
                };
              });
            }
            delete terminalApis[s.id];
            layoutTree = removeTab(layoutTree, found.path, found.tabIndex);
          }
        }
      }
    });
    cleanups.push(cancelSessions);

    const cancelTermExit = EventsOn("terminal-exited", (id: unknown) => {
      if (typeof id !== "string") return;
      const found = findLeafByTerminalId(layoutTree, id);
      if (found) {
        delete terminalApis[id];
        layoutTree = removeTab(layoutTree, found.path, found.tabIndex);
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
      layoutTree = addTab(layoutTree, asPath(pendingQuickPickPath), {
        type: "session",
        sessionId: info.id,
      });
      focusedPath = pendingQuickPickPath;
      pendingQuickPickPath = null;
    } else {
      // Add as tab in focused pane
      layoutTree = addTab(layoutTree, asPath(focusedPath), {
        type: "session",
        sessionId: info.id,
      });
    }
    requestAnimationFrame(() => terminalApis[info.id]?.focus());
  }

  async function handleKill(id: string): Promise<void> {
    await KillSession(id);
    delete terminalApis[id];
    const found = findLeafBySessionId(layoutTree, id);
    if (found) {
      layoutTree = removeTab(layoutTree, found.path, found.tabIndex);
    }
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await RenameSession(id, name);
  }

  function handleSidebarSelect(id: string): void {
    // Dismiss any active notification for this session
    dismissNotification(id);
    DismissNotification(id);

    // If session already in any tab, focus that pane and switch to it
    const found = findLeafBySessionId(layoutTree, id);
    if (found) {
      focusedPath = found.path as number[];
      layoutTree = setActiveTab(layoutTree, found.path, found.tabIndex);
      focusTerminalAtPath(found.path as number[]);
      return;
    }

    // Add as new tab in focused pane
    layoutTree = addTab(layoutTree, asPath(focusedPath), {
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

  async function handleMergeSession(sessionId: string): Promise<void> {
    try {
      const result = await MergeSession(sessionId);
      if (result.success) {
        addNotification({
          sessionID: sessionId,
          sessionName: "",
          type: "session_exited",
          message: `Merged: ${result.commit_message}`,
          timestamp: new Date().toISOString(),
        });
        worktreeCleanup = null;
        const diffFound = findLeafByDiffSessionId(layoutTree, sessionId);
        if (diffFound) {
          layoutTree = removeTab(layoutTree, diffFound.path, diffFound.tabIndex);
        }
      } else {
        addNotification({
          sessionID: sessionId,
          sessionName: "",
          type: "error_detected",
          message: `Merge failed: ${result.error}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      addNotification({
        sessionID: sessionId,
        sessionName: "",
        type: "error_detected",
        message: `Merge error: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async function handleWorktreeMerge(): Promise<void> {
    if (!worktreeCleanup) return;
    await handleMergeSession(worktreeCleanup.sessionId);
  }

  function openDiffForSession(sessionId: string): void {
    // If diff already open, focus it
    const existingDiff = findLeafByDiffSessionId(layoutTree, sessionId);
    if (existingDiff) {
      focusedPath = existingDiff.path as number[];
      layoutTree = setActiveTab(layoutTree, existingDiff.path, existingDiff.tabIndex);
      return;
    }

    // If session is in any tab, add diff as new tab in same pane
    const sessionFound = findLeafBySessionId(layoutTree, sessionId);
    if (sessionFound) {
      layoutTree = addTab(layoutTree, sessionFound.path, {
        type: "diff",
        sessionId,
      });
      focusedPath = sessionFound.path as number[];
      return;
    }

    // Session not in any pane — add diff as tab in focused pane
    layoutTree = addTab(layoutTree, asPath(focusedPath), {
      type: "diff",
      sessionId,
    });
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
    layoutTree = addTab(layoutTree, asPath(path), {
      type: "terminal",
      id: info.id,
      workDir: info.work_dir,
    });
    focusedPath = path;
    requestAnimationFrame(() => terminalApis[info.id]?.focus());
  }

  function handleTabSelect(path: number[], index: number): void {
    layoutTree = setActiveTab(layoutTree, asPath(path), index);
    focusedPath = path;
    focusTerminalAtPath(path);
  }

  async function handleTabClose(path: number[], index: number): Promise<void> {
    try {
      const leaf = getLeaf(layoutTree, asPath(path));
      const content = leaf.contents[index];
      if (content) {
        // Terminal tabs have no sidebar presence — kill the process
        if (content.type === "terminal") {
          try { await KillTerminal(content.id); } catch { /* may already be dead */ }
          delete terminalApis[content.id];
        }
        // Session and diff tabs just detach (session stays in sidebar)
      }
      layoutTree = removeTab(layoutTree, asPath(path), index);
    } catch {
      // ignore
    }
  }

  function handleTabReorder(path: number[], fromIndex: number, toIndex: number): void {
    layoutTree = reorderTab(layoutTree, asPath(path), fromIndex, toIndex);
  }

  function handleTabDrop(targetPath: number[], data: string, zone: DropZone, insertIndex?: number): void {
    try {
      const parsed = JSON.parse(data) as TabDragData;
      const sourcePath = parsed.sourcePath as Path;
      const tabIndex = parsed.tabIndex;

      // If dropping onto the same pane center, it's just a reorder (handled by TabBar)
      const samePanePaths = sourcePath.length === targetPath.length &&
        sourcePath.every((v, i) => v === targetPath[i]);

      if (samePanePaths && zone === "center") {
        // If we have an insertIndex from the tab bar, reorder
        if (insertIndex !== undefined && insertIndex !== tabIndex) {
          layoutTree = reorderTab(layoutTree, sourcePath, tabIndex, insertIndex);
        }
        return;
      }

      const result = moveTab(
        layoutTree,
        { path: sourcePath, tabIndex },
        asPath(targetPath),
        zone,
      );
      layoutTree = result.layout;
      focusedPath = result.newFocusPath as number[];
      focusTerminalAtPath(focusedPath);
    } catch {
      // invalid drag data, ignore
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  {#if sidebarVisible}
    <Sidebar
      width={sidebarWidth}
      onSelect={handleSidebarSelect}
      onNew={() => (showNewDialog = true)}
      onKill={handleKill}
      onRename={handleRename}
      onViewDiff={openDiffForSession}
      onResize={(w) => { sidebarWidth = w; }}
    />
  {/if}

  <div class="content">
    <SplitPane
      node={layoutTree}
      path={[]}
      {focusedPath}
      {searchVisible}
      {terminalApis}
      {sessions}
      onMerge={handleMergeSession}
      onSelectSession={handleSidebarSelect}
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
      onTabSelect={handleTabSelect}
      onTabClose={handleTabClose}
      onTabReorder={handleTabReorder}
      onTabDrop={handleTabDrop}
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
      baseBranch={worktreeCleanup.baseBranch}
      status={worktreeCleanup.status}
      onKeep={handleWorktreeKeep}
      onMerge={handleWorktreeMerge}
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
