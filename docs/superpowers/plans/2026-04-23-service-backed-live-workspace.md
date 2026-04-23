# Service-Backed Live Workspace Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Replace the React placeholder workspace UI with service-backed live workspace/session reads, using deterministic local demo state exposed by the Fastify service and rendered by the Electron/Vite web app.
**Architecture:** Keep this slice read-only and end-to-end. Add a seeded service-side read model that returns shared-domain `Workspace`, `WorkspaceSession`, `WorkspaceArtifact`, and `AttentionEvent` data through the existing HTTP transport contracts, then update the React app to fetch `/health`, `/workspaces`, and `/workspaces/:workspaceId`, rendering workspace summary, attention-ordered sessions, and selected-session details directly from those responses. Do not add runtime integration, persistence, SSE, or mutations in this slice.
**Tech Stack:** TypeScript, Fastify, React 19, Vite, Vitest, React Testing Library, jsdom

---

## Scope guardrails

This plan is intentionally limited to one vertical slice.

### In scope
- deterministic demo workspace/session state inside `src/service/`
- read-only service endpoints:
  - `GET /health`
  - `GET /workspaces`
  - `GET /workspaces/:workspaceId`
  - `GET /workspaces/:workspaceId/sessions`
- attention-ordered session data using shared-domain semantics
- React fetch/render flow for health + workspace data
- default session selection and click-to-select behavior
- service endpoint tests
- web UI tests with mocked fetch responses
- Vitest jsdom setup needed to make those UI tests real

### Out of scope
- pi runtime integration
- persistence
- SSE or polling
- mutation endpoints or command handling
- multi-workspace navigation beyond auto-selecting the first returned workspace
- desktop shell changes beyond whatever already works today

---

## Existing codebase map

Verified current modification points:

- `src/service/server.ts:1-20`
  - currently only registers `GET /health`
- `src/web/App.tsx:1-155`
  - currently fetches only `/health`
  - hard-codes `placeholderSessions`
  - has no workspace/session fetch state
- `src/shared/transport/api.ts:1-72`
  - already declares the read routes needed for this slice
- `src/shared/transport/dto.ts:18-39,114-131`
  - already defines `WorkspaceSummaryDto`, `WorkspaceDetailDto`, `SessionsListDto`, and `summarizeWorkspace(...)`
- `src/shared/domain/session.ts:1-93`
  - defines canonical `WorkspaceSession` shape and status ordering helpers
- `src/shared/domain/attention.ts:1-40`
  - defines canonical attention-band helpers and stable ordering via `createAttentionCandidate(...)` + `compareAttentionCandidates(...)`
- `package.json:7-20,27-42`
  - currently has `vitest` but no React Testing Library or jsdom
- `vite.config.ts:1-21`
  - currently has no `test` config

Existing testing patterns to match:
- pure Vitest unit tests under `src/**/*.test.ts`
- shared-domain tests keep fixtures small and explicit
- no existing React/jsdom harness yet

---

## Planned file changes

### New files
- `src/service/demo-state.ts`
- `src/service/server.test.ts`
- `src/web/App.test.tsx`
- `src/web/test/setup.ts`

### Modified files
- `src/service/server.ts:1-20`
- `src/web/App.tsx:1-155`
- `package.json:7-20,27-42`
- `vite.config.ts:1-21`

### Likely unchanged but used as source-of-truth
- `src/shared/transport/api.ts`
- `src/shared/transport/dto.ts`
- `src/shared/domain/session.ts`
- `src/shared/domain/workspace.ts`
- `src/shared/domain/attention.ts`
- `src/shared/domain/artifact.ts`

If implementation reveals a missing transport type, add the smallest shared DTO needed instead of inventing a web-local type.

---

## Phase 1: Seeded service read model and endpoint coverage

### Task 1: Add deterministic demo workspace/session state

**Files:**
- Create: `src/service/demo-state.ts`
- Modify: `src/service/server.ts:1-20`
- Test: `src/service/server.test.ts`

- [ ] **Step 1: Write the failing service tests**
Create `src/service/server.test.ts` with Fastify `app.inject(...)` coverage for:
1. `GET /workspaces` returns at least one `WorkspaceSummaryDto`
2. `GET /workspaces/:workspaceId` returns `WorkspaceDetailDto` with attention-ordered `sessions`
3. `GET /workspaces/:workspaceId/sessions` returns `{ workspaceId, sessions }` with the same ordering
4. unknown workspace returns `404` with a JSON error body containing at least an `error` string

Use explicit assertions against ordering, not just count checks. The test fixture expectations should prove this exact priority order for the seeded data:
- first session: `awaiting-input`
- second session: `running`
- third session: `idle` or `done`

Implementation detail for the tests:
- instantiate the server with `createServer({ appDataDir: "/tmp/jackdaw-test" })`
- call `await app.close()` in `afterEach`
- parse JSON bodies and assert exact route shapes

- [ ] **Step 2: Run the service test to verify it fails**
Run:
```bash
npm test -- src/service/server.test.ts
```
Expected: FAIL because `GET /workspaces`, `GET /workspaces/:workspaceId`, and `GET /workspaces/:workspaceId/sessions` are not registered yet.

- [ ] **Step 3: Implement the demo read model**
Create `src/service/demo-state.ts` with side-effect-free functions only. Keep imports at the top and type everything explicitly.

Required exports:
- `DEMO_WORKSPACE_ID: string`
- `listDemoWorkspaceSummaries(): WorkspaceSummaryDto[]`
- `getDemoWorkspaceDetail(workspaceId: string): WorkspaceDetailDto | undefined`
- `getDemoWorkspaceSessions(workspaceId: string): SessionsListDto | undefined`

Implementation requirements:
1. Seed exactly one workspace with deterministic timestamps and IDs.
2. Seed at least three sessions covering these statuses:
   - one `awaiting-input`
   - one `running`
   - one `idle` or `done`
3. Seed one selected-session-worthy session that includes:
   - `recentFiles` with at least two entries
   - `lastIntervention`
   - `currentActivity`
   - `branch`
   - `repoRoot` and `cwd`
4. Seed at least one `AttentionEvent` and one `WorkspaceArtifact`, even if the first UI pass does not render every field.
5. Order sessions using shared semantics, not a hand-coded status array inside the service module:
   - build candidates with `createAttentionCandidate(session, insertionOrder)`
   - sort with `compareAttentionCandidates(...)`
6. Build summaries with `summarizeWorkspace(...)`.
7. Do not read the clock dynamically in demo-state; use fixed ISO strings so tests stay deterministic.

- [ ] **Step 4: Wire the new read routes into the server**
Update `src/service/server.ts` to:
- keep `GET /health` unchanged
- add `GET /workspaces`
- add `GET /workspaces/:workspaceId`
- add `GET /workspaces/:workspaceId/sessions`

Route behavior:
- `GET /workspaces` returns `listDemoWorkspaceSummaries()`
- `GET /workspaces/:workspaceId` returns the detail DTO or `reply.code(404)` with a small JSON body such as `{ error: "Workspace not found" }`
- `GET /workspaces/:workspaceId/sessions` returns the list DTO or the same 404 body

Do not add new abstractions for route registration in this slice. Keep all route handlers in `server.ts` until there is enough code to justify extraction.

- [ ] **Step 5: Run the service tests to verify they pass**
Run:
```bash
npm test -- src/service/server.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**
Run:
```bash
git add src/service/demo-state.ts src/service/server.ts src/service/server.test.ts
git commit -m "Add demo workspace read endpoints"
```

---

## Phase 2: Web test harness and fetch-driven state

### Task 2: Add jsdom + React Testing Library support for the web slice

**Files:**
- Modify: `package.json:7-20,27-42`
- Modify: `vite.config.ts:1-21`
- Create: `src/web/test/setup.ts`
- Test: `src/web/App.test.tsx`

- [ ] **Step 1: Write the failing web tests**
Create `src/web/App.test.tsx` using React Testing Library. Mock `global.fetch` directly; do not introduce a custom API client in this slice.

Cover these cases:
1. initial loading state renders both health-loading and workspace-loading copy
2. successful fetch sequence renders:
   - workspace name in the top bar or workspace panel
   - real session rows from the detail DTO
   - selected-session details for the first ordered session
3. clicking a different session row updates the detail panel
4. workspace fetch failure renders a visible workspace error card while health can still render normally

Testing implementation rules:
- mock `/health`, `/workspaces`, and `/workspaces/:workspaceId`
- use shared DTO-compatible objects in fixtures
- assert user-visible text, not implementation state
- restore mocks after each test

- [ ] **Step 2: Run the web test to verify it fails**
Run:
```bash
npm test -- src/web/App.test.tsx
```
Expected: FAIL because jsdom/RTL are not configured and `App.tsx` still renders placeholder content.

- [ ] **Step 3: Add the minimal test harness**
Modify `package.json` dev dependencies to add:
- `@testing-library/react`
- `@testing-library/jest-dom`
- `jsdom`

Update `vite.config.ts` to include a `test` block with:
- `environment: "jsdom"`
- `setupFiles: ["./src/web/test/setup.ts"]`
- keep existing Vite config unchanged otherwise

Create `src/web/test/setup.ts` to:
- import `@testing-library/jest-dom/vitest`
- restore mocks after each test if needed

Do not add extra test utilities yet.

- [ ] **Step 4: Run the web test again to confirm it now fails for the right reason**
Run:
```bash
npm test -- src/web/App.test.tsx
```
Expected: FAIL with assertions showing placeholder UI behavior or missing workspace rendering, not missing jsdom.

- [ ] **Step 5: Commit**
Run:
```bash
git add package.json vite.config.ts src/web/test/setup.ts src/web/App.test.tsx
git commit -m "Add web test harness for live workspace slice"
```

---

## Phase 3: Replace placeholder UI with service-backed workspace/session rendering

### Task 3: Fetch workspace data and render the real attention rail

**Files:**
- Modify: `src/web/App.tsx:1-155`
- Test: `src/web/App.test.tsx`

- [ ] **Step 1: Extend the failing web tests with exact UI expectations**
Before changing `App.tsx`, make sure `src/web/App.test.tsx` asserts all of the following visible behaviors:
- the placeholder heading `GUI foundation is live` is gone after successful data load
- the attention panel shows the real session count from fetched data
- the first fetched session is selected by default
- selected-session details show:
  - session name
  - summary text (`pinnedSummary` when present, otherwise `liveSummary`, only if that is the chosen UI rule)
  - repo root or cwd
  - branch
  - current activity
  - recent file paths
  - intervention status/text when present
- if the selected session disappears during a refetch triggered by a workspace change, selection falls back to the first remaining session

For this slice, one refetch test is enough. Simulate it by mocking `/workspaces` to return at least two workspaces and mocking distinct `/workspaces/:workspaceId` responses, then drive a workspace change through the rendered UI or by remounting with a controlled fetch sequence if the UI has no explicit workspace switcher yet. Do not rely on plain RTL `rerender(<App />)` alone to trigger a fetch.

- [ ] **Step 2: Run the web test to verify it fails**
Run:
```bash
npm test -- src/web/App.test.tsx
```
Expected: FAIL because the current component still uses `placeholderSessions` and has no selected-session detail panel.

- [ ] **Step 3: Rewrite `App.tsx` around explicit health + workspace state**
Refactor `src/web/App.tsx` without introducing unnecessary abstractions.

Required component state:
- `health: loading | ready | error`
- `workspaceSummaries: loading | ready | error`
- `workspaceDetail: loading | ready | error`
- `selectedWorkspaceId?: string`
- `selectedSessionId?: string`

Required fetch behavior:
1. On mount, fetch `/health` and `/workspaces` independently.
2. When workspace summaries load, auto-select the first workspace ID.
3. When `selectedWorkspaceId` changes, fetch `/workspaces/:workspaceId`.
4. When detail data arrives:
   - use `detail.sessions` as the only session source
   - default `selectedSessionId` to the first ordered session
   - preserve the current selection only if the session still exists in the new detail payload
5. No polling, retries, or SSE in this slice.

Required rendering changes:
- top bar: show selected workspace name when available
- health panel: keep current behavior
- workspace panel: replace placeholder copy with real summary values from the selected workspace/detail DTO
  - workspace description
  - repo root count
  - worktree count
  - session count
  - attention band
- attention rail:
  - render fetched sessions in returned order
  - make each session row clickable
  - show status, summary, and repo/branch context
  - highlight the selected session
- selected session detail panel:
  - session name
  - status
  - live summary and pinned summary if present
  - repo root, cwd, branch
  - current activity and current tool if present
  - recent files list
  - last intervention kind/status/text if present
- empty state:
  - if the selected workspace has zero sessions, show a clear empty-state message instead of the detail panel
- error state:
  - if `/workspaces` or `/workspaces/:workspaceId` fails, show a visible workspace error card while leaving the health panel intact

Implementation constraints:
- keep all imports at the top
- keep `bootstrap` local to this file
- use shared transport/domain types; do not create parallel UI interfaces
- prefer a few explicit helper functions inside `App.tsx` over creating a hook hierarchy for this small slice

- [ ] **Step 4: Run the web tests to verify they pass**
Run:
```bash
npm test -- src/web/App.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**
Run:
```bash
git add src/web/App.tsx src/web/App.test.tsx
git commit -m "Render live workspace data in web app"
```

---

## Phase 4: Full-slice verification

### Task 4: Verify the vertical slice end to end

**Files:**
- No new code expected unless verification exposes a real defect

- [ ] **Step 1: Run focused tests**
Run:
```bash
npm test -- src/service/server.test.ts src/web/App.test.tsx
```
Expected: PASS

- [ ] **Step 2: Run the full test suite**
Run:
```bash
npm test
```
Expected: PASS across existing tests plus the new service/web tests.

- [ ] **Step 3: Run typecheck**
Run:
```bash
npm run check
```
Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run production build**
Run:
```bash
npm run build
```
Expected: PASS producing desktop, service, and web build output.

- [ ] **Step 5: Manual service verification**
Run the service in one terminal:
```bash
npm run dev:service
```
Expected: service starts and logs a listening message.

Then verify routes in another terminal:
```bash
curl http://127.0.0.1:7345/health
curl http://127.0.0.1:7345/workspaces
curl http://127.0.0.1:7345/workspaces/ws-demo
curl http://127.0.0.1:7345/workspaces/ws-demo/sessions
```
Expected:
- `/health` returns JSON with `ok: true`
- `/workspaces` returns a non-empty array
- `/workspaces/ws-demo` returns workspace detail JSON with ordered sessions
- `/workspaces/ws-demo/sessions` returns the same ordered sessions list

If the seeded workspace ID differs, substitute the actual constant from `src/service/demo-state.ts`.

- [ ] **Step 6: Manual desktop/web verification**
Run:
```bash
npm run dev:gui
```
Expected in the Electron window:
- health panel still renders
- workspace panel shows the seeded workspace name and counts
- attention rail is no longer placeholder content
- clicking a session changes the detail panel
- if the seeded first session is `awaiting-input`, it appears first in the rail

- [ ] **Step 7: Commit verification-only fixes if needed**
If verification uncovered defects, fix them and commit with a narrow message such as:
```bash
git add <files>
git commit -m "Fix live workspace slice verification issues"
```

---

## Final acceptance checklist

Do not mark this slice complete until all of these are true:

- [ ] `src/web/App.tsx` no longer contains hard-coded `placeholderSessions`
- [ ] `src/service/server.ts` exposes the three new read routes in addition to `/health`
- [ ] demo service state uses shared-domain/shared-transport types
- [ ] workspace detail responses include sessions already ordered by attention priority
- [ ] the web app fetches and renders real workspace/session data from the service
- [ ] first session auto-selects on successful load
- [ ] clicking a session updates the detail panel
- [ ] workspace failures render a visible error state without hiding health state
- [ ] service tests pass
- [ ] web tests pass in jsdom
- [ ] `npm test`, `npm run check`, and `npm run build` all pass

---

## Suggested implementation order summary

1. Task 1 — demo service state + endpoint tests
2. Task 2 — jsdom/RTL harness
3. Task 3 — fetch-driven React rendering and selection behavior
4. Task 4 — full verification
