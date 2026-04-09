# Session Hooks

## Purpose

Run shell commands at session lifecycle points. Hooks let users automate setup/teardown tasks (git branch creation, environment prep, cleanup) without manual intervention.

## Hook Points

Four hooks, executed in the session's working directory:

| Hook | When | Use Case |
|------|------|----------|
| `pre_create` | Before PTY spawn | Validate environment, create branches |
| `post_create` | After PTY spawn succeeds | Notify, log, start watchers |
| `pre_destroy` | Before session kill/close | Save state, commit WIP |
| `post_destroy` | After session is fully removed | Clean up temp files, remove branches |

## Configuration

### File Location

`.jackdaw.json` in the project directory (the session's `workDir`). Jackdaw checks for this file at session create/destroy time.

### Schema

```json
{
  "hooks": {
    "pre_create": "echo 'creating session'",
    "post_create": "echo 'session created'",
    "pre_destroy": "echo 'destroying session'",
    "post_destroy": "echo 'session destroyed'"
  }
}
```

Each value is a shell command string passed to `sh -c`. Any hook key can be omitted to skip it.

### Defaults

When `.jackdaw.json` does not exist or `hooks` is absent, no hooks run. There are no built-in defaults -- hooks are opt-in.

## Execution

### Environment Variables

Hooks receive these environment variables in addition to the system environment:

| Variable | Description |
|----------|-------------|
| `JACKDAW_SESSION_ID` | Session ID |
| `JACKDAW_SESSION_NAME` | Display name |
| `JACKDAW_WORK_DIR` | Session working directory |
| `JACKDAW_HOOK` | Hook name (e.g. `pre_create`) |

### Working Directory

All hooks execute with `cwd` set to the session's working directory. For worktree sessions, `pre_create` runs in the original directory (worktree doesn't exist yet), while `post_create`/`pre_destroy`/`post_destroy` run in the worktree directory.

### Timeout

Each hook has a 30-second timeout. If exceeded, the hook process is killed and treated as a failure.

### Failure Behavior

- **`pre_create` failure** (non-zero exit): Session creation is aborted. Error returned to the caller.
- **`post_create` failure**: Logged but does not affect the session. Session continues normally.
- **`pre_destroy` failure**: Logged but does not block destruction. Session is still killed.
- **`post_destroy` failure**: Logged, no other effect.

Only `pre_create` is blocking -- it can prevent session creation. All other hooks are fire-and-forget with logging.

## Implementation

### New Package: `internal/hooks`

Single file `hooks.go` with:

```go
type Hook string

const (
    PreCreate   Hook = "pre_create"
    PostCreate  Hook = "post_create"
    PreDestroy  Hook = "pre_destroy"
    PostDestroy Hook = "post_destroy"
)

// Config represents .jackdaw.json
type Config struct {
    Hooks map[Hook]string `json:"hooks"`
}

// Load reads .jackdaw.json from dir. Returns nil config if file doesn't exist.
func Load(dir string) (*Config, error)

// Run executes a hook command. Returns error only for pre_create; other hooks log and return nil.
func Run(hook Hook, dir string, env map[string]string, timeout time.Duration) error
```

### Manager Integration

- `Manager.Create`: Load config from `workDir`, run `pre_create` before PTY spawn, run `post_create` (async) after success.
- `Manager.Kill`: Run `pre_destroy` before closing, run `post_destroy` (async) after cleanup.
- `Manager.Remove`: Run `pre_destroy` + `post_destroy` if session is still alive, otherwise just `post_destroy`.

### Config Loading

`Load` reads `.jackdaw.json` from the given directory using `os.ReadFile` + `json.Unmarshal`. Missing file returns `nil, nil`. Malformed JSON returns an error (which aborts session creation if hit during `pre_create`).

## Testing

- Unit tests for `Load` with: missing file, empty hooks, valid config, malformed JSON.
- Unit tests for `Run` with: successful command, failing command, timeout.
- Integration test: `pre_create` failure prevents session creation.

## Not In Scope

- Hook output capture/display in the UI.
- Global hooks (only per-project).
- Hook editing UI (users edit `.jackdaw.json` directly).
- Async/parallel hook execution (hooks run sequentially).
