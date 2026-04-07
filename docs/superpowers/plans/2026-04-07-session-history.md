# Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist terminal scrollback to disk via the relay process so that restarting Jackdaw restores output for live sessions.

**Architecture:** The relay process appends raw PTY output to `~/.jackdaw/history/{id}.log` as it reads from the PTY. When a client connects, the relay replays from the history file instead of the in-memory ring buffer. File size is capped at a configurable maximum with amortized truncation. The manager handles history file lifecycle (creation path, cleanup on kill/stale recovery).

**Tech Stack:** Go, existing relay/session/manifest/config packages

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `internal/relay/server.go` | Add history file writing, flush ticker, truncation, file-based replay |
| Modify | `internal/relay/cmd.go` | Add `-history` and `-history-max` CLI flags |
| Modify | `internal/session/session.go` | Pass history flags to relay subprocess |
| Modify | `internal/session/manager.go` | Add `historyDir`, pass history path to sessions, cleanup on kill/recover |
| Modify | `internal/manifest/manifest.go` | Add `HistoryPath` field |
| Modify | `internal/config/config.go` | Add `HistoryMaxBytes` field with default |
| Modify | `app.go` | Create history dir, pass `historyDir` to manager, pass config to session creation |
| Create | `internal/relay/server_history_test.go` | Tests for history write, truncation, file-based replay |
| Modify | `internal/relay/server_test.go` | Update `NewServer` calls with new history params |
| Modify | `internal/session/manager_test.go` | Update `NewManager` calls, test history cleanup |
| Modify | `internal/config/config_test.go` | Test `HistoryMaxBytes` default and persistence |
| Modify | `internal/manifest/manifest_test.go` | Test `HistoryPath` serialization |

---

### Task 1: Config — Add `HistoryMaxBytes`

**Files:**
- Modify: `internal/config/config.go:12-14`
- Modify: `internal/config/config_test.go`

- [ ] **Step 1: Write failing test for HistoryMaxBytes default**

In `internal/config/config_test.go`, add:

```go
func TestDefaultHistoryMaxBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HistoryMaxBytes != 1048576 {
		t.Errorf("expected default HistoryMaxBytes 1048576, got %d", cfg.HistoryMaxBytes)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/config/ -run TestDefaultHistoryMaxBytes -v`
Expected: FAIL — `cfg.HistoryMaxBytes` undefined

- [ ] **Step 3: Write failing test for HistoryMaxBytes persistence**

In `internal/config/config_test.go`, add:

```go
func TestSaveAndLoadHistoryMaxBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := &Config{
		Theme:           "dark",
		Keybindings:     map[string]string{},
		HistoryMaxBytes: 5242880,
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if loaded.HistoryMaxBytes != 5242880 {
		t.Errorf("expected HistoryMaxBytes 5242880, got %d", loaded.HistoryMaxBytes)
	}
}
```

- [ ] **Step 4: Implement HistoryMaxBytes in config**

In `internal/config/config.go`, update the `Config` struct:

```go
type Config struct {
	Theme           string            `json:"theme"`
	Keybindings     map[string]string `json:"keybindings"`
	Layout          json.RawMessage   `json:"layout,omitempty"`
	HistoryMaxBytes int               `json:"history_max_bytes,omitempty"`
}
```

Update `Defaults()`:

```go
func Defaults() *Config {
	return &Config{
		Theme:           "whattheflock",
		Keybindings:     map[string]string{},
		HistoryMaxBytes: 1048576,
	}
}
```

- [ ] **Step 5: Run all config tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/config/ -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add HistoryMaxBytes setting with 1MB default"
```

---

### Task 2: Manifest — Add `HistoryPath`

**Files:**
- Modify: `internal/manifest/manifest.go:13-22`
- Modify: `internal/manifest/manifest_test.go`

- [ ] **Step 1: Write failing test for HistoryPath serialization**

In `internal/manifest/manifest_test.go`, add:

```go
func TestManifestHistoryPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")

	mf := &Manifest{
		SessionID:   "test-1",
		PID:         12345,
		Command:     "claude",
		WorkDir:     "/tmp",
		SocketPath:  "/tmp/test.sock",
		StartedAt:   time.Now(),
		HistoryPath: "/home/user/.jackdaw/history/test-1.log",
	}

	if err := Write(path, mf); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.HistoryPath != "/home/user/.jackdaw/history/test-1.log" {
		t.Errorf("HistoryPath = %q, want %q", got.HistoryPath, "/home/user/.jackdaw/history/test-1.log")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/manifest/ -run TestManifestHistoryPath -v`
Expected: FAIL — `HistoryPath` undefined

- [ ] **Step 3: Add HistoryPath to Manifest struct**

In `internal/manifest/manifest.go`, add the field:

```go
type Manifest struct {
	SessionID   string    `json:"session_id"`
	PID         int       `json:"pid"`
	Command     string    `json:"command"`
	Args        []string  `json:"args"`
	WorkDir     string    `json:"work_dir"`
	SocketPath  string    `json:"socket_path"`
	StartedAt   time.Time `json:"started_at"`
	Name        string    `json:"name,omitempty"`
	HistoryPath string    `json:"history_path,omitempty"`
}
```

- [ ] **Step 4: Run all manifest tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/manifest/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/manifest/manifest.go internal/manifest/manifest_test.go
git commit -m "feat(manifest): add HistoryPath field"
```

---

### Task 3: Relay Server — History File Writing

**Files:**
- Modify: `internal/relay/server.go`
- Create: `internal/relay/server_history_test.go`

- [ ] **Step 1: Write failing test for history file creation and writing**

Create `internal/relay/server_history_test.go`:

```go
package relay

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServerWritesHistoryFile(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")
	historyPath := filepath.Join(dir, "test.log")

	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"history test"}, 4096, historyPath, 1048576)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	// Connect and read until process output arrives
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatal("timed out waiting for output")
			default:
				continue
			}
		}
		if typ == FrameReplayEnd {
			break
		}
	}

	// Allow flush
	time.Sleep(200 * time.Millisecond)
	srv.Close()

	data, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(data), "history test") {
		t.Errorf("history file = %q, want to contain %q", string(data), "history test")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -run TestServerWritesHistoryFile -v`
Expected: FAIL — `NewServer` has wrong number of arguments

- [ ] **Step 3: Implement history writing in Server**

In `internal/relay/server.go`, add imports for `"bufio"`, `"io"`, and `"time"`.

Update the `Server` struct:

```go
type Server struct {
	sockPath      string
	cmd           *exec.Cmd
	ptmx          *os.File
	listener      net.Listener
	buffer        *RingBuffer
	clients       map[net.Conn]struct{}
	mu            sync.Mutex
	done          chan struct{}
	historyFile   *os.File
	historyWriter *bufio.Writer
	historyBytes  int64
	historyMax    int64
	historyPath   string
}
```

Update `NewServer` signature and body:

```go
func NewServer(sockPath string, workDir string, command string, args []string, bufferSize int, historyPath string, historyMax int64) (*Server, error) {
	cmd := exec.Command(command, args...)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	os.Remove(sockPath)

	listener, err := net.Listen("unix", sockPath)
	if err != nil {
		ptmx.Close()
		cmd.Process.Kill()
		return nil, err
	}

	s := &Server{
		sockPath:    sockPath,
		cmd:         cmd,
		ptmx:        ptmx,
		listener:    listener,
		buffer:      NewRingBuffer(bufferSize),
		clients:     make(map[net.Conn]struct{}),
		done:        make(chan struct{}),
		historyMax:  historyMax,
		historyPath: historyPath,
	}

	if historyPath != "" {
		f, err := os.OpenFile(historyPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err != nil {
			listener.Close()
			ptmx.Close()
			cmd.Process.Kill()
			return nil, fmt.Errorf("open history file: %w", err)
		}
		info, _ := f.Stat()
		s.historyFile = f
		s.historyWriter = bufio.NewWriterSize(f, 32768)
		s.historyBytes = info.Size()
	}

	return s, nil
}
```

Add `"fmt"` to the imports if not already present.

Update `readPTY()` to write to history:

```go
func (s *Server) readPTY() {
	buf := make([]byte, 4096)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			s.buffer.Write(data)
			s.mu.Lock()
			for conn := range s.clients {
				WriteFrame(conn, FrameData, data)
			}
			s.mu.Unlock()
			s.writeHistory(data)
		}
		if err != nil {
			return
		}
	}
}
```

Add the `writeHistory` method:

```go
func (s *Server) writeHistory(data []byte) {
	if s.historyWriter == nil {
		return
	}
	s.historyWriter.Write(data)
	s.historyBytes += int64(len(data))
}
```

Add a `startHistoryFlusher` method:

```go
func (s *Server) startHistoryFlusher() {
	if s.historyWriter == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.mu.Lock()
				s.historyWriter.Flush()
				s.mu.Unlock()
			case <-s.done:
				return
			}
		}
	}()
}
```

Call `s.startHistoryFlusher()` at the start of `Serve()`:

```go
func (s *Server) Serve() {
	go s.readPTY()
	go s.waitProcess()
	s.startHistoryFlusher()

	for {
		// ... existing accept loop
	}
}
```

Update `Close()` to flush and close the history file:

```go
func (s *Server) Close() error {
	select {
	case <-s.done:
		return nil
	default:
		close(s.done)
	}
	s.listener.Close()
	s.ptmx.Close()
	if s.cmd.Process != nil {
		s.cmd.Process.Signal(os.Interrupt)
	}
	s.mu.Lock()
	for conn := range s.clients {
		conn.Close()
	}
	if s.historyWriter != nil {
		s.historyWriter.Flush()
	}
	if s.historyFile != nil {
		s.historyFile.Close()
	}
	s.mu.Unlock()
	os.Remove(s.sockPath)
	return nil
}
```

- [ ] **Step 4: Update existing server tests**

In `internal/relay/server_test.go`, update all `NewServer` calls to add the two new parameters. Pass `""` for historyPath and `0` for historyMax (disables history):

```go
// In every test, change:
//   NewServer(sockPath, "/tmp", "echo", []string{"hello from relay"}, 4096)
// To:
//   NewServer(sockPath, "/tmp", "echo", []string{"hello from relay"}, 4096, "", 0)
```

Apply this to `TestServerStartAndConnect`, `TestServerReplay`, `TestServerInput`, `TestServerResize`, and `TestServerSocketCleanup`.

- [ ] **Step 5: Run all relay tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add internal/relay/server.go internal/relay/server_history_test.go internal/relay/server_test.go
git commit -m "feat(relay): write PTY output to history file with buffered I/O"
```

---

### Task 4: Relay Server — History Truncation

**Files:**
- Modify: `internal/relay/server.go`
- Modify: `internal/relay/server_history_test.go`

- [ ] **Step 1: Write failing test for history truncation**

In `internal/relay/server_history_test.go`, add:

```go
func TestServerHistoryTruncation(t *testing.T) {
	dir := t.TempDir()
	historyPath := filepath.Join(dir, "test.log")
	maxBytes := int64(100)

	// Pre-fill the history file with 180 bytes (under 2x threshold of 200)
	initial := strings.Repeat("A", 180)
	os.WriteFile(historyPath, []byte(initial), 0600)

	sockPath := filepath.Join(dir, "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, historyPath, maxBytes)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}

	// Drain replay
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil || typ == FrameReplayEnd {
			break
		}
	}

	// Write enough to trigger truncation (180 + 30 = 210 > 200 = 2*100)
	WriteFrame(conn, FrameData, []byte(strings.Repeat("B", 30)+"\n"))
	conn.Close()

	// Allow flush + truncation
	time.Sleep(300 * time.Millisecond)
	srv.Close()

	data, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	if int64(len(data)) > maxBytes+4096 {
		t.Errorf("history file size = %d, want <= %d (max + read buffer headroom)", len(data), maxBytes+4096)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -run TestServerHistoryTruncation -v`
Expected: FAIL — file size exceeds max because truncation isn't implemented yet

- [ ] **Step 3: Implement truncation in writeHistory**

In `internal/relay/server.go`, update `writeHistory`:

```go
func (s *Server) writeHistory(data []byte) {
	if s.historyWriter == nil {
		return
	}
	s.historyWriter.Write(data)
	s.historyBytes += int64(len(data))
	if s.historyMax > 0 && s.historyBytes > 2*s.historyMax {
		s.truncateHistory()
	}
}
```

Add the `truncateHistory` method:

```go
func (s *Server) truncateHistory() {
	s.historyWriter.Flush()

	tail := make([]byte, s.historyMax)
	n, err := s.historyFile.ReadAt(tail, s.historyBytes-s.historyMax)
	if err != nil && err != io.EOF {
		return
	}
	tail = tail[:n]

	s.historyFile.Close()
	f, err := os.OpenFile(s.historyPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return
	}
	f.Write(tail)
	s.historyFile = f
	s.historyWriter = bufio.NewWriterSize(f, 32768)
	s.historyBytes = int64(n)
}
```

Note: `writeHistory` is only called from `readPTY` which runs on a single goroutine, and history flush happens under `s.mu` lock, so truncation is safe. However, `truncateHistory` needs the file opened for reading too. Update `NewServer` to open the file with `os.O_RDWR` instead of `os.O_WRONLY`:

```go
// In NewServer, change:
f, err := os.OpenFile(historyPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
// To:
f, err := os.OpenFile(historyPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
```

And in `truncateHistory`, also open with `os.O_RDWR`:

```go
f, err := os.OpenFile(s.historyPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0600)
```

- [ ] **Step 4: Run all relay tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/relay/server.go internal/relay/server_history_test.go
git commit -m "feat(relay): truncate history file when it exceeds 2x configured max"
```

---

### Task 5: Relay Server — File-Based Replay

**Files:**
- Modify: `internal/relay/server.go`
- Modify: `internal/relay/server_history_test.go`

- [ ] **Step 1: Write failing test for file-based replay**

In `internal/relay/server_history_test.go`, add:

```go
func TestServerReplayFromHistoryFile(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "test.sock")
	historyPath := filepath.Join(dir, "test.log")

	// Pre-fill a history file with known content
	historyContent := "pre-existing history content\n"
	os.WriteFile(historyPath, []byte(historyContent), 0600)

	// Start server with cat (no automatic output) so only replay matters
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096, historyPath, 1048576)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
		}
		if typ == FrameReplayEnd {
			break
		}
	}

	if !strings.Contains(output.String(), "pre-existing history content") {
		t.Errorf("replayed output = %q, want to contain %q", output.String(), "pre-existing history content")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -run TestServerReplayFromHistoryFile -v`
Expected: FAIL — the pre-existing content is in the history file but the ring buffer is empty, so replay sends nothing (or only ring buffer data)

- [ ] **Step 3: Implement file-based replay**

In `internal/relay/server.go`, add a `readHistoryTail` method:

```go
func (s *Server) readHistoryTail(maxBytes int) []byte {
	if s.historyFile == nil {
		return nil
	}
	s.historyWriter.Flush()

	size := s.historyBytes
	if size == 0 {
		return nil
	}

	readSize := size
	if int64(maxBytes) < readSize {
		readSize = int64(maxBytes)
	}

	buf := make([]byte, readSize)
	n, err := s.historyFile.ReadAt(buf, size-readSize)
	if err != nil && err != io.EOF {
		return nil
	}
	return buf[:n]
}
```

Update `handleClient` to use the history file for replay when available:

```go
func (s *Server) handleClient(conn net.Conn) {
	s.mu.Lock()
	var buffered []byte
	if s.historyFile != nil {
		buffered = s.readHistoryTail(s.buffer.size)
	} else {
		buffered = s.buffer.Bytes()
	}
	s.clients[conn] = struct{}{}
	s.mu.Unlock()

	if len(buffered) > 0 {
		WriteFrame(conn, FrameData, buffered)
	}
	WriteFrame(conn, FrameReplayEnd, nil)

	defer func() {
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	for {
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			return
		}
		switch typ {
		case FrameData:
			s.ptmx.Write(payload)
		case FrameResize:
			if len(payload) == 4 {
				cols, rows := DecodeResize(payload)
				pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
			}
		}
	}
}
```

Note: `RingBuffer.size` is unexported. We need to expose it. In `internal/relay/buffer.go`, add a method:

```go
func (rb *RingBuffer) Size() int {
	return rb.size
}
```

Then in `handleClient`, use `s.buffer.Size()` instead of `s.buffer.size`.

- [ ] **Step 4: Run all relay tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/relay/server.go internal/relay/buffer.go internal/relay/server_history_test.go
git commit -m "feat(relay): replay from history file instead of ring buffer on client connect"
```

---

### Task 6: Relay CLI — Add History Flags

**Files:**
- Modify: `internal/relay/cmd.go`

- [ ] **Step 1: Add `-history` and `-history-max` flags to RunMain**

In `internal/relay/cmd.go`, add the new flags and pass them to `NewServer`:

```go
func RunMain(args []string) {
	fs := flag.NewFlagSet("relay", flag.ExitOnError)
	sockPath := fs.String("socket", "", "Unix socket path")
	workDir := fs.String("workdir", "", "Working directory")
	command := fs.String("command", "", "Command to run")
	cmdArgs := fs.String("args", "", "JSON-encoded command arguments")
	bufSize := fs.Int("buffer", 1024*1024, "Scrollback buffer size in bytes")
	historyPath := fs.String("history", "", "History file path")
	historyMax := fs.Int64("history-max", 1048576, "Maximum history file size in bytes")

	fs.Parse(args)

	if *sockPath == "" || *command == "" {
		fmt.Fprintf(os.Stderr, "usage: jackdaw relay -socket PATH -command CMD [-workdir DIR] [-args a,b,c]\n")
		os.Exit(1)
	}

	if *workDir == "" {
		*workDir, _ = os.Getwd()
	}

	var parsedArgs []string
	if *cmdArgs != "" {
		if err := json.Unmarshal([]byte(*cmdArgs), &parsedArgs); err != nil {
			fmt.Fprintf(os.Stderr, "relay: invalid -args JSON: %v\n", err)
			os.Exit(1)
		}
	}

	srv, err := NewServer(*sockPath, *workDir, *command, parsedArgs, *bufSize, *historyPath, *historyMax)
	if err != nil {
		fmt.Fprintf(os.Stderr, "relay: %v\n", err)
		os.Exit(1)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		srv.Close()
		os.Exit(0)
	}()

	srv.Serve()
}
```

- [ ] **Step 2: Run all relay tests to confirm nothing broke**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/relay/ -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add internal/relay/cmd.go
git commit -m "feat(relay): add -history and -history-max CLI flags"
```

---

### Task 7: Session — Pass History Flags to Relay

**Files:**
- Modify: `internal/session/session.go:34-87`

- [ ] **Step 1: Update `New` to accept and pass history parameters**

In `internal/session/session.go`, update the `New` function signature and body:

```go
func New(id string, workDir string, command string, args []string, socketDir string, historyPath string, historyMax int64) (*Session, error) {
	sockPath := filepath.Join(socketDir, id+".sock")

	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("find executable: %w", err)
	}

	relayArgs := []string{"relay",
		"-socket", sockPath,
		"-workdir", workDir,
		"-command", command,
	}
	if len(args) > 0 {
		argsJSON, err := json.Marshal(args)
		if err != nil {
			return nil, fmt.Errorf("encode args: %w", err)
		}
		relayArgs = append(relayArgs, "-args", string(argsJSON))
	}
	if historyPath != "" {
		relayArgs = append(relayArgs, "-history", historyPath, "-history-max", fmt.Sprintf("%d", historyMax))
	}

	relayCmd := exec.Command(exe, relayArgs...)
	relayCmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := relayCmd.Start(); err != nil {
		return nil, fmt.Errorf("start relay: %w", err)
	}

	// Wait for socket to appear
	for i := 0; i < 50; i++ {
		if _, err := os.Stat(sockPath); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	client, err := relay.NewClient(sockPath)
	if err != nil {
		relayCmd.Process.Kill()
		return nil, fmt.Errorf("connect to relay: %w", err)
	}

	return &Session{
		ID:         id,
		WorkDir:    workDir,
		Command:    command,
		Args:       args,
		StartedAt:  time.Now(),
		SocketPath: sockPath,
		relayCmd:   relayCmd,
		client:     client,
		pid:        relayCmd.Process.Pid,
		exitDone:   make(chan struct{}),
	}, nil
}
```

- [ ] **Step 2: Run session tests to verify compilation**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -v`
Expected: FAIL — `NewManager` and `Manager.Create` calls in tests don't match yet (will fix in Task 8)

- [ ] **Step 3: Commit**

```bash
git add internal/session/session.go
git commit -m "feat(session): pass history path and max to relay subprocess"
```

---

### Task 8: Manager — Integrate History Directory and Cleanup

**Files:**
- Modify: `internal/session/manager.go`
- Modify: `internal/session/manager_test.go`

- [ ] **Step 1: Write failing test for history cleanup on Kill**

In `internal/session/manager_test.go`, add:

```go
func TestManagerKillCleansUpHistoryFile(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()
	historyDir := t.TempDir()

	sockPath := filepath.Join(socketDir, "kill-history.sock")
	srv, err := relay.NewServer(sockPath, "/tmp", "cat", nil, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	go srv.Serve()
	defer srv.Close()
	time.Sleep(100 * time.Millisecond)

	m := NewManager(manifestDir, socketDir, historyDir, 1048576)

	// Manually register a session with a history file
	historyPath := filepath.Join(historyDir, "kill-history.log")
	os.WriteFile(historyPath, []byte("some output"), 0600)

	client, _ := relay.NewClient(sockPath)
	s := &Session{
		ID:         "kill-history",
		SocketPath: sockPath,
		client:     client,
		pid:        srv.PID(),
		exitDone:   make(chan struct{}),
	}
	m.sessions["kill-history"] = s
	m.sessionInfo["kill-history"] = &SessionInfo{
		ID:     "kill-history",
		Status: StatusRunning,
		PID:    srv.PID(),
	}

	mf := &manifest.Manifest{
		SessionID:   "kill-history",
		PID:         srv.PID(),
		Command:     "cat",
		WorkDir:     "/tmp",
		SocketPath:  sockPath,
		StartedAt:   time.Now(),
		HistoryPath: historyPath,
	}
	manifest.Write(filepath.Join(manifestDir, "kill-history.json"), mf)

	m.Kill("kill-history")

	if _, err := os.Stat(historyPath); !os.IsNotExist(err) {
		t.Error("history file should be deleted after Kill")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -run TestManagerKillCleansUpHistoryFile -v`
Expected: FAIL — `NewManager` signature mismatch

- [ ] **Step 3: Write failing test for history cleanup on Recover (stale session)**

In `internal/session/manager_test.go`, add:

```go
func TestManagerRecoverCleansUpStaleHistoryFile(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()
	historyDir := t.TempDir()

	historyPath := filepath.Join(historyDir, "stale-history.log")
	os.WriteFile(historyPath, []byte("stale output"), 0600)

	staleMf := &manifest.Manifest{
		SessionID:   "stale-history",
		PID:         999999999,
		Command:     "cat",
		WorkDir:     "/tmp",
		StartedAt:   time.Now().Add(-1 * time.Hour),
		HistoryPath: historyPath,
	}
	manifest.Write(filepath.Join(manifestDir, "stale-history.json"), staleMf)

	m := NewManager(manifestDir, socketDir, historyDir, 1048576)
	m.Recover()

	if _, err := os.Stat(historyPath); !os.IsNotExist(err) {
		t.Error("stale history file should be deleted during Recover")
	}
}
```

- [ ] **Step 4: Implement Manager changes**

In `internal/session/manager.go`, update the struct and constructor:

```go
type Manager struct {
	sessions        map[string]*Session
	sessionInfo     map[string]*SessionInfo
	mu              sync.RWMutex
	manifestDir     string
	socketDir       string
	historyDir      string
	historyMaxBytes int64
	onUpdate        func([]SessionInfo)
}

func NewManager(manifestDir string, socketDir string, historyDir string, historyMaxBytes int64) *Manager {
	os.MkdirAll(historyDir, 0700)
	return &Manager{
		sessions:        make(map[string]*Session),
		sessionInfo:     make(map[string]*SessionInfo),
		manifestDir:     manifestDir,
		socketDir:       socketDir,
		historyDir:      historyDir,
		historyMaxBytes: historyMaxBytes,
	}
}
```

Add `"os"` to imports if not already present.

Update `Create` to pass history path:

```go
func (m *Manager) Create(workDir string, command string, args []string, onOutput func([]byte)) (*SessionInfo, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	historyPath := filepath.Join(m.historyDir, id+".log")

	s, err := New(id, workDir, command, args, m.socketDir, historyPath, m.historyMaxBytes)
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
		SessionID:   id,
		PID:         s.PID(),
		Command:     command,
		Args:        args,
		WorkDir:     workDir,
		SocketPath:  s.SocketPath,
		StartedAt:   s.StartedAt,
		Name:        name,
		HistoryPath: historyPath,
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	if onOutput != nil {
		s.OnOutput = onOutput
	}
	m.notifyUpdate()

	return info, nil
}
```

Update `Kill` to delete the history file:

```go
func (m *Manager) Kill(id string) error {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session %q not found", id)
	}

	err := s.Close()

	m.mu.Lock()
	if si, ok := m.sessionInfo[id]; ok {
		si.Status = StatusStopped
	}
	m.mu.Unlock()

	manifestPath := filepath.Join(m.manifestDir, id+".json")
	mf, _ := manifest.Read(manifestPath)
	if mf != nil && mf.HistoryPath != "" {
		os.Remove(mf.HistoryPath)
	}
	manifest.Remove(manifestPath)
	m.notifyUpdate()

	return err
}
```

Update `Recover` to clean up stale history files:

```go
func (m *Manager) Recover() []SessionInfo {
	manifests, err := manifest.List(m.manifestDir)
	if err != nil {
		return nil
	}

	var recovered []SessionInfo
	for _, mf := range manifests {
		path := filepath.Join(m.manifestDir, mf.SessionID+".json")

		if !manifest.IsProcessAlive(mf.PID) {
			if mf.HistoryPath != "" {
				os.Remove(mf.HistoryPath)
			}
			manifest.Remove(path)
			continue
		}

		s, err := Reconnect(mf.SessionID, mf.SocketPath, mf.WorkDir, mf.Command, mf.PID, mf.StartedAt)
		if err != nil {
			if mf.HistoryPath != "" {
				os.Remove(mf.HistoryPath)
			}
			manifest.Remove(path)
			continue
		}

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

		m.mu.Lock()
		m.sessions[mf.SessionID] = s
		m.sessionInfo[mf.SessionID] = info
		m.mu.Unlock()

		recovered = append(recovered, *info)
	}

	return recovered
}
```

- [ ] **Step 5: Update existing manager tests**

In `internal/session/manager_test.go`, update all `NewManager` calls:

```go
// Change all instances of:
//   NewManager(t.TempDir(), t.TempDir())
// To:
//   NewManager(t.TempDir(), t.TempDir(), t.TempDir(), 1048576)
//
// And for tests that use specific dirs:
//   NewManager(manifestDir, socketDir)
// To:
//   NewManager(manifestDir, socketDir, t.TempDir(), 1048576)
```

Apply this to: `TestManagerKillNonexistent`, `TestManagerRecover`, `TestManagerGenerateName`, `TestManagerGenerateNameFirst`, `TestManagerGenerateNameRoot`, `TestManagerRename`, `TestManagerRenameEmptyName`, `TestManagerRenameNotFound`, `TestManagerRecoverWithName`, `TestManagerRecoverLegacyNoName`.

- [ ] **Step 6: Run all session tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/session/ -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/session/manager.go internal/session/manager_test.go
git commit -m "feat(session): integrate history directory in manager with cleanup on kill and recover"
```

---

### Task 9: App — Wire History Directory and Config

**Files:**
- Modify: `app.go:22-35`

- [ ] **Step 1: Update NewApp to create history directory and pass it to Manager**

In `app.go`, update `NewApp`:

```go
func NewApp() *App {
	home := mustUserHome()
	jackdawDir := filepath.Join(home, ".jackdaw")
	manifestDir := filepath.Join(jackdawDir, "manifests")
	socketDir := filepath.Join(jackdawDir, "sockets")
	historyDir := filepath.Join(jackdawDir, "history")
	configPath := filepath.Join(jackdawDir, "config.json")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)

	cfg, _ := config.Load(configPath)

	return &App{
		manager:     session.NewManager(manifestDir, socketDir, historyDir, int64(cfg.HistoryMaxBytes)),
		termManager: terminal.NewManager(),
		configPath:  configPath,
	}
}
```

- [ ] **Step 2: Build the project to verify compilation**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go build ./...`
Expected: SUCCESS (no errors)

- [ ] **Step 3: Run all tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./...`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add app.go
git commit -m "feat: wire history directory and config into app initialization"
```

---

### Task 10: Integration Verification

- [ ] **Step 1: Run the full test suite**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 2: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: SUCCESS

- [ ] **Step 3: Build the production binary**

Run: `cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: SUCCESS

- [ ] **Step 4: Final commit (if any remaining changes)**

Only if there are uncommitted fixes from earlier steps.
