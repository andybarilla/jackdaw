# Dev Local API CORS Support Design

## Summary

Add narrowly scoped **development-only CORS support** to the local Jackdaw Fastify service so the Electron app can load the renderer from the Vite dev server at `http://127.0.0.1:5173` or `http://localhost:5173` while still calling the loopback API and SSE endpoints on a dynamically assigned local port.

This addresses the current dev-only failure mode where the renderer successfully receives the real service base URL from preload, but browser CORS rules block `fetch()` and `EventSource` requests because the service does not emit `Access-Control-Allow-Origin` headers.

## Problem

Current dev topology:
- renderer origin: `http://127.0.0.1:5173` from Vite
- local API origin: `http://127.0.0.1:<dynamic-port>` from the Fastify service
- transport: `fetch()` for REST + `EventSource` for SSE

Observed behavior:
- preload now works and exposes the real dynamic service URL
- browser treats renderer → service calls as cross-origin
- Fastify service does not send CORS headers
- `GET /health`, `GET /workspaces`, and SSE requests are blocked by CORS in dev

## Goals

- Fix the dev-mode CORS failure for the Vite-served renderer
- Support both REST and SSE requests used by the dashboard
- Keep the scope minimal and local to development
- Avoid broad production CORS exposure
- Preserve the current loopback architecture and dynamic service port behavior

## Non-goals

- General remote API access support
- Opening the service to arbitrary browser origins
- Reworking the transport boundary or Electron renderer boot flow
- Solving the separate Electron dev CSP warning in this change

## Options considered

### Option A — Development-only service CORS allowlist
Add CORS handling in the Fastify service only when running in development, limited to known Vite dev origins:
- `http://127.0.0.1:5173`
- `http://localhost:5173`

#### Pros
- Smallest targeted fix
- Preserves current architecture
- Covers both `fetch()` and `EventSource`
- Keeps production surface tight

#### Cons
- Dev-only configuration path to maintain
- If the Vite port changes later, the allowlist must be updated or made configurable

### Option B — Broader loopback CORS support
Allow a wider set of loopback origins or wildcard local origins.

#### Pros
- More flexible for future local tooling setups

#### Cons
- Broader than needed
- Easier to accidentally overexpose the local API during development
- Not justified by the current bug

### Option C — Avoid service CORS and proxy another way
Proxy API calls through Vite or an Electron-only boundary instead of enabling service CORS.

#### Pros
- Could avoid browser CORS entirely

#### Cons
- Larger refactor
- Adds moving parts to the dev topology
- Unnecessary for this targeted bug

## Decision

Choose **Option A**: add **development-only CORS support** in the Fastify service for the specific Vite dev origins.

## Proposed design

### Service behavior
In development only:
- allow cross-origin requests from:
  - `http://127.0.0.1:5173`
  - `http://localhost:5173`
- apply the policy to the REST endpoints and the SSE endpoint
- support preflight handling if needed by future routes

Outside development:
- do not enable this dev CORS allowlist
- keep existing packaged behavior unchanged

### Configuration shape
Prefer a narrow implementation first:
- development check based on `NODE_ENV === "development"`
- explicit allowlist of the two known Vite origins

If needed later, this can be made configurable, but v1 of the fix should stay hard-coded and minimal.

### SSE impact
Because the workspace dashboard uses `EventSource` against `/workspaces/:workspaceId/events`, the same dev CORS policy must also allow the browser to open the SSE stream from the Vite origin.

### Error handling
Requests from non-allowlisted origins in development should continue to fail CORS normally.

## Affected files

Likely:
- `src/service/server.ts`

Possibly tests near:
- `src/service/server.test.ts`
- `src/service/api/routes/workspaces.test.ts`
- `src/service/api/routes/sessions.test.ts`
- `src/service/api/sse/workspace-stream.test.ts`

## Verification

### Automated
- add or update service tests that verify CORS headers are present for allowed dev origins
- add or update SSE test coverage if needed for allowed origin handling
- run relevant service tests
- run `npm run check`

### Manual
In Electron dev mode with Vite:
- open the app
- confirm `GET /health` succeeds from the renderer
- confirm `GET /workspaces` succeeds from the renderer
- confirm the workspace SSE stream connects without CORS failure
- confirm requests are using the real dynamic service port, not the fallback `7345`

## Acceptance criteria

- No CORS error in dev for `GET /health`
- No CORS error in dev for `GET /workspaces`
- No CORS error in dev for the workspace SSE endpoint
- Allowed origins are limited to the known Vite dev origins
- Production behavior is unchanged
