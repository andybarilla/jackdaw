/* global React */
// Realistic workspace data covering all states the UI must represent.
// One workspace ("platform-auth"), several repos, sessions in every status.

const WORKSPACE = {
  id: 'ws-platform-auth',
  name: 'platform-auth',
  path: '~/work/platform-auth',
  repos: [
    { id: 'api',     name: 'platform/api',     branch: 'main',   worktrees: 4 },
    { id: 'web',     name: 'platform/web',     branch: 'main',   worktrees: 2 },
    { id: 'infra',   name: 'platform/infra',   branch: 'main',   worktrees: 1 },
    { id: 'docs',    name: 'platform/docs',    branch: 'main',   worktrees: 0 }
  ]
};

// Canonical status set: awaiting-input | blocked | failed | running | idle | done
const SESSIONS = [
  {
    id: 'ses-0f3a',
    name: 'Throw typed auth errors',
    status: 'awaiting-input',
    repo: 'platform/api', worktree: 'wt/auth-errors', branch: 'feat/auth-errors',
    activity: 'Waiting on approval: `rm src/auth/legacy-verifier.ts`',
    latest: 'Asked to delete legacy verifier (189 lines, last touched 2y ago).',
    updated: '14:42',
    duration: '21m',
    reason: 'Destructive file-system edit needs approval',
    files: ['src/auth/middleware.ts', 'src/auth/errors.ts', 'src/auth/legacy-verifier.ts'],
    linkedArtifact: { id: 'plan-auth-refactor', kind: 'plan', title: 'Auth error refactor' },
    model: 'claude-sonnet-4.5', pi: 'pi-0',
    live: 'Refactoring null-returns into typed UnauthorizedError across middleware, session, and verifier. 3 of 5 tasks done; held on legacy verifier deletion.',
    pinned: null,
    pinnedAt: null,
    added: 182, removed: 47,
    events: [
      { t:'14:22', kind:'start',  text:'Session started on feat/auth-errors' },
      { t:'14:23', kind:'tool',   text:'read src/auth/middleware.ts (+3 siblings)' },
      { t:'14:26', kind:'edit',   text:'edit src/auth/errors.ts (+8 / −0)' },
      { t:'14:31', kind:'edit',   text:'edit src/auth/middleware.ts (+12 / −4)' },
      { t:'14:38', kind:'tool',   text:'pnpm test auth/*  → 12 / 12 pass' },
      { t:'14:42', kind:'halt',   text:'PROMPT: approve rm src/auth/legacy-verifier.ts?' }
    ]
  },
  {
    id: 'ses-7b12',
    name: 'Migrate JWT verifier signature',
    status: 'blocked',
    repo: 'platform/api', worktree: 'wt/jwt-migrate', branch: 'feat/jwt-migrate',
    activity: 'Cannot reach rook container web-2 (ECONNREFUSED 127.0.0.1:51036)',
    latest: 'Container died mid-install. Retrying…',
    updated: '14:37',
    duration: '6m',
    reason: 'Container unreachable — 3 retries failed',
    files: ['src/auth/jwt.ts', 'src/auth/jwt.test.ts'],
    linkedArtifact: { id: 'plan-auth-refactor', kind: 'plan', title: 'Auth error refactor' },
    model: 'claude-sonnet-4.5', pi: 'pi-1',
    live: 'Started migration of jwt.verify() → typed claims return. Install failed during rook container boot.',
    pinned: null, pinnedAt: null,
    added: 0, removed: 0,
    events: [
      { t:'14:31', kind:'start', text:'Session started on feat/jwt-migrate' },
      { t:'14:32', kind:'tool',  text:'rook up --branch feat/jwt-migrate' },
      { t:'14:34', kind:'error', text:'container web-2: npm ERR! code ENOSPC' },
      { t:'14:35', kind:'tool',  text:'rook restart web-2  (retry 1/3)' },
      { t:'14:37', kind:'error', text:'ECONNREFUSED 127.0.0.1:51036' }
    ]
  },
  {
    id: 'ses-a904',
    name: 'Regenerate OpenAPI types',
    status: 'failed',
    repo: 'platform/api', worktree: 'wt/openapi', branch: 'feat/openapi-regen',
    activity: 'Exited 1 — openapi-typescript crashed on circular $ref',
    latest: 'Error: Maximum call stack size exceeded at resolveRef()',
    updated: '14:19',
    duration: '3m',
    reason: 'Exited 1 — cannot resolve circular $ref in schema',
    files: ['openapi/platform.yaml', 'src/generated/openapi.d.ts'],
    linkedArtifact: null,
    model: 'gpt-5', pi: 'pi-2',
    live: 'Regenerating OpenAPI types from platform.yaml. Failed parsing Session.owner → User → Session cycle.',
    pinned: null, pinnedAt: null,
    added: 12, removed: 4,
    events: [
      { t:'14:16', kind:'start', text:'Session started on feat/openapi-regen' },
      { t:'14:17', kind:'tool',  text:'pnpm gen:openapi' },
      { t:'14:19', kind:'error', text:'RangeError: Maximum call stack size' }
    ]
  },
  {
    id: 'ses-2c61',
    name: 'Refactor auth middleware tests',
    status: 'running',
    repo: 'platform/api', worktree: 'wt/auth-errors-tests', branch: 'feat/auth-errors-tests',
    activity: 'Running pnpm test --watch src/auth',
    latest: 'Updated test suite to expect thrown UnauthorizedError.',
    updated: 'now',
    duration: '4m',
    reason: null,
    files: ['src/auth/middleware.test.ts', 'src/auth/session.test.ts'],
    linkedArtifact: { id: 'plan-auth-refactor', kind: 'plan', title: 'Auth error refactor' },
    model: 'claude-sonnet-4.5', pi: 'pi-3',
    live: 'Porting 14 middleware tests to assert thrown errors instead of null-returns. 9 / 14 updated so far.',
    pinned: 'Before this session: 28 tests across 6 files, all expecting null-returns. Target: all asserting instance of UnauthorizedError, status code preserved.',
    pinnedAt: '14:41',
    added: 94, removed: 18,
    events: [
      { t:'14:39', kind:'start', text:'Session started on feat/auth-errors-tests' },
      { t:'14:40', kind:'tool',  text:'rg "expect\\(.*toBe\\(null\\)" src/auth' },
      { t:'14:41', kind:'edit',  text:'edit src/auth/middleware.test.ts (+42 / −8)' },
      { t:'14:43', kind:'edit',  text:'edit src/auth/session.test.ts (+52 / −10)' },
      { t:'14:44', kind:'tool',  text:'pnpm test --watch src/auth' }
    ]
  },
  {
    id: 'ses-5e0d',
    name: 'Port session cookie handler',
    status: 'running',
    repo: 'platform/web', worktree: 'wt/cookie-port', branch: 'feat/cookie-port',
    activity: 'Editing src/lib/session-cookie.ts',
    latest: 'Rewriting setCookie to emit httpOnly + sameSite=strict.',
    updated: '2m ago',
    duration: '11m',
    reason: null,
    files: ['src/lib/session-cookie.ts', 'src/middleware.ts'],
    linkedArtifact: null,
    model: 'claude-haiku-4.5', pi: 'pi-4',
    live: 'Porting cookie handler to new session API. Tests green so far.',
    pinned: null, pinnedAt: null,
    added: 56, removed: 22,
    events: [
      { t:'14:33', kind:'start', text:'Session started on feat/cookie-port' },
      { t:'14:36', kind:'edit',  text:'edit src/lib/session-cookie.ts (+56 / −22)' },
      { t:'14:41', kind:'tool',  text:'pnpm test cookie' }
    ]
  },
  {
    id: 'ses-9f41',
    name: 'Write migration README',
    status: 'idle',
    repo: 'platform/docs', worktree: 'wt/docs-auth', branch: 'chore/docs-auth',
    activity: 'Idle since 14:05',
    latest: 'Draft saved. Waiting on reviewer.',
    updated: '39m ago',
    duration: '—',
    reason: null,
    files: ['docs/migrations/auth-errors.md'],
    linkedArtifact: null,
    model: 'claude-haiku-4.5', pi: 'pi-5',
    live: 'Drafted migration guide for consumers. Ready for human review.',
    pinned: null, pinnedAt: null,
    added: 218, removed: 0,
    events: [
      { t:'13:52', kind:'start', text:'Session started on chore/docs-auth' },
      { t:'14:05', kind:'edit',  text:'edit docs/migrations/auth-errors.md (+218 / −0)' },
      { t:'14:05', kind:'halt',  text:'Agent idled after save' }
    ]
  },
  {
    id: 'ses-3d77',
    name: 'Add typed UnauthorizedError',
    status: 'done',
    repo: 'platform/api', worktree: 'wt/err-class', branch: 'feat/err-class',
    activity: 'Merged to feat/auth-errors at 14:02',
    latest: 'Merged cleanly. 42 / 12 · 5 / 5 tests pass.',
    updated: '42m ago',
    duration: '18m',
    reason: null,
    files: ['src/auth/errors.ts'],
    linkedArtifact: null,
    model: 'claude-sonnet-4.5', pi: 'pi-6',
    live: 'Introduced UnauthorizedError class with 401 status field. Merged.',
    pinned: null, pinnedAt: null,
    added: 42, removed: 12,
    events: [
      { t:'13:44', kind:'start', text:'Session started on feat/err-class' },
      { t:'13:58', kind:'edit',  text:'edit src/auth/errors.ts (+42 / −0)' },
      { t:'14:02', kind:'merge', text:'merged → feat/auth-errors' }
    ]
  },
  {
    id: 'ses-4b20',
    name: 'Prune stale e2e snapshots',
    status: 'historical',
    repo: 'platform/web', worktree: 'wt/e2e-prune', branch: 'chore/e2e-prune',
    activity: 'Reconnect failed — pi-7 unreachable since 11:02',
    latest: 'Last contact 11:02 · last good snapshot preserved.',
    updated: '3h ago',
    duration: '—',
    reason: null,
    files: ['e2e/snapshots/*.png'],
    linkedArtifact: null,
    model: 'claude-haiku-4.5', pi: 'pi-7',
    live: 'Pruning 114 unused snapshot files in e2e/snapshots/.',
    pinned: null, pinnedAt: null,
    added: 0, removed: 0,
    events: [
      { t:'10:48', kind:'start', text:'Session started on chore/e2e-prune' },
      { t:'10:58', kind:'tool',  text:'rook run: find -mtime +90' },
      { t:'11:02', kind:'halt',  text:'pi-7 heartbeat lost · reconnect pending' }
    ]
  }
];

const ARTIFACTS = [
  { id:'plan-auth-refactor', kind:'plan',   title:'Auth error refactor', updated:'today', author:'EK', linked: 3 },
  { id:'spec-session-api',   kind:'spec',   title:'Session API v2 spec', updated:'yesterday', author:'EK', linked: 1 },
  { id:'memo-rook-quotas',   kind:'memo',   title:'Rook container quota policy', updated:'2d ago', author:'MJ', linked: 0 },
  { id:'rev-auth-prs',       kind:'review', title:'Review notes — 3 auth PRs', updated:'today', author:'EK', linked: 0 },
  { id:'snap-14-02',         kind:'snapshot', title:'ses-3d77 @ merge (14:02)', updated:'42m ago', author:'agent', linked: 1 }
];

// A sample plan document body (used in artifact viewer)
const PLAN_DOC = {
  title: 'Auth error refactor',
  kind: 'plan',
  updated: '2026-04-17 14:31',
  author: 'EK',
  body: [
    { h: 1, text: 'Goal' },
    { p: 'Every path in platform/api that currently returns `null` on auth failure should throw a typed `UnauthorizedError` with `status: 401`. Callers must stop treating null as "not authenticated" and start catching the error.' },
    { h: 2, text: 'Surface' },
    { li: ['src/auth/middleware.ts', 'src/auth/session.ts', 'src/auth/jwt.ts (separate session)', 'consumers in src/routes/*'] },
    { h: 2, text: 'Plan' },
    { ol: [
      'Introduce `UnauthorizedError` in src/auth/errors.ts (ses-3d77 · DONE)',
      'Swap null-returns in middleware + session to throw (ses-0f3a · IN PROGRESS)',
      'Port tests to assert thrown errors (ses-2c61 · IN PROGRESS)',
      'Migrate jwt.verify() signature (ses-7b12 · BLOCKED)',
      'Write consumer migration guide (ses-9f41 · IDLE, DRAFT)',
      'Regen OpenAPI types (ses-a904 · FAILED)'
    ]},
    { h: 2, text: 'Open questions' },
    { li: [
      'Do we keep `legacy-verifier.ts` for one release? — pending decision',
      'Do migration docs target v2.0 or v2.1?'
    ] }
  ]
};

Object.assign(window, { WORKSPACE, SESSIONS, ARTIFACTS, PLAN_DOC });
