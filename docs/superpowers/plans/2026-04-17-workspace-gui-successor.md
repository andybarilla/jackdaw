# Workspace GUI Successor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Build the new packaged desktop GUI workbench as the main product direction: a workspace-centered desktop app with a local web UI over a local pi-backed orchestration service, preserving the validated session-first model while moving beyond the current pi-native prototype.
**Architecture:** Keep the runtime and UI separated from day one. Package an Electron desktop shell that launches a local orchestration service, serves a React web UI, and communicates over a loopback HTTP + Server-Sent Events boundary so the same contracts can later support remote or multi-machine operation. Reuse proven semantics from the prototype—session statuses, attention ranking, pinned summaries, intervention lifecycle, reconnect behavior—but rebuild them in new `desktop`, `service`, `web`, and `shared` modules instead of extending the TUI as the primary surface.
**Tech Stack:** TypeScript, Electron, React, Vite, Vitest, React Testing Library, `@mariozechner/pi-coding-agent`, Fastify, loopback HTTP + SSE, local JSON persistence under Electron `userData`

---

## Decision snapshot

This plan resolves the open implementation questions from the design spec as follows:

- **Desktop packaging choice:** Electron
- **Frontend stack:** React + Vite + TypeScript
- **Transport:** loopback HTTP JSON for commands/queries + SSE for live updates
- **Persistence:** local JSON files in the desktop app `userData` directory, with per-workspace files and artifact indexes
- **Changed-files context in v1:** ship as workspace/session-linked artifact metadata and lightweight recent-files context, not a full diff browser
- **Review/handoff state in v1:** lightweight linked metadata and artifact references, not a standalone workflow engine

These choices are intentionally optimized for:
1. strong desktop feel in v1
2. clean service/UI boundaries
3. reuse of the existing TypeScript and pi runtime code
4. minimal architecture debt for later remote support

---

## Scope guardrails for v1

This plan is for the **new app direction**, not another polish cycle on the pi-native prototype.

### In scope for v1
- packaged desktop app
- local web UI inside that app
- local pi-backed orchestration service
- workspace-centered model spanning multiple repos, worktrees, and sessions
- live operations dashboard as the default home
- session-first attention model
- selected session command center with understanding and intervention equally weighted
- local-first persistence
- artifact/spec/plan/work-item linking as supporting context
- shell fallback as a bounded escape hatch

### Explicit non-goals for v1
- multi-user collaboration
- cloud sync
- remote execution as a launch requirement
- HQ as the system of record
- HQ-required auth/setup
- persistent embedded terminal panes
- transcript-first UI
- full IDE/file editor replacement
- complete parity with every historical Jackdaw feature
- generalized plugin marketplace or extension system for the GUI app
- cross-machine workspace merging

### Additional scope rules
- Do **not** turn `src/ui/` and `src/orchestration/` TUI modules into the permanent GUI foundation.
- Do **not** make the GUI depend on same-process runtime calls.
- Do **not** duplicate full pi transcripts into the workspace store.
- Do **not** make shell the default interaction path.

---

## Existing codebase map and reuse points

The repo today is still centered on the prototype. These are the validated parts worth reusing conceptually or by extraction:

### Existing modules to study and mine
- `src/orchestration/activity.ts`
  - current event normalization and changed-file extraction
- `src/orchestration/status.ts`
  - current operator-facing status derivation
- `src/orchestration/registry.ts`
  - stable attention-band ordering semantics
- `src/orchestration/supervisor.ts`
  - current local session lifecycle, intervention tracking, reconnect behavior
- `src/persistence/schema.ts`
  - strict parsing of persisted local state
- `src/persistence/store.ts`
  - atomic local persistence patterns
- `src/ui/overview.ts`
  - current dashboard attention wording
- `src/ui/session-detail.ts`
  - current understanding/intervention information model

### Existing prototype modules to leave intact during the GUI build
- `src/ui/*`
- `src/orchestration/*`
- `src/commands/*`
- `src/index.ts`

Treat them as:
- reference implementation
- behavior oracle for session semantics
- fallback prototype during transition

Do **not** make them the long-term GUI module tree.

---

## Target file structure for the new app

Create a parallel app structure under `src/`:

```text
src/
  desktop/
    main.ts
    preload.ts
    lifecycle/
      app-paths.ts
      service-process.ts
      window.ts
      dev-server.ts
  service/
    main.ts
    server.ts
    api/
      routes/
        health.ts
        workspaces.ts
        sessions.ts
        artifacts.ts
        settings.ts
      sse/
        event-bus.ts
        workspace-stream.ts
    orchestration/
      runtime-manager.ts
      session-controller.ts
      session-adapter.ts
      event-normalizer.ts
      attention-engine.ts
      reconnect-manager.ts
    persistence/
      app-store.ts
      workspace-store.ts
      schema.ts
      migrations.ts
      paths.ts
    workspace/
      workspace-registry.ts
      repo-registry.ts
      artifact-index.ts
      session-links.ts
  web/
    main.tsx
    App.tsx
    app/
      routes.tsx
      providers.tsx
    screens/
      home/
        workspace-home-screen.tsx
      workspace/
        workspace-explorer-screen.tsx
      artifacts/
        artifact-viewer-screen.tsx
      settings/
        settings-screen.tsx
    components/
      layout/
        shell.tsx
        split-pane.tsx
        top-bar.tsx
      sessions/
        attention-rail.tsx
        session-row.tsx
        session-command-center.tsx
        summary-panel.tsx
        intervention-panel.tsx
        recent-events-panel.tsx
      workspace/
        context-panel.tsx
        repo-list.tsx
        worktree-list.tsx
        linked-items-panel.tsx
      artifacts/
        artifact-list.tsx
        artifact-preview.tsx
    hooks/
      useWorkspaceStream.ts
      useWorkspaceActions.ts
      useWorkspaceSelection.ts
    lib/
      api-client.ts
      event-source.ts
      formatters.ts
    styles/
      app.css
  shared/
    domain/
      workspace.ts
      session.ts
      artifact.ts
      attention.ts
      commands.ts
    transport/
      api.ts
      events.ts
      dto.ts
```

### New test locations
```text
src/desktop/**/*.test.ts
src/service/**/*.test.ts
src/web/**/*.test.tsx
src/shared/**/*.test.ts
```

---

## Phased implementation overview

### Phase 1: App foundation and contracts
Build the skeleton for the packaged app, shared types, and local persistence model without touching the existing prototype path.

### Phase 2: Local orchestration service
Move validated session semantics into a dedicated service that owns pi sessions, workspace/session registries, normalized attention state, and local persistence.

### Phase 3: Desktop shell and live dashboard
Package the web UI in Electron, start the service automatically, and ship the workspace home screen as a live operations dashboard.

### Phase 4: Session command center and workspace context
Complete the selected-session view so understanding and intervention are equally first-class, then add surrounding workspace context objects.

### Phase 5: Recovery, packaging, and v1 hardening
Lock down restart/reconnect, workspace durability, packaging, and explicit future-remote boundaries.

---

## Task 1: Scaffold the new desktop/web/service app without disturbing the prototype

**Outcome:** The repo can build and run a separate GUI app stack in parallel with the current pi-native prototype.

**Sequencing:** First. Nothing else should start before the new app skeleton exists.

**Deliverables:**
- new app directories under `src/desktop`, `src/service`, `src/web`, and `src/shared`
- build/dev scripts for web, service, and desktop
- TypeScript config updated for `.tsx`
- a bootable desktop window that loads a placeholder web UI and starts a placeholder local service

**Likely files/modules:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/desktop/main.ts`
- Create: `src/desktop/preload.ts`
- Create: `src/desktop/lifecycle/window.ts`
- Create: `src/service/main.ts`
- Create: `src/service/server.ts`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/styles/app.css`
- Create: `src/shared/transport/api.ts`
- Create: `src/shared/transport/events.ts`

**Implementation notes:**
1. Add the minimum new dependencies:
   - `electron`
   - `vite`
   - `react`
   - `react-dom`
   - `@vitejs/plugin-react`
   - `fastify`
   - `@testing-library/react`
   - `jsdom`
2. Define the service app-data path contract immediately, even before real persistence exists:
   - `dev:service` must accept an explicit app-data path via env var such as `JACKDAW_APP_DATA_DIR`
   - Electron-launched service processes must pass that same env var using the resolved Electron `userData` path
   - tests must use temporary directories through the same env var
   - packaged builds must resolve the default app-data path from Electron `userData`
3. Add scripts:
   - `npm run dev:web`
   - `npm run dev:service`
   - `npm run dev:desktop`
   - `npm run dev:gui`
   - `npm run build:web`
   - `npm run build:service`
   - `npm run build:desktop`
   - `npm run build`
   - `npm run package:dir`
3. Update `tsconfig.json` to include `src/**/*.tsx`.
4. Keep the current `src/index.ts` prototype extension entry intact.
5. Make the initial desktop app show a visible placeholder:
   - app shell chrome
   - current service health
   - placeholder workspace selector
6. Keep the initial service dead simple: `GET /health` returning `{ ok: true }`.

**Verification guidance:**
- Run:
  ```bash
  npm run check
  ```
  Expected: TypeScript passes with no new errors.
- Run:
  ```bash
  npm test
  ```
  Expected: existing prototype tests still pass.
- Run:
  ```bash
  npm run build
  ```
  Expected: web, service, and desktop bundles complete successfully.
- Manual:
  ```bash
  npm run dev:gui
  ```
  Expected:
  - Electron window opens
  - placeholder UI renders
  - service health endpoint reports healthy

---

## Task 2: Define the shared workspace/session domain and transport contracts

**Outcome:** The new app has one typed source of truth for workspaces, sessions, artifacts, attention events, and commands.

**Sequencing:** After Task 1, before persistence or service logic.

**Deliverables:**
- shared domain model for workspace-centered operation
- typed DTOs for HTTP responses and SSE events
- explicit command/request shapes for v1 actions: spawn session, steer, follow-up, abort, pin-summary, open-path, and shell fallback
- status and attention definitions carried over from the prototype

**Likely files/modules:**
- Create: `src/shared/domain/workspace.ts`
- Create: `src/shared/domain/session.ts`
- Create: `src/shared/domain/artifact.ts`
- Create: `src/shared/domain/attention.ts`
- Create: `src/shared/domain/commands.ts`
- Create: `src/shared/transport/dto.ts`
- Modify: `src/shared/transport/api.ts`
- Modify: `src/shared/transport/events.ts`
- Create: `src/shared/domain/session.test.ts`
- Create: `src/shared/domain/attention.test.ts`
- Create: `src/shared/transport/dto.test.ts`

**Implementation notes:**
1. Define `Workspace` as the top-level local object with:
   - `id`
   - `name`
   - `description`
   - `repoRoots`
   - `worktrees`
   - `sessionIds`
   - `artifactIds`
   - `preferences`
   - `optionalIntegrations`
2. Define `WorkspaceSession` for the new GUI app with explicit fields:
   - session identity
   - workspace id
   - repo/worktree/cwd
   - branch
   - model/agent/runtime info
   - operator-facing status
   - live summary
   - pinned summary
   - latest meaningful update
   - current activity/tool
   - last intervention
   - recent files or changed-files snapshot metadata
   - linked artifacts/work item ids
   - connection state
3. Keep the validated status set exactly:
   - `awaiting-input`
   - `blocked`
   - `failed`
   - `running`
   - `idle`
   - `done`
4. Define `AttentionEvent` separately from session status so ranking and explanation stay distinct.
5. Keep HQ references optional fields only, not required fields.
6. Define transport contracts so the web UI never imports service internals directly.

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/shared/domain/session.test.ts src/shared/domain/attention.test.ts src/shared/transport/dto.test.ts
  ```
  Expected: PASS
- Run:
  ```bash
  npm run check
  ```
  Expected: no transport/domain typing errors
- Review manually:
  - no DTO requires HQ
  - no DTO assumes same-process access
  - workspace objects can reference multiple repos/worktrees/sessions

---

## Task 3: Build local-first workspace persistence and registry

**Outcome:** The service can create, load, update, and persist workspaces and related metadata independently of pi transcript storage.

**Sequencing:** After Task 2, before session runtime work.

**Deliverables:**
- app-level store for workspace index
- per-workspace store for metadata and artifact/session links
- atomic writes and schema parsing similar to the existing prototype store
- migration/version hooks for future persistence evolution

**Likely files/modules:**
- Create: `src/service/persistence/paths.ts`
- Create: `src/service/persistence/schema.ts`
- Create: `src/service/persistence/migrations.ts`
- Create: `src/service/persistence/app-store.ts`
- Create: `src/service/persistence/workspace-store.ts`
- Create: `src/service/workspace/workspace-registry.ts`
- Create: `src/service/workspace/repo-registry.ts`
- Create: `src/service/workspace/session-links.ts`
- Create: `src/service/persistence/schema.test.ts`
- Create: `src/service/persistence/workspace-store.test.ts`
- Create: `src/service/workspace/workspace-registry.test.ts`

**Implementation notes:**
1. Resolve the service app-data path from one contract everywhere:
   - if `JACKDAW_APP_DATA_DIR` is set, use it
   - otherwise, in packaged/Electron-launched runs, use the Electron-resolved `userData` path passed in by the desktop shell
   - tests should always set `JACKDAW_APP_DATA_DIR` to a temp directory
2. Store app data under that resolved app-data directory, not repo-local directories.
3. Use a structure like:
   ```text
   userData/
     app-state.json
     workspaces/
       <workspace-id>/
         workspace.json
         artifacts/
         cache/
   ```
4. Persist only local metadata:
   - workspace definitions
   - repo/worktree registrations
   - session metadata cache
   - pinned summaries
   - linked artifacts
   - layout/preferences
   - reconnect metadata
5. Do **not** persist:
   - full transcript copies
   - HQ-required state
   - remote-sync assumptions
6. Reuse the strict parse-and-validate style from `src/persistence/schema.ts`.
7. Design the workspace registry so one workspace can own:
   - multiple repo roots
   - multiple worktrees under those repos
   - many active/historical sessions

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/service/persistence/schema.test.ts src/service/persistence/workspace-store.test.ts src/service/workspace/workspace-registry.test.ts
  ```
  Expected: PASS
- Add cases that verify:
  - malformed persisted data is rejected safely
  - writes are atomic
  - removing a repo does not silently delete historical sessions
  - workspace reload preserves session/artifact links

---

## Task 4: Implement the pi-backed orchestration service and session lifecycle manager

**Outcome:** A dedicated local service can create, track, reconnect, and control pi sessions for one or more workspaces.

**Sequencing:** After Tasks 2 and 3.

**Deliverables:**
- session controller around pi
- runtime manager for active sessions across workspaces
- event normalization and operator-facing status derivation
- reconnect manager for service restart behavior
- recent-files / changed-files snapshot capture attached to sessions as lightweight metadata
- command methods for v1 actions: spawn session, steer, follow-up, abort, pin-summary, open-path, and shell fallback

**Likely files/modules:**
- Create: `src/service/orchestration/session-adapter.ts`
- Create: `src/service/orchestration/session-controller.ts`
- Create: `src/service/orchestration/runtime-manager.ts`
- Create: `src/service/orchestration/event-normalizer.ts`
- Create: `src/service/orchestration/attention-engine.ts`
- Create: `src/service/orchestration/reconnect-manager.ts`
- Create: `src/service/orchestration/session-controller.test.ts`
- Create: `src/service/orchestration/event-normalizer.test.ts`
- Create: `src/service/orchestration/runtime-manager.test.ts`

**Existing code to reuse by extraction/reference:**
- `src/orchestration/activity.ts`
- `src/orchestration/status.ts`
- `src/orchestration/supervisor.ts`

**Implementation notes:**
1. Move validated semantics over, not UI code:
   - stable status derivation
   - meaningful-vs-noisy updates
   - last intervention lifecycle
   - reconnect/historical-only handling
   - lightweight recent-files extraction from session activity where available
2. The runtime manager should key active sessions by workspace id + session id.
3. Session creation must attach:
   - cwd
   - repo root/worktree context
   - branch when available
   - model/runtime metadata
4. Attention ranking should primarily derive from session status, then explain with attention events.
5. Preserve shell fallback as a bounded service command:
   - one-off shell command in session context
   - optional “open external terminal here” helper if the OS allows it
   - never embed terminal panes as the main UI
6. Reconnect rules for restart:
   - if reattach works, mark session `live`
   - if not, keep it visible as `historical`
   - never silently drop sessions from a workspace

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/service/orchestration/session-controller.test.ts src/service/orchestration/event-normalizer.test.ts src/service/orchestration/runtime-manager.test.ts
  ```
  Expected: PASS
- Add test coverage for:
  - multiple sessions across multiple workspaces
  - same-band updates not reordering attention unexpectedly
  - `awaiting-input`, `blocked`, and `failed` outranking `running`
  - pending interventions only becoming observed on later meaningful non-local activity
  - restart preserving historical-only visibility

---

## Task 5: Expose the service over a stable loopback API and event stream

**Outcome:** The GUI consumes the service only through explicit API contracts, not in-process imports.

**Sequencing:** After Task 4. The UI should not start real work before this exists.

**Deliverables:**
- Fastify server with workspace/session/artifact/settings routes
- SSE stream for workspace updates and session events
- API surface for all v1 operator actions
- health/version endpoint for desktop lifecycle checks

**Likely files/modules:**
- Modify: `src/service/server.ts`
- Create: `src/service/api/routes/health.ts`
- Create: `src/service/api/routes/workspaces.ts`
- Create: `src/service/api/routes/sessions.ts`
- Create: `src/service/api/routes/artifacts.ts`
- Create: `src/service/api/routes/settings.ts`
- Create: `src/service/api/sse/event-bus.ts`
- Create: `src/service/api/sse/workspace-stream.ts`
- Create: `src/service/api/routes/workspaces.test.ts`
- Create: `src/service/api/routes/sessions.test.ts`
- Create: `src/service/api/sse/workspace-stream.test.ts`

**Implementation notes:**
1. Keep the API small and v1-focused:
   - `GET /health`
   - `GET /workspaces`
   - `POST /workspaces`
   - `GET /workspaces/:workspaceId`
   - `PATCH /workspaces/:workspaceId`
   - `POST /workspaces/:workspaceId/repos`
   - `GET /workspaces/:workspaceId/sessions`
   - `POST /workspaces/:workspaceId/sessions`
   - `POST /sessions/:sessionId/steer`
   - `POST /sessions/:sessionId/follow-up`
   - `POST /sessions/:sessionId/abort`
   - `POST /sessions/:sessionId/pin-summary`
   - `POST /sessions/:sessionId/open-path`
   - `POST /sessions/:sessionId/shell`
   - `GET /workspaces/:workspaceId/events`

   `resume` and `spawn specialist` are intentionally out of v1 implementation scope for this plan. They can be revisited after the core dashboard and command center are stable.
2. Emit coarse, operator-relevant events:
   - workspace updated
   - session status changed
   - session summary updated
   - session recent-files context updated
   - intervention changed
   - artifact linked
3. Version the event payloads now.
4. Keep the API transport-neutral enough that a future remote service could serve the same routes.

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/service/api/routes/workspaces.test.ts src/service/api/routes/sessions.test.ts src/service/api/sse/workspace-stream.test.ts
  ```
  Expected: PASS
- Manual with service running:
  ```bash
  curl http://127.0.0.1:<port>/health
  ```
  Expected:
  ```json
  {"ok":true}
  ```
- Manual SSE check:
  ```bash
  curl -N http://127.0.0.1:<port>/workspaces/<workspace-id>/events
  ```
  Expected: stream stays open and emits JSON events on workspace/session changes

---

## Task 6: Package the desktop shell and manage local service lifecycle

**Outcome:** Opening the desktop app launches the local service, waits for health, and loads the GUI consistently.

**Sequencing:** After Task 5, before building the real UI.

**Deliverables:**
- Electron main process
- preload bridge for minimal safe desktop capabilities
- service child-process manager
- graceful shutdown and restart handling
- packaged directory build

**Likely files/modules:**
- Modify: `src/desktop/main.ts`
- Modify: `src/desktop/preload.ts`
- Create: `src/desktop/lifecycle/app-paths.ts`
- Create: `src/desktop/lifecycle/service-process.ts`
- Create: `src/desktop/lifecycle/dev-server.ts`
- Create: `src/desktop/lifecycle/window.ts`
- Create: `src/desktop/lifecycle/service-process.test.ts`
- Create: `src/desktop/main.test.ts`
- Create: `electron-builder.yml` or equivalent packaging config

**Implementation notes:**
1. Start the service as a child process from Electron.
2. Choose a loopback port dynamically and pass it to the renderer.
3. Pass the resolved service base URL and resolved app-data path into the launched service explicitly:
   - Electron main resolves `userData`
   - Electron main exports it to the service through `JACKDAW_APP_DATA_DIR`
   - Electron main exposes the final loopback base URL to the renderer through preload/bootstrap state
4. In standalone `dev:service`, require `JACKDAW_APP_DATA_DIR` or provide a documented local default for dev only.
5. Block the main window from showing “live” until service health is ready.
6. Expose only narrow desktop helpers through preload:
   - open local path in OS file manager
   - reveal repo/worktree in OS shell
   - optionally open external terminal at a path
7. Keep service lifecycle independent from renderer reloads.
8. Handle failure visibly:
   - if service boot fails, show a clear desktop error screen
   - do not leave a blank window

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/desktop/lifecycle/service-process.test.ts src/desktop/main.test.ts
  ```
  Expected: PASS
- Run:
  ```bash
  npm run build
  npm run package:dir
  ```
  Expected: packaged app directory is produced
- Manual:
  - launch packaged app
  - close app
  - relaunch app
  Expected:
  - service starts cleanly both times
  - no orphan child process remains after close
  - renderer reconnects after reload without manual intervention

---

## Task 7: Build the workspace home as a live operations dashboard

**Outcome:** The default screen answers “what needs me right now?” through a calm, session-first, workspace-centered layout.

**Sequencing:** After Tasks 5 and 6.

**Deliverables:**
- workspace selector and home route
- three-part dashboard:
  1. session attention rail
  2. selected session command center preview
  3. workspace context panel
- live data subscription from SSE
- stable attention ordering under concurrent updates

**Likely files/modules:**
- Create: `src/web/app/providers.tsx`
- Create: `src/web/app/routes.tsx`
- Create: `src/web/lib/api-client.ts`
- Create: `src/web/lib/event-source.ts`
- Create: `src/web/hooks/useWorkspaceStream.ts`
- Create: `src/web/hooks/useWorkspaceSelection.ts`
- Create: `src/web/screens/home/workspace-home-screen.tsx`
- Create: `src/web/components/layout/shell.tsx`
- Create: `src/web/components/layout/top-bar.tsx`
- Create: `src/web/components/layout/split-pane.tsx`
- Create: `src/web/components/sessions/attention-rail.tsx`
- Create: `src/web/components/sessions/session-row.tsx`
- Create: `src/web/components/workspace/context-panel.tsx`
- Create: `src/web/screens/home/workspace-home-screen.test.tsx`
- Create: `src/web/components/sessions/attention-rail.test.tsx`

**Implementation notes:**
1. Make the home screen the default route for a selected workspace.
2. The attention rail must show:
   - urgency/status
   - why the session needs attention
   - current activity
   - latest meaningful update
   - repo/worktree/branch context
   - lightweight recent-files context when available
   - linked plan/spec/work item when present
3. Keep sessions as the top-level attention unit.
4. Preserve stable ordering semantics from the prototype:
   - order by band first
   - avoid recency churn within band
5. Keep the right-hand command-center area partially visible from the home layout so the operator sees both understanding and action together.
6. Use plain, explicit wording for attention states; do not rely on color alone.

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/web/screens/home/workspace-home-screen.test.tsx src/web/components/sessions/attention-rail.test.tsx
  ```
  Expected: PASS
- Manual:
  - create a workspace with multiple sessions
  - force one session into `awaiting-input`
  - leave another `running`
  Expected:
  - `awaiting-input` is ranked above `running`
  - same-band live updates do not visibly reshuffle the rail
  - the operator can identify the most urgent session without reading transcript text

---

## Task 8: Build the full session command center with equal weight for understanding and intervention

**Outcome:** The selected session view makes it equally easy to understand state and act on it.

**Sequencing:** After Task 7.

**Deliverables:**
- selected session command center
- live summary, pinned summary, current activity, latest update, recent events
- intervention actions: steer, follow-up, abort
- repo/worktree context, recent-files context, and linked artifacts
- shell fallback entry point that stays clearly secondary

**Likely files/modules:**
- Create: `src/web/components/sessions/session-command-center.tsx`
- Create: `src/web/components/sessions/summary-panel.tsx`
- Create: `src/web/components/sessions/intervention-panel.tsx`
- Create: `src/web/components/sessions/recent-events-panel.tsx`
- Create: `src/web/components/sessions/session-header.tsx`
- Create: `src/web/components/sessions/shell-fallback-dialog.tsx`
- Create: `src/web/hooks/useWorkspaceActions.ts`
- Create: `src/web/components/sessions/session-command-center.test.tsx`
- Create: `src/web/components/sessions/intervention-panel.test.tsx`

**Implementation notes:**
1. The session command center must show, in one screen:
   - live summary
   - pinned summary
   - current activity
   - latest meaningful update
   - recent attention events
   - recent-files or changed-files snapshot context when available
   - linked spec/plan/work item/review state
   - primary actions
2. Preserve pinned-summary semantics from the prototype:
   - pin freezes the current live summary snapshot
   - live summary continues updating separately
3. Preserve intervention lifecycle semantics from the prototype:
   - accepted locally
   - pending observation
   - observed
   - failed locally
4. Support v1 primary actions:
   - spawn session
   - steer
   - follow-up
   - abort
   - open repo/worktree
   - open linked artifact
   - pin/refresh summary
   - shell fallback

   `resume` and `spawn specialist` are out of v1 scope for this plan and should not be implemented implicitly under another name.
5. Keep shell fallback as a dialog or explicit side action, never the center of the page.

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/web/components/sessions/session-command-center.test.tsx src/web/components/sessions/intervention-panel.test.tsx
  ```
  Expected: PASS
- Manual:
  - steer a live session
  - watch the intervention badge move from accepted locally to pending to observed
  - pin a live summary, then let the session continue updating
  Expected:
  - pinned text stays frozen
  - live summary continues changing
  - intervention status is explicit and honest
  - shell fallback is available but visually secondary

---

## Task 9: Add workspace context objects, explorer flows, and artifact linking

**Outcome:** Sessions remain primary, but the operator can connect them to workspace context without leaving the app.

**Sequencing:** After Task 8.

**Deliverables:**
- workspace explorer screen
- artifact viewer for specs/plans/decision memos/reviews
- local artifact indexing for file-backed docs
- linked context panel for selected session
- read-only recent-files / changed-files snapshot presentation in workspace context where available
- optional HQ integration settings stub that is disabled by default

**Likely files/modules:**
- Create: `src/service/workspace/artifact-index.ts`
- Create: `src/service/api/routes/artifacts.ts`
- Create: `src/web/screens/workspace/workspace-explorer-screen.tsx`
- Create: `src/web/screens/artifacts/artifact-viewer-screen.tsx`
- Create: `src/web/screens/settings/settings-screen.tsx`
- Create: `src/web/components/artifacts/artifact-list.tsx`
- Create: `src/web/components/artifacts/artifact-preview.tsx`
- Create: `src/web/components/workspace/linked-items-panel.tsx`
- Create: `src/web/components/workspace/repo-list.tsx`
- Create: `src/web/components/workspace/worktree-list.tsx`
- Create: `src/service/workspace/artifact-index.test.ts`
- Create: `src/web/screens/artifacts/artifact-viewer-screen.test.tsx`

**Implementation notes:**
1. Treat artifacts as operator-relevant durable outputs:
   - spec
   - plan
   - decision memo
   - review report
   - summary snapshot
2. Index workspace artifacts by file path + type + workspace linkage.
3. Treat recent-files / changed-files context as lightweight read-only metadata in v1:
   - file paths
   - optional operation labels such as edited/created when available
   - timestamps or recency ordering when available
   - no full diff browser yet
4. For v1, artifact viewing can be read-only.
5. Keep work items lightweight:
   - metadata + links
   - not a full workflow engine
6. HQ should appear only in settings as optional integration:
   - “not configured”
   - “configured”
   - linked IDs if present
   - never required for normal app use

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/service/workspace/artifact-index.test.ts src/web/screens/artifacts/artifact-viewer-screen.test.tsx
  ```
  Expected: PASS
- Manual:
  - register a repo containing `docs/superpowers/specs` and `docs/superpowers/plans`
  - verify artifacts appear in workspace context
  - open an artifact from a session link
  Expected:
  - session remains the primary object
  - nearby plans/specs are easy to inspect
  - no HQ setup is required

---

## Task 10: Harden restart, recovery, packaging, and future-remote boundaries

**Outcome:** The v1 desktop app is stable enough to use daily and not trapped in single-process assumptions.

**Sequencing:** Final task before calling v1 implementation complete.

**Deliverables:**
- reconnect manager integrated with workspace/session restore
- historical-only fallback behavior for unreconnectable sessions
- packaged app verification
- explicit service URL/config abstraction for future remote support
- release checklist for v1

**Likely files/modules:**
- Modify: `src/service/orchestration/reconnect-manager.ts`
- Modify: `src/service/orchestration/runtime-manager.ts`
- Modify: `src/service/persistence/workspace-store.ts`
- Modify: `src/desktop/lifecycle/service-process.ts`
- Modify: `src/web/lib/api-client.ts`
- Create: `src/service/orchestration/reconnect-manager.test.ts`
- Create: `src/web/lib/api-client.test.ts`
- Create: `docs/superpowers/release-checklists/workspace-gui-successor-v1.md`

**Implementation notes:**
1. Service restarts must restore:
   - workspace list
   - session metadata
   - selected session where possible
   - historical session visibility
2. Unreconnectable sessions should remain legible and actionable as history:
   - visible summary
   - linked artifacts
   - repo/worktree context
   - explicit “historical-only” state
3. The UI API client must already support a configurable base URL.
4. Keep loopback local as the only supported v1 mode, but remove assumptions that the service always lives in the same process or machine.
5. Add a release checklist that explicitly verifies:
   - packaging
   - recovery
   - attention ordering
   - session intervention
   - workspace multi-repo handling
   - HQ-optional behavior

**Verification guidance:**
- Run:
  ```bash
  npm test -- src/service/orchestration/reconnect-manager.test.ts src/web/lib/api-client.test.ts
  npm test
  npm run check
  npm run build
  npm run package:dir
  ```
  Expected:
  - all tests PASS
  - typecheck PASS
  - build PASS
  - packaged app directory created
- Manual restart test:
  1. launch app
  2. create workspace with multiple repos/worktrees
  3. start multiple sessions
  4. quit app mid-session
  5. relaunch
  Expected:
  - workspace restored
  - reconnectable sessions return live
  - unreconnectable sessions remain visible as historical-only
  - no session disappears silently

---

## v1 acceptance checklist

The implementation should not be considered complete until all of these are true:

- [ ] The app launches as a packaged desktop GUI, not just a dev webpage.
- [ ] The UI talks to a separate local orchestration service over explicit transport contracts.
- [ ] A workspace can contain multiple repos, worktrees, and sessions.
- [ ] The home screen is a live operations dashboard.
- [ ] Sessions are the primary attention objects throughout the product.
- [ ] The selected session view balances understanding and intervention equally.
- [ ] Shell exists only as a fallback path.
- [ ] HQ is entirely optional.
- [ ] Local restart preserves workspaces and visible session history.
- [ ] No core workflow depends on transcript-first reading.

---

## Suggested implementation order summary

1. Task 1 — app scaffold
2. Task 2 — shared domain/contracts
3. Task 3 — local persistence/registry
4. Task 4 — pi runtime service
5. Task 5 — loopback API + SSE
6. Task 6 — Electron lifecycle
7. Task 7 — home dashboard
8. Task 8 — session command center
9. Task 9 — workspace context/artifacts
10. Task 10 — hardening and packaging

---

## Final verification pass

Once all tasks are complete, run:

```bash
npm test
npm run check
npm run build
npm run package:dir
```

Expected:
- all unit/integration tests pass
- typecheck passes
- desktop app builds
- packaged app directory is produced successfully

Then perform a manual end-to-end check with:
- one workspace
- at least two repos
- at least three sessions
- one attention-needing session
- one pinned summary
- one intervention
- one historical-only session after forced restart/reconnect failure

Expected:
- the dashboard remains calm and legible
- the most urgent session is obvious
- the operator can understand and act without transcript reading in routine cases
- the app feels like the main product, not a polished prototype overlay
