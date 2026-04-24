# Dev-Local API CORS Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Restore Electron+Vite development access to the loopback Fastify service by adding a narrowly scoped development-only CORS allowlist for the two known Vite origins, covering both REST and workspace SSE requests.
**Architecture:** Keep the fix entirely inside the local service layer. Add a tiny development-only CORS policy in `src/service/server.ts` that only allows `http://127.0.0.1:5173` and `http://localhost:5173`, then prove that the headers survive the hijacked SSE response path in `src/service/api/sse/workspace-stream.ts`. Do not change the loopback topology, service port discovery, preload bootstrap flow, or production behavior.
**Tech Stack:** TypeScript, Fastify 5, Electron 39, Vite 7, Vitest

---

## Scope check

This spec is one small subsystem, not multiple independent projects. It should stay as a single plan and a single vertical fix.

### In scope
- development-only CORS behavior in the Fastify service
- allowlist limited to:
  - `http://127.0.0.1:5173`
  - `http://localhost:5173`
- REST coverage for dashboard requests such as `/health` and `/workspaces`
- SSE coverage for `/workspaces/:workspaceId/events`
- automated service tests proving allowed and disallowed behavior
- manual Electron dev validation proving the renderer uses the dynamic service port without CORS failures

### Out of scope
- wildcard or configurable CORS origins
- production CORS behavior
- Vite proxying or transport redesign
- CSP changes
- changes to preload, desktop service boot, or service port allocation logic

---

## Existing codebase map

Verified current modification points:

- `src/service/server.ts:1-43`
  - creates the Fastify instance and registers all REST and SSE route modules
  - currently has no CORS logic and no environment-gated service hooks
- `src/service/api/sse/workspace-stream.ts:11-119`
  - manually hijacks the reply and calls `reply.raw.writeHead(...)` for SSE
  - this is the one place where CORS headers can be lost if they are only set on the normal Fastify reply path
- `src/service/server.test.ts:1-98`
  - already exercises server-level route behavior with `app.inject(...)`
  - best place for REST CORS tests because it reaches `/health` and `/workspaces` through the full server wiring
- `src/service/api/sse/workspace-stream.test.ts:17-228`
  - already starts a real listening server and inspects live SSE responses over `node:http`
  - best place to assert actual SSE response headers and stream behavior
- `src/service/main.ts:1-48`
  - confirms development mode is determined by `process.env.NODE_ENV === "development"`
  - should remain unchanged so the current loopback architecture stays intact
- `vite.config.ts:1-21`
  - hard-codes the dev server host/port to `127.0.0.1:5173`
- `package.json:6-24`
  - dev scripts already run Electron against the Vite renderer and dynamic loopback service
  - no extra script is required for this fix
- `src/desktop/main.ts:33-63`
  - finds an open loopback port dynamically and passes the real base URL through preload
  - must remain unchanged
- `src/desktop/preload.cts:1-10`
  - exposes `window.jackdaw.bootstrap.serviceBaseUrl`
  - useful for manual dev validation

### Existing patterns to follow
- keep tests in Vitest under `src/**/*.test.ts`
- use small per-file test helpers rather than introducing shared abstraction for a tiny change
- use explicit string assertions for JSON and headers
- keep environment-specific logic small and local

---

## Planned file changes

### Modify
- `src/service/server.ts`
  - add a tiny development-only CORS allowlist helper and request hook
- `src/service/api/sse/workspace-stream.ts`
  - preserve any CORS headers on the hijacked SSE response path if server-level headers are not automatically carried through
- `src/service/server.test.ts`
  - add REST CORS coverage for allowed dev origins and non-dev / non-allowlisted requests
- `src/service/api/sse/workspace-stream.test.ts`
  - add SSE CORS header coverage for an allowed dev origin

### Likely unchanged
- `src/service/api/routes/workspaces.test.ts`
- `vite.config.ts`
- `package.json`
- `src/service/main.ts`

If implementation proves a Fastify plugin dependency is absolutely required, stop and reassess first. The approved spec explicitly wants the minimal targeted fix.

---

## Implementation strategy

1. Prove the missing REST CORS headers with server-level tests.
2. Add the smallest possible dev-only allowlist in `src/service/server.ts`.
3. Prove the SSE endpoint still lacks headers if the hijacked response path drops them.
4. Patch `src/service/api/sse/workspace-stream.ts` only as much as needed to preserve those headers.
5. Run targeted tests, then typecheck, then manual Electron validation.

The implementation should prefer a small in-repo helper over adding a new dependency.

---

## Task 1: Add development-only REST CORS handling at the service boundary

**Files:**
- Modify: `src/service/server.ts:1-43`
- Modify: `src/service/server.test.ts:1-98`

- [ ] **Step 1: Write the failing REST CORS tests**
Update `src/service/server.test.ts` to add these cases to the existing `describe("service server", ...)` block:

1. `GET /health` in development with `Origin: http://127.0.0.1:5173` returns:
   - `statusCode === 200`
   - header `access-control-allow-origin: http://127.0.0.1:5173`
   - header `vary` contains `Origin`
2. `GET /workspaces` in development with `Origin: http://localhost:5173` returns:
   - `statusCode === 200`
   - header `access-control-allow-origin: http://localhost:5173`
3. `GET /health` in development with `Origin: http://evil.example:5173` does **not** return `access-control-allow-origin`
4. `GET /health` outside development with `Origin: http://127.0.0.1:5173` does **not** return `access-control-allow-origin`
5. optional but recommended: `OPTIONS /workspaces` in development with an allowed origin returns `204` and includes `access-control-allow-origin`

Implementation details for the tests:
- use `vi.stubEnv("NODE_ENV", "development")` for dev cases and `vi.stubEnv("NODE_ENV", "test")` or `vi.unstubAllEnvs()` for non-dev cases
- import `vi` from `vitest`
- keep the existing `createTestServer()` helper; do not create a second server factory
- send headers through `server.inject({ headers: { origin: "..." } })`
- add an `afterEach` cleanup that restores env stubs if needed

- [ ] **Step 2: Run the REST CORS test file and verify it fails**
Run:
```bash
npm test -- src/service/server.test.ts
```
Expected: FAIL with assertions showing `access-control-allow-origin` is missing.

- [ ] **Step 3: Implement the minimal development-only CORS policy**
Update `src/service/server.ts` with a small helper near the top of the file:

```ts
const DEV_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function getAllowedDevelopmentOrigin(origin: string | undefined): string | undefined {
  if (process.env.NODE_ENV !== "development") {
    return undefined;
  }

  if (origin === undefined) {
    return undefined;
  }

  return DEV_ALLOWED_ORIGINS.has(origin) ? origin : undefined;
}
```

Then, inside `createServer(...)`, immediately after `const app = Fastify(...)`, add one narrow request hook:

```ts
app.addHook("onRequest", async (request, reply) => {
  const requestOrigin = Array.isArray(request.headers.origin)
    ? request.headers.origin[0]
    : request.headers.origin;
  const allowedOrigin = getAllowedDevelopmentOrigin(requestOrigin);

  if (allowedOrigin === undefined) {
    return;
  }

  reply.raw.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  reply.raw.setHeader("Vary", "Origin");
  reply.raw.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");

  if (request.method === "OPTIONS") {
    reply.code(204).send();
  }
});
```

Implementation constraints:
- do not add `*`
- do not enable credentials
- do not make origins configurable in this change
- do not change route registration or dynamic port logic
- keep all imports at the top
- keep every parameter and return type explicit where new helpers are added

- [ ] **Step 4: Run the REST CORS tests again**
Run:
```bash
npm test -- src/service/server.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**
Run:
```bash
git add src/service/server.ts src/service/server.test.ts
git commit -m "Add dev-only CORS allowlist for local service"
```

---

## Task 2: Preserve the same dev-only CORS behavior on the SSE stream

**Files:**
- Modify: `src/service/api/sse/workspace-stream.ts:11-119`
- Modify: `src/service/api/sse/workspace-stream.test.ts:17-228`

- [ ] **Step 1: Write the failing SSE CORS test**
Update `src/service/api/sse/workspace-stream.test.ts` so `connectToWorkspaceEvents(...)` accepts an optional `origin?: string` argument and forwards it in the request headers.

Add a new test case:
- start the server in development mode with `vi.stubEnv("NODE_ENV", "development")`
- connect to `/workspaces/:workspaceId/events` with `Origin: http://127.0.0.1:5173`
- assert:
  - `response.statusCode === 200`
  - `response.headers["content-type"]` contains `text/event-stream`
  - `response.headers["access-control-allow-origin"] === "http://127.0.0.1:5173"`
  - `response.headers["vary"]` contains `Origin`
  - the first parsed SSE event is still `workspace.snapshot`

Also add one non-allowlisted assertion if it stays simple:
- connect with `Origin: http://evil.example:5173`
- assert the stream still answers, but `access-control-allow-origin` is absent

- [ ] **Step 2: Run the SSE test file and verify it fails**
Run:
```bash
npm test -- src/service/api/sse/workspace-stream.test.ts
```
Expected: FAIL because the SSE response currently calls `reply.raw.writeHead(...)` without proving that the pre-set CORS headers survive the hijacked path.

- [ ] **Step 3: Patch the SSE response header handling minimally**
If the new test is already green after Task 1, do not change `src/service/api/sse/workspace-stream.ts`; just keep the test.

If the test fails, update `src/service/api/sse/workspace-stream.ts` immediately before `reply.raw.writeHead(200, ...)` to preserve already-set headers:

```ts
const accessControlAllowOrigin = reply.raw.getHeader("Access-Control-Allow-Origin");
const varyHeader = reply.raw.getHeader("Vary");
const accessControlAllowMethods = reply.raw.getHeader("Access-Control-Allow-Methods");
const accessControlAllowHeaders = reply.raw.getHeader("Access-Control-Allow-Headers");

reply.raw.writeHead(200, {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  ...(typeof accessControlAllowOrigin === "string"
    ? { "access-control-allow-origin": accessControlAllowOrigin }
    : {}),
  ...(typeof varyHeader === "string" ? { vary: varyHeader } : {}),
  ...(typeof accessControlAllowMethods === "string"
    ? { "access-control-allow-methods": accessControlAllowMethods }
    : {}),
  ...(typeof accessControlAllowHeaders === "string"
    ? { "access-control-allow-headers": accessControlAllowHeaders }
    : {}),
});
```

Implementation constraints:
- keep the existing SSE semantics unchanged
- do not change event replay, keepalive, or close handling
- only preserve headers already set by the server-level dev-only policy

- [ ] **Step 4: Run the SSE tests again**
Run:
```bash
npm test -- src/service/api/sse/workspace-stream.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**
Run:
```bash
git add src/service/api/sse/workspace-stream.ts src/service/api/sse/workspace-stream.test.ts
git commit -m "Preserve dev CORS headers on workspace SSE"
```

---

## Task 3: Final verification and manual Electron dev validation

**Files:**
- No new code files expected
- Verification uses the files changed in Tasks 1-2

- [ ] **Step 1: Run the targeted automated verification**
Run:
```bash
npm test -- src/service/server.test.ts src/service/api/sse/workspace-stream.test.ts
npm run check
```
Expected:
- both Vitest files PASS
- `npm run check` exits successfully with no TypeScript errors

- [ ] **Step 2: Run Electron dev mode and verify real renderer behavior**
Run:
```bash
npm run dev:gui
```
Expected startup signals:
- Vite serves `http://127.0.0.1:5173`
- Electron logs a service base URL on `http://127.0.0.1:<dynamic-port>`
- the app window opens without falling back to `7345`

Manual checks inside the running app:
1. Open DevTools.
2. In the console, run:
   ```js
   window.jackdaw.bootstrap.serviceBaseUrl
   ```
   Expected: `http://127.0.0.1:<dynamic-port>` where `<dynamic-port>` is not hard-coded and is usually not `7345`.
3. Reload the app and confirm the dashboard loads instead of showing fetch/CORS failures.
4. In the Network tab, inspect the `GET /health` request.
   Expected response headers include:
   - `Access-Control-Allow-Origin: http://127.0.0.1:5173`
   - `Vary: Origin`
5. Inspect the `GET /workspaces` request.
   Expected: same allowed-origin header behavior and a successful JSON response.
6. Inspect the `GET /workspaces/:workspaceId/events` SSE request.
   Expected:
   - request reaches the same dynamic loopback service port
   - response is `200`
   - `Content-Type` is `text/event-stream`
   - `Access-Control-Allow-Origin: http://127.0.0.1:5173`
   - no CORS errors appear in the renderer console
7. Confirm the UI stream indicator reaches its normal connected/live state rather than staying disconnected.

- [ ] **Step 3: Stop dev processes and commit the verification checkpoint**
If everything above is green, stop the dev session and run:
```bash
git add src/service/server.ts src/service/server.test.ts src/service/api/sse/workspace-stream.ts src/service/api/sse/workspace-stream.test.ts
git commit -m "Verify dev-local API CORS follow-up"
```

---

## Sequencing notes

- Do Task 1 first. It establishes the service-wide allowlist and proves production remains closed.
- Do Task 2 second. It validates the one tricky response path: the hijacked SSE stream.
- Do Task 3 last. Do not claim completion before both automated and manual verification are done.

---

## Acceptance checklist

- [ ] Development requests from `http://127.0.0.1:5173` receive `Access-Control-Allow-Origin`
- [ ] Development requests from `http://localhost:5173` receive `Access-Control-Allow-Origin`
- [ ] Non-allowlisted origins do not receive CORS allow headers
- [ ] Non-development mode does not enable this allowlist
- [ ] `/health` and `/workspaces` work from the Vite renderer in dev
- [ ] `/workspaces/:workspaceId/events` works from `EventSource` in dev
- [ ] Dynamic loopback service port behavior remains unchanged
- [ ] `npm test -- src/service/server.test.ts src/service/api/sse/workspace-stream.test.ts` passes
- [ ] `npm run check` passes
- [ ] Manual Electron dev validation shows no renderer CORS failures
