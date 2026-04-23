# Service-Backed Live Workspace Slice Design

Date: 2026-04-23
Project: Jackdaw successor direction
Topic: Replace the GUI placeholder with real workspace/session data from the local service
Related docs:
- docs/superpowers/plans/2026-04-17-workspace-gui-successor.md
- docs/superpowers/specs/2026-04-17-workspace-gui-successor-design.md
- src/orchestration/activity.ts
- src/orchestration/status.ts
- src/orchestration/registry.ts
- src/orchestration/supervisor.ts

## Summary

The next vertical slice should connect the new Electron + service + React app to real workspace/session data instead of placeholder UI content. The service will expose workspace and session read APIs backed by a small local in-memory demo state that already uses the shared domain DTOs. The web app will fetch that state, render a real workspace summary and attention-ordered session list, and allow selecting a session to inspect core details. This keeps the architecture boundary real now without prematurely porting the full pi runtime manager into the new service path.

## Problem

The current foundation proves the app boots, but not the product model:
- `src/service/server.ts` only serves `/health`
- `src/web/App.tsx` renders hard-coded `placeholderSessions`
- the GUI does not yet prove workspace-centered reads, attention ordering, or selected-session understanding

That means the most important remaining uncertainty is not packaging anymore. It is whether the new service and web layers can represent the validated session-first model cleanly.

## Goals

- Expose real read endpoints for workspace and session state from the local service
- Render the web UI from fetched service data, not placeholders
- Preserve the new `shared/domain` and `shared/transport` contracts as the source of truth
- Keep the implementation small enough to remain a vertical slice, not a full service rewrite
- Prepare a clean seam for later replacement of demo state with actual orchestration/runtime state

## Non-goals

- Full pi session runtime integration in the new service path
- Mutation endpoints for spawn, steer, follow-up, abort, shell fallback, or pinning
- SSE/live streaming in this slice
- Full persistence for the new workspace/session service state
- Complete workspace explorer, artifact browser, or intervention workflow

## Options considered

### Option A: Port the full supervisor into the new service now

Pros:
- Maximum realism immediately
- Avoids temporary demo state

Cons:
- Too much scope for one slice
- Higher risk of mixing prototype assumptions into the new service tree too early
- Harder to validate the API/UI contract independently

### Option B: Add read-only workspace/session APIs backed by deterministic local service state

Pros:
- Smallest useful vertical slice
- Lets the React UI prove the domain model and attention ordering now
- Keeps a clean adapter seam for later runtime integration
- Easier to test thoroughly

Cons:
- Uses seeded state temporarily instead of real pi sessions
- Another migration step later

### Recommendation

Choose Option B.

This slice should prove the new architecture and UI model with real contracts and real fetch/render behavior while deferring runtime porting to the next slice.

## Proposed design

## Service layer

Add a small read model under `src/service/` that owns one seeded workspace and a few seeded sessions in shared-domain shapes.

New modules:
- `src/service/demo-state.ts`
  - returns deterministic `Workspace`, `WorkspaceSession[]`, `WorkspaceArtifact[]`, and `AttentionEvent[]`
  - sorts sessions using the existing shared attention/status semantics
- `src/service/server.test.ts`
  - verifies the new endpoints and response shapes

Update `src/service/server.ts` to expose:
- `GET /health` (existing)
- `GET /workspaces`
- `GET /workspaces/:workspaceId`
- `GET /workspaces/:workspaceId/sessions`

Behavior:
- `GET /workspaces` returns `WorkspaceSummaryDto[]` via `summarizeWorkspace(...)`
- `GET /workspaces/:workspaceId` returns the full `WorkspaceDetailDto`, including `sessions` already sorted by attention priority
- `GET /workspaces/:workspaceId/sessions` returns the same attention-ordered sessions list independently for contract completeness and future UI fetch splitting, even though the web app in this slice will not call it
- unknown workspace IDs return 404 with a small error body

The service state should be deliberately structured so the UI proves meaningful cases:
- at least one `awaiting-input` session
- at least one `running` session
- at least one `idle` or `done` session
- one selected-session-worthy summary with recent files and last intervention data

## Web UI

Replace placeholder session data with fetched service data.

`src/web/App.tsx` should:
- fetch `/workspaces` on load
- auto-select the first workspace
- fetch `/workspaces/:workspaceId` for details
- use the `sessions` included in `WorkspaceDetailDto` as the only session source for this slice
- track loading/error/ready states separately for health and workspace data
- render:
  - top bar with selected workspace name
  - health panel from `/health`
  - workspace summary panel using real counts and attention band
  - attention rail from fetched sessions
  - selected session detail panel showing summary, repo/cwd/branch, current activity, recent files, and intervention state

Selection behavior:
- default to the first session in the returned ordered list
- clicking a session row updates the detail panel
- preserve selection across workspace-detail refetches only if the selected session still exists; no polling or SSE refresh is part of this slice

## Shared-contract usage

This slice should reuse the already-defined DTOs instead of inventing local UI-only types. The web layer should treat `WorkspaceSummaryDto`, `WorkspaceDetailDto`, and `WorkspaceSession` as canonical.

## Error handling

Service:
- 404 for missing workspace
- stable JSON response for route failures via Fastify defaults

Web:
- show a workspace error card if loading fails
- keep health and workspace loading states independent so a workspace failure does not hide service-health feedback
- show an empty-state message if a workspace has zero sessions

## Testing

Add service tests for:
- `GET /workspaces` returns one or more summaries
- `GET /workspaces/:workspaceId` returns detail with sessions ordered by attention priority
- `GET /workspaces/:workspaceId/sessions` returns the same workspace ID and ordered sessions
- missing workspace returns 404

Add web tests for:
- initial loading state
- successful render from mocked fetch responses
- session selection updates the detail panel
- workspace fetch error renders a visible error state

This slice explicitly includes the minimal React test harness setup needed to make those tests real:
- add `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` dev dependencies
- configure Vitest to run web tests in a jsdom environment

## Implementation notes

- Keep seeded state generation deterministic and side-effect free
- Avoid adding persistence or runtime abstractions prematurely
- Keep endpoint and UI names aligned with the existing shared transport contracts
- Use the shared `attentionBandForStatus`, `createAttentionCandidate`, and `compareAttentionCandidates` semantics where helpful so the new slice stays aligned with the validated prototype ordering rules

## Acceptance criteria

- The desktop app still boots successfully
- The service exposes workspace/session read endpoints in addition to `/health`
- The React app no longer contains hard-coded placeholder session cards
- The attention rail is rendered from fetched service data
- Clicking a session updates a real detail panel
- Tests cover the new service endpoints and web selection/error behavior
- Typecheck and tests pass

## Follow-up after this slice

The next implementation slice should replace seeded service state with a real workspace/session controller backed by the new service-side orchestration layer, then add streaming updates and basic session actions.