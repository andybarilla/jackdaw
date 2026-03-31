# Project Grouping Design

Group sidebar sessions by `cwd` so multiple agents in the same project are visually clustered. Frontend-only — no backend changes.

## Grouping Rules

- **Key**: exact `cwd` string match
- **Threshold**: only group when 2+ sessions share a `cwd`; single-session projects render as bare cards (no group wrapper)
- **Sort order**: groups ordered by the most recent `started_at` among their sessions, matching the existing sort

## Data Flow

A `$derived` in `Dashboard.svelte` transforms `sessionStore.sessions` into a render list:

1. Group sessions by `cwd` into `Map<string, Session[]>`
2. For each entry: if count >= 2, emit `{ type: 'group', cwd, sessions }`; otherwise emit `{ type: 'session', session }`
3. Order entries by most recent `started_at` (groups use the max across their sessions)

No changes to `SessionStore`, backend state, or the `session-update` event payload.

## ProjectGroup Component

New `src/lib/components/ProjectGroup.svelte`.

### Props

- `cwd: string`
- `sessions: Session[]`
- `selectedSessionId: string | null`
- `onSelect: (sessionId: string) => void`
- `onDismiss: (sessionId: string) => void`

### Visual Design (Card-Style Container)

- Outer container: `background: var(--card-bg)`, `border: 1px solid var(--border)`
- Header row (clickable, toggles collapse):
  - Chevron (▼/▶)
  - Project name via `getProjectName(cwd)`
  - Session count (e.g., "3 sessions")
  - Status dots: one colored dot per session, using `--state-{cardState}` colors
- When collapsed + any session needs attention: show highest-priority label (APPROVAL > INPUT) next to the count
- Body (when expanded): session cards rendered with `compact` mode, same styling as current sidebar cards

### State

- `collapsed = $state(false)` — expanded by default

## Dashboard Changes

Replace the flat `{#each sessionStore.sessions}` in the sidebar active tab with:

```svelte
{#each renderList as item (item.key)}
  {#if item.type === 'group'}
    <ProjectGroup
      cwd={item.cwd}
      sessions={item.sessions}
      {selectedSessionId}
      onSelect={selectSession}
      onDismiss={handleDismiss}
    />
  {:else}
    <div class="sidebar-session" ...>
      <SessionCard session={item.session} onDismiss={handleDismiss} compact />
    </div>
  {/if}
{/each}
```

### Keyboard Navigation

Unchanged. Next/prev session shortcuts operate on the flat `sessionStore.sessions` array, unaware of grouping. Selected session scrolls into view regardless of group state.

## Scope Exclusions

- No backend changes
- No persistence of collapse state
- No grouping by git root or common ancestor (exact cwd only)
- No grouping in the history tab
- No drag-and-drop reordering of groups
