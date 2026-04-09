# Session Hooks Implementation Plan

Spec: `docs/specs/2026-04-09-session-hooks-design.md`

## Task 1: Hooks package — config loading and command execution

**Files:** `internal/hooks/hooks.go`, `internal/hooks/hooks_test.go`

Create `internal/hooks/hooks.go` with:

```go
type Hook string

const (
    PreCreate   Hook = "pre_create"
    PostCreate  Hook = "post_create"
    PreDestroy  Hook = "pre_destroy"
    PostDestroy Hook = "post_destroy"
)

type Config struct {
    Hooks map[Hook]string `json:"hooks"`
}
```

**`Load(dir string) (*Config, error)`**: Read `.jackdaw.json` from `dir`. Return `nil, nil` if file doesn't exist. Return `nil, err` for malformed JSON. Return parsed config otherwise.

**`Run(ctx context.Context, hook Hook, cfg *Config, dir string, env map[string]string) error`**: If `cfg` is nil or hook not in config, return nil (no-op). Build `exec.CommandContext` with `sh -c <command>`. Set `cmd.Dir` to `dir`. Set `cmd.Env` to `os.Environ()` plus the provided env vars. Run and return the error (or nil on success). The caller is responsible for creating a context with timeout and for deciding whether to propagate or log the error.

Tests in `hooks_test.go`:
- `Load`: missing file returns nil/nil, valid config parses correctly, malformed JSON returns error, missing `hooks` key returns config with nil map.
- `Run`: successful command (exit 0), failing command (non-zero exit), command timeout via context cancellation, nil config is no-op, hook not in config is no-op.

**Verification:** `go test ./internal/hooks/...`

## Task 2: Manager integration — wire hooks into Create and Kill/Remove

**Files:** `internal/session/manager.go`

Import `internal/hooks`. Add a `hookTimeout` constant of `30 * time.Second`.

**In `Create`**: After resolving `workDir` (including worktree setup) but before calling `New()`:
1. Call `hooks.Load(workDir)` to get config. If load returns an error, return it (aborts session creation).
2. Build the env map: `JACKDAW_SESSION_ID`=id, `JACKDAW_SESSION_NAME`=name (call `generateName` earlier), `JACKDAW_WORK_DIR`=workDir, `JACKDAW_HOOK`=hook name.
3. Run `pre_create` synchronously with 30s timeout context. If it returns an error, clean up any worktree and return the error.
4. After the session is fully created (after `notifyUpdate`), run `post_create` in a goroutine. Log errors but don't propagate.

Note on `pre_create` working directory: for worktree sessions, per spec, `pre_create` runs in the *original* directory (before worktree), while `post_create` runs in the worktree directory. So `pre_create` should use `originalDir` (or `workDir` if no worktree), while `post_create` uses the final `workDir`.

**In `Kill`**: Before calling `s.Close()`, load config from `workDir` and run `pre_destroy` synchronously (log errors, don't block). After the kill completes and manifest is removed, run `post_destroy` in a goroutine (log errors).

**In `Remove`**: Before removing from maps, load config. If session has an active PTY (exists in `m.sessions`), run `pre_destroy` synchronously (log errors). After cleanup, run `post_destroy` in a goroutine (log errors).

Store the loaded config on `SessionInfo` (unexported field or pass through) so we don't re-read `.jackdaw.json` at destroy time — actually, re-reading is fine and simpler since the config may have changed. Re-read from `workDir` at destroy time.

**Verification:** `go test ./internal/session/... ./internal/hooks/...`

## Task 3: Integration test — pre_create failure aborts session

**Files:** `internal/hooks/hooks_test.go` (or `internal/session/manager_test.go` if manager tests already exist with session creation)

Add a test that:
1. Creates a temp dir with `.jackdaw.json` containing `{"hooks":{"pre_create":"exit 1"}}`.
2. Calls the hooks flow (Load + Run with pre_create).
3. Asserts an error is returned.

And a complementary test:
1. `.jackdaw.json` with `{"hooks":{"pre_create":"exit 0"}}`.
2. Asserts no error.

This can live in the hooks package tests from Task 1 — the `Run` tests already cover this. If additional manager-level integration testing is warranted, add it to `manager_test.go`.

**Verification:** `go test ./internal/hooks/... ./internal/session/...`

## Verification

After all tasks:
- `go test ./internal/...`
- `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
