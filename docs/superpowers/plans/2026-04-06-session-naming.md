# Session Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename sessions in the sidebar, with auto-generated unique names from directory basenames.

**Architecture:** Add a `Name` field to `SessionInfo` and `Manifest`. `Manager` generates deduped names on create/recover, and exposes `Rename()`. Frontend shows `session.name` and supports inline editing via double-click or pencil icon.

**Tech Stack:** Go, Svelte 5 (runes), Wails v2

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `internal/manifest/manifest.go:13-21` | Add `Name` field to `Manifest` struct |
| Modify | `internal/session/manager.go:20-28` | Add `Name` field to `SessionInfo` struct |
| Modify | `internal/session/manager.go:63-112` | Generate deduped name in `Create()` |
| Modify | `internal/session/manager.go:170-209` | Populate name in `Recover()`, handle legacy manifests |
| Modify | `internal/session/manager.go` | Add `Rename()` method |
| Modify | `app.go` | Add `RenameSession()` Wails binding |
| Modify | `frontend/src/lib/types.ts` | Add `name` field to `SessionInfo` |
| Modify | `frontend/src/lib/Sidebar.svelte` | Inline rename UI, pencil icon, display `session.name` |
| Modify | `frontend/src/App.svelte` | Pass `onRename` callback to Sidebar, import `RenameSession` |
| Modify | `internal/session/manager_test.go` | Tests for dedup, rename, recovery |
| Modify | `internal/manifest/manifest_test.go` | Test name field persistence |
| Regenerate | `frontend/wailsjs/go/main/App.js`, `App.d.ts`, `models.ts` | Wails bindings (auto-generated) |

---

### Task 1: Add Name to Manifest

**Files:**
- Modify: `internal/manifest/manifest.go:13-21`
- Test: `internal/manifest/manifest_test.go`

- [ ] **Step 1: Write failing test for Name field persistence**

Add to `internal/manifest/manifest_test.go`:

```go
func TestWriteAndReadWithName(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID: "test-name",
		PID:       12345,
		Command:   "claude",
		WorkDir:   "/home/user/project",
		Name:      "my-project",
		StartedAt: time.Date(2026, 4, 6, 12, 0, 0, 0, time.UTC),
	}

	path := filepath.Join(dir, "test-name.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Name != "my-project" {
		t.Errorf("Name = %q, want %q", got.Name, "my-project")
	}
}

func TestReadLegacyManifestWithoutName(t *testing.T) {
	dir := t.TempDir()
	// Simulate a legacy manifest JSON without a "name" field
	legacy := `{"session_id":"old-1","pid":100,"command":"claude","work_dir":"/tmp/foo","started_at":"2026-04-06T12:00:00Z"}`
	path := filepath.Join(dir, "old-1.json")
	if err := os.WriteFile(path, []byte(legacy), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Name != "" {
		t.Errorf("Name = %q, want empty for legacy manifest", got.Name)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/manifest/ -run "TestWriteAndReadWithName|TestReadLegacyManifestWithoutName" -v`
Expected: Compilation error — `Name` field does not exist on `Manifest`.

- [ ] **Step 3: Add Name field to Manifest struct**

In `internal/manifest/manifest.go`, change the `Manifest` struct (lines 13-21) to:

```go
type Manifest struct {
	SessionID  string    `json:"session_id"`
	PID        int       `json:"pid"`
	Command    string    `json:"command"`
	Args       []string  `json:"args"`
	WorkDir    string    `json:"work_dir"`
	SocketPath string    `json:"socket_path"`
	StartedAt  time.Time `json:"started_at"`
	Name       string    `json:"name,omitempty"`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/manifest/ -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/manifest/manifest.go internal/manifest/manifest_test.go
git commit -m "feat: add Name field to Manifest struct"
```

---

### Task 2: Add Name to SessionInfo and dedup logic in Manager

**Files:**
- Modify: `internal/session/manager.go:20-28, 63-112`
- Test: `internal/session/manager_test.go`

- [ ] **Step 1: Write failing test for auto-dedup naming**

The existing test infrastructure creates real sessions with relay servers, which is heavy. For name dedup testing, we can test the naming logic by directly manipulating `sessionInfo` map entries since `Manager` fields are package-private and we're in the same package. Add to `internal/session/manager_test.go`:

```go
func TestManagerGenerateName(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())

	// Simulate existing sessions by inserting into sessionInfo directly
	m.sessionInfo["1"] = &SessionInfo{ID: "1", WorkDir: "/home/user/myapp", Name: "myapp"}
	m.sessionInfo["2"] = &SessionInfo{ID: "2", WorkDir: "/home/user/myapp", Name: "myapp (2)"}

	got := m.generateName("/home/user/myapp")
	if got != "myapp (3)" {
		t.Errorf("generateName = %q, want %q", got, "myapp (3)")
	}

	got2 := m.generateName("/home/user/other")
	if got2 != "other" {
		t.Errorf("generateName = %q, want %q", got2, "other")
	}
}

func TestManagerGenerateNameFirst(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
	got := m.generateName("/home/user/project")
	if got != "project" {
		t.Errorf("generateName = %q, want %q", got, "project")
	}
}

func TestManagerGenerateNameRoot(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
	got := m.generateName("/")
	if got != "/" {
		t.Errorf("generateName = %q, want %q", got, "/")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerGenerateName" -v`
Expected: Compilation error — `Name` field does not exist on `SessionInfo`, `generateName` method does not exist.

- [ ] **Step 3: Add Name field to SessionInfo and generateName method**

In `internal/session/manager.go`, add `Name` to `SessionInfo` (after line 22):

```go
type SessionInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	WorkDir   string    `json:"work_dir"`
	Command   string    `json:"command"`
	Status    Status    `json:"status"`
	PID       int       `json:"pid"`
	StartedAt time.Time `json:"started_at"`
	ExitCode  int       `json:"exit_code"`
}
```

Add the `generateName` method (before `Create`):

```go
// generateName returns a unique display name for a session based on its working directory.
// Must be called while m.mu is NOT held (it acquires a read lock internally).
func (m *Manager) generateName(workDir string) string {
	base := filepath.Base(workDir)

	m.mu.RLock()
	defer m.mu.RUnlock()

	taken := make(map[string]bool)
	for _, info := range m.sessionInfo {
		taken[info.Name] = true
	}

	if !taken[base] {
		return base
	}

	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s (%d)", base, n)
		if !taken[candidate] {
			return candidate
		}
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerGenerateName" -v`
Expected: All three tests PASS.

- [ ] **Step 5: Update Create() to set Name and write it to manifest**

In `internal/session/manager.go`, modify `Create` (lines 63-112). Add name generation before the lock and set it on both `info` and `mf`:

```go
func (m *Manager) Create(workDir string, command string, args []string, onOutput func([]byte)) (*SessionInfo, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	s, err := New(id, workDir, command, args, m.socketDir)
	if err != nil {
		return nil, err
	}

	name := m.generateName(workDir)

	info := &SessionInfo{
		ID:        id,
		Name:      name,
		WorkDir:   workDir,
		Command:   command,
		Status:    StatusRunning,
		PID:       s.PID(),
		StartedAt: s.StartedAt,
	}

	s.OnExit = func(exitCode int) {
		m.mu.Lock()
		if si, ok := m.sessionInfo[id]; ok {
			si.Status = StatusExited
			si.ExitCode = exitCode
		}
		m.mu.Unlock()
		m.notifyUpdate()
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.sessionInfo[id] = info
	m.mu.Unlock()

	mf := &manifest.Manifest{
		SessionID:  id,
		PID:        s.PID(),
		Command:    command,
		Args:       args,
		WorkDir:    workDir,
		SocketPath: s.SocketPath,
		StartedAt:  s.StartedAt,
		Name:       name,
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	if onOutput != nil {
		s.OnOutput = onOutput
	}
	m.notifyUpdate()

	return info, nil
}
```

- [ ] **Step 6: Run all session tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -v`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/session/manager.go internal/session/manager_test.go
git commit -m "feat: add Name field to SessionInfo with auto-dedup naming"
```

---

### Task 3: Add Rename method to Manager

**Files:**
- Modify: `internal/session/manager.go`
- Test: `internal/session/manager_test.go`

- [ ] **Step 1: Write failing tests for Rename**

Add to `internal/session/manager_test.go`:

```go
func TestManagerRename(t *testing.T) {
	manifestDir := t.TempDir()
	m := NewManager(manifestDir, t.TempDir())

	// Insert a fake session info and manifest
	m.sessionInfo["s1"] = &SessionInfo{ID: "s1", Name: "old-name", WorkDir: "/tmp/foo"}
	mf := &manifest.Manifest{SessionID: "s1", PID: 1, Command: "claude", WorkDir: "/tmp/foo", Name: "old-name", StartedAt: time.Now()}
	manifest.Write(filepath.Join(manifestDir, "s1.json"), mf)

	if err := m.Rename("s1", "new-name"); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	// Check in-memory
	if m.sessionInfo["s1"].Name != "new-name" {
		t.Errorf("in-memory Name = %q, want %q", m.sessionInfo["s1"].Name, "new-name")
	}

	// Check manifest on disk
	got, err := manifest.Read(filepath.Join(manifestDir, "s1.json"))
	if err != nil {
		t.Fatalf("manifest.Read: %v", err)
	}
	if got.Name != "new-name" {
		t.Errorf("manifest Name = %q, want %q", got.Name, "new-name")
	}
}

func TestManagerRenameEmptyName(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
	m.sessionInfo["s1"] = &SessionInfo{ID: "s1", Name: "old", WorkDir: "/tmp/foo"}

	if err := m.Rename("s1", "   "); err == nil {
		t.Error("expected error for whitespace-only name")
	}
}

func TestManagerRenameNotFound(t *testing.T) {
	m := NewManager(t.TempDir(), t.TempDir())
	if err := m.Rename("nonexistent", "name"); err == nil {
		t.Error("expected error for nonexistent session")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerRename" -v`
Expected: Compilation error — `Rename` method does not exist.

- [ ] **Step 3: Implement Rename method**

Add to `internal/session/manager.go` (after the `Kill` method):

```go
func (m *Manager) Rename(id string, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("session name cannot be empty")
	}

	m.mu.Lock()
	info, ok := m.sessionInfo[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session %q not found", id)
	}
	info.Name = name
	m.mu.Unlock()

	// Update the manifest on disk
	mfPath := filepath.Join(m.manifestDir, id+".json")
	mf, err := manifest.Read(mfPath)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}
	if mf != nil {
		mf.Name = name
		if err := manifest.Write(mfPath, mf); err != nil {
			return fmt.Errorf("write manifest: %w", err)
		}
	}

	m.notifyUpdate()
	return nil
}
```

Also add `"strings"` to the import block at the top of `manager.go` (it already has `"fmt"`, `"path/filepath"`, `"sync"`, `"time"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerRename" -v`
Expected: All three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/session/manager.go internal/session/manager_test.go
git commit -m "feat: add Rename method to session Manager"
```

---

### Task 4: Update Recover to populate Name

**Files:**
- Modify: `internal/session/manager.go:170-209`
- Test: `internal/session/manager_test.go`

- [ ] **Step 1: Write failing test for recovery with name**

Add to `internal/session/manager_test.go`:

```go
func TestManagerRecoverWithName(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "named-1.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	mf := &manifest.Manifest{
		SessionID:  "named-1",
		PID:        srv.PID(),
		Command:    "cat",
		WorkDir:    "/tmp/myapp",
		SocketPath: sockPath,
		StartedAt:  time.Now().Add(-10 * time.Minute),
		Name:       "custom-name",
	}
	manifest.Write(filepath.Join(manifestDir, "named-1.json"), mf)

	m := NewManager(manifestDir, socketDir)
	recovered := m.Recover()

	found := false
	for _, info := range recovered {
		if info.ID == "named-1" {
			found = true
			if info.Name != "custom-name" {
				t.Errorf("Name = %q, want %q", info.Name, "custom-name")
			}
		}
	}
	if !found {
		t.Error("expected to recover named session")
	}
}

func TestManagerRecoverLegacyNoName(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "legacy-1.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	// Write manifest without Name field (legacy)
	mf := &manifest.Manifest{
		SessionID:  "legacy-1",
		PID:        srv.PID(),
		Command:    "cat",
		WorkDir:    "/tmp/myapp",
		SocketPath: sockPath,
		StartedAt:  time.Now().Add(-10 * time.Minute),
	}
	manifest.Write(filepath.Join(manifestDir, "legacy-1.json"), mf)

	m := NewManager(manifestDir, socketDir)
	recovered := m.Recover()

	found := false
	for _, info := range recovered {
		if info.ID == "legacy-1" {
			found = true
			if info.Name != "myapp" {
				t.Errorf("Name = %q, want %q (generated from WorkDir)", info.Name, "myapp")
			}
		}
	}
	if !found {
		t.Error("expected to recover legacy session")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerRecoverWithName|TestManagerRecoverLegacyNoName" -v`
Expected: FAIL — `Recover()` does not set `Name` on the returned `SessionInfo`.

- [ ] **Step 3: Update Recover to populate Name**

In `internal/session/manager.go`, update the `Recover` method (lines 170-209). Replace the `info` construction block with:

```go
		name := mf.Name
		if name == "" {
			name = m.generateName(mf.WorkDir)
		}

		info := &SessionInfo{
			ID:        mf.SessionID,
			Name:      name,
			WorkDir:   mf.WorkDir,
			Command:   mf.Command,
			Status:    StatusRunning,
			PID:       mf.PID,
			StartedAt: mf.StartedAt,
		}
```

Note: `generateName` acquires `m.mu.RLock` internally, and it's called before `m.mu.Lock()` below, so no deadlock.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run "TestManagerRecover" -v`
Expected: All recovery tests PASS (including the original `TestManagerRecover`).

- [ ] **Step 5: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/...`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/session/manager.go internal/session/manager_test.go
git commit -m "feat: populate session name on recovery with legacy fallback"
```

---

### Task 5: Add RenameSession Wails binding

**Files:**
- Modify: `app.go`
- Regenerate: `frontend/wailsjs/go/main/App.js`, `App.d.ts`, `models.ts`

- [ ] **Step 1: Add RenameSession to app.go**

Add after `KillSession` (line 117):

```go
func (a *App) RenameSession(id string, name string) error {
	return a.manager.Rename(id, name)
}
```

- [ ] **Step 2: Regenerate Wails JS bindings**

Run: `cd /home/andy/dev/andybarilla/jackdaw && wails generate module`

This updates `frontend/wailsjs/go/main/App.js`, `App.d.ts`, and `models.ts` to include:
- `RenameSession(arg1: string, arg2: string): Promise<void>` in the TS declarations
- `name: string` on the `SessionInfo` class in models.ts

- [ ] **Step 3: Verify the generated bindings look correct**

Run: `grep -n "RenameSession" /home/andy/dev/andybarilla/jackdaw/frontend/wailsjs/go/main/App.d.ts`
Expected: A line like `export function RenameSession(arg1:string,arg2:string):Promise<void>;`

Run: `grep -n "name" /home/andy/dev/andybarilla/jackdaw/frontend/wailsjs/go/models.ts`
Expected: A line with `name: string;` in the `SessionInfo` class.

- [ ] **Step 4: Commit**

```bash
git add app.go frontend/wailsjs/
git commit -m "feat: add RenameSession Wails binding and regenerate JS"
```

---

### Task 6: Update frontend types and Sidebar display

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/Sidebar.svelte`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Add name to frontend SessionInfo type**

In `frontend/src/lib/types.ts`, add `name` field:

```typescript
export interface SessionInfo {
  id: string;
  name: string;
  work_dir: string;
  command: string;
  status: "running" | "stopped" | "exited";
  pid: number;
  started_at: string;
  exit_code: number;
}
```

- [ ] **Step 2: Update Sidebar to display session.name and add rename support**

Replace the entire `frontend/src/lib/Sidebar.svelte` with:

```svelte
<script lang="ts">
  import type { SessionInfo } from "./types";

  interface Props {
    sessions: SessionInfo[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onKill: (id: string) => void;
    onRename: (id: string, name: string) => void;
  }

  let { sessions, activeSessionId, onSelect, onNew, onKill, onRename }: Props =
    $props();

  let editingId = $state<string | null>(null);
  let editValue = $state("");

  function statusColor(status: SessionInfo["status"]): string {
    switch (status) {
      case "running":
        return "var(--success)";
      case "exited":
        return "var(--warning)";
      case "stopped":
        return "var(--error)";
    }
  }

  function startEditing(session: SessionInfo, event: Event): void {
    event.stopPropagation();
    editingId = session.id;
    editValue = session.name;
  }

  function commitRename(): void {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    editingId = null;
  }

  function handleEditKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      commitRename();
    } else if (event.key === "Escape") {
      editingId = null;
    }
  }
</script>

<aside class="sidebar">
  <button class="new-session" onclick={onNew}>+ New Session</button>

  <div class="session-list">
    {#each sessions as session (session.id)}
      <div
        class="session-item"
        class:active={session.id === activeSessionId}
        onclick={() => onSelect(session.id)}
        onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") onSelect(session.id); }}
        role="button"
        tabindex="0"
      >
        <span class="status-dot" style="background: {statusColor(session.status)}"></span>
        {#if editingId === session.id}
          <input
            class="rename-input"
            bind:value={editValue}
            onblur={commitRename}
            onkeydown={handleEditKeydown}
            onclick={(e: MouseEvent) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <span
            class="session-name"
            ondblclick={(e: MouseEvent) => startEditing(session, e)}
          >{session.name}</span>
          <button
            class="edit-btn"
            onclick={(e: MouseEvent) => startEditing(session, e)}
            title="Rename session"
          >&#9998;</button>
        {/if}
        {#if session.status === "running"}
          <button
            class="kill-btn"
            onclick={(e: MouseEvent) => { e.stopPropagation(); onKill(session.id); }}
            title="Kill session"
          >&#215;</button>
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style>
  .sidebar {
    width: 240px;
    min-width: 240px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .new-session {
    margin: 12px;
    padding: 8px 12px;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
  }

  .new-session:hover {
    opacity: 0.9;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
  }

  .session-item:hover {
    background: var(--bg-tertiary);
  }

  .session-item.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .session-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: 0 4px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .session-item:hover .edit-btn {
    opacity: 1;
  }

  .edit-btn:hover {
    color: var(--text-primary);
  }

  .rename-input {
    flex: 1;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .kill-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    line-height: 1;
  }

  .kill-btn:hover {
    color: var(--error);
  }
</style>
```

- [ ] **Step 3: Update App.svelte to pass onRename**

In `frontend/src/App.svelte`, add the import for `RenameSession` (line 4):

```typescript
import { CreateSession, ListSessions, KillSession, RenameSession } from "../wailsjs/go/main/App";
```

Add the rename handler (after `handleKill`):

```typescript
async function handleRename(id: string, name: string) {
  await RenameSession(id, name);
}
```

Add `onRename` prop to the Sidebar component:

```svelte
<Sidebar
  {sessions}
  {activeSessionId}
  onSelect={(id) => (activeSessionId = id)}
  onNew={() => (showNewDialog = true)}
  onKill={handleKill}
  onRename={handleRename}
/>
```

- [ ] **Step 4: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/Sidebar.svelte frontend/src/App.svelte
git commit -m "feat: add inline session renaming UI in sidebar"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/...`
Expected: All PASS.

- [ ] **Step 2: Run frontend checks**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check && npm run build`
Expected: No errors.

- [ ] **Step 3: Run the app in dev mode**

Run: `cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails dev -tags webkit2_41`

Verify:
1. Create a session — sidebar shows directory basename as name
2. Create a second session with the same directory — name shows `(2)` suffix
3. Double-click a session name — inline input appears, pre-filled with current name
4. Type a new name, press Enter — name updates
5. Press Escape while editing — reverts to original
6. Hover over a session — pencil icon appears; click it to enter edit mode
7. Kill and restart the app — session names persist
