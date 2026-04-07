# Session Re-attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sessions survive Jackdaw restarts with full terminal I/O by running each session's PTY in a relay process that outlives the app.

**Architecture:** Each session spawns a detached relay subprocess that holds the PTY master fd and listens on a Unix socket. The Wails app connects to the socket for I/O. On restart, Jackdaw reconnects to the relay socket and replays buffered output. The relay is a subcommand of the jackdaw binary itself (`jackdaw relay`), avoiding a separate binary.

**Tech Stack:** Go, Unix domain sockets, `github.com/creack/pty`

---

### Task 1: Frame Protocol

Binary framing protocol for relay ↔ client communication over the Unix socket.

**Files:**
- Create: `internal/relay/protocol.go`
- Create: `internal/relay/protocol_test.go`

Frame format: `[1 byte type][4 byte big-endian payload length][payload]`

Types:
- `1` = Data (bidirectional — output from relay, input from client)
- `2` = Resize (client → relay, payload: 2 bytes cols + 2 bytes rows, big-endian)
- `3` = ReplayEnd (relay → client, signals buffered replay is complete)

- [ ] **Step 1: Write failing tests for frame encode/decode**

```go
package relay

import (
	"bytes"
	"testing"
)

func TestWriteAndReadFrame(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte("hello world")
	if err := WriteFrame(&buf, FrameData, payload); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	typ, got, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if typ != FrameData {
		t.Errorf("type = %d, want %d", typ, FrameData)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("payload = %q, want %q", got, payload)
	}
}

func TestWriteAndReadResizeFrame(t *testing.T) {
	var buf bytes.Buffer
	payload := EncodeResize(120, 40)
	if err := WriteFrame(&buf, FrameResize, payload); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	typ, data, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if typ != FrameResize {
		t.Errorf("type = %d, want %d", typ, FrameResize)
	}
	cols, rows := DecodeResize(data)
	if cols != 120 || rows != 40 {
		t.Errorf("resize = %dx%d, want 120x40", cols, rows)
	}
}

func TestReadFrameEmpty(t *testing.T) {
	var buf bytes.Buffer
	_, _, err := ReadFrame(&buf)
	if err == nil {
		t.Error("expected error reading from empty buffer")
	}
}

func TestMultipleFrames(t *testing.T) {
	var buf bytes.Buffer
	WriteFrame(&buf, FrameData, []byte("first"))
	WriteFrame(&buf, FrameData, []byte("second"))
	WriteFrame(&buf, FrameReplayEnd, nil)

	typ1, p1, _ := ReadFrame(&buf)
	typ2, p2, _ := ReadFrame(&buf)
	typ3, _, _ := ReadFrame(&buf)

	if typ1 != FrameData || string(p1) != "first" {
		t.Errorf("frame 1: type=%d payload=%q", typ1, p1)
	}
	if typ2 != FrameData || string(p2) != "second" {
		t.Errorf("frame 2: type=%d payload=%q", typ2, p2)
	}
	if typ3 != FrameReplayEnd {
		t.Errorf("frame 3: type=%d, want ReplayEnd", typ3)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/relay/ -v -run TestWriteAndRead`
Expected: compilation error — package and functions don't exist yet.

- [ ] **Step 3: Implement the protocol**

```go
package relay

import (
	"encoding/binary"
	"fmt"
	"io"
)

type FrameType byte

const (
	FrameData      FrameType = 1
	FrameResize    FrameType = 2
	FrameReplayEnd FrameType = 3
)

func WriteFrame(w io.Writer, typ FrameType, payload []byte) error {
	header := make([]byte, 5)
	header[0] = byte(typ)
	binary.BigEndian.PutUint32(header[1:5], uint32(len(payload)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	if len(payload) > 0 {
		_, err := w.Write(payload)
		return err
	}
	return nil
}

func ReadFrame(r io.Reader) (FrameType, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, nil, fmt.Errorf("read frame header: %w", err)
	}
	typ := FrameType(header[0])
	length := binary.BigEndian.Uint32(header[1:5])
	if length == 0 {
		return typ, nil, nil
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, fmt.Errorf("read frame payload: %w", err)
	}
	return typ, payload, nil
}

func EncodeResize(cols, rows uint16) []byte {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint16(buf[0:2], cols)
	binary.BigEndian.PutUint16(buf[2:4], rows)
	return buf
}

func DecodeResize(data []byte) (cols, rows uint16) {
	cols = binary.BigEndian.Uint16(data[0:2])
	rows = binary.BigEndian.Uint16(data[2:4])
	return
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/relay/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/relay/protocol.go internal/relay/protocol_test.go
git commit -m "feat(relay): add binary frame protocol for socket communication"
```

---

### Task 2: Ring Buffer

Fixed-size ring buffer that stores recent terminal output for replay on reconnect.

**Files:**
- Create: `internal/relay/buffer.go`
- Create: `internal/relay/buffer_test.go`

- [ ] **Step 1: Write failing tests**

```go
package relay

import (
	"bytes"
	"testing"
)

func TestRingBufferBasic(t *testing.T) {
	rb := NewRingBuffer(1024)
	rb.Write([]byte("hello"))

	got := rb.Bytes()
	if !bytes.Equal(got, []byte("hello")) {
		t.Errorf("got %q, want %q", got, "hello")
	}
}

func TestRingBufferWrap(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("1234567890"))
	rb.Write([]byte("abc"))

	got := rb.Bytes()
	// Buffer is size 10, should contain the last 10 bytes: "4567890abc"
	// Wait — after writing "1234567890" (10 bytes), buffer is full.
	// Then writing "abc" (3 bytes) overwrites the oldest 3 bytes.
	// Result: "4567890abc"
	want := "4567890abc"
	if string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRingBufferEmpty(t *testing.T) {
	rb := NewRingBuffer(1024)
	got := rb.Bytes()
	if len(got) != 0 {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestRingBufferExactFill(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("abcde"))
	got := rb.Bytes()
	if string(got) != "abcde" {
		t.Errorf("got %q, want %q", got, "abcde")
	}
}

func TestRingBufferMultipleSmallWrites(t *testing.T) {
	rb := NewRingBuffer(8)
	rb.Write([]byte("aa"))
	rb.Write([]byte("bb"))
	rb.Write([]byte("cc"))
	rb.Write([]byte("dd"))
	// Total 8 bytes, exactly fills buffer
	if string(rb.Bytes()) != "aabbccdd" {
		t.Errorf("got %q", rb.Bytes())
	}
	// One more write wraps
	rb.Write([]byte("ee"))
	// Should contain last 8: "bbccddee"
	if string(rb.Bytes()) != "bbccddee" {
		t.Errorf("got %q, want %q", rb.Bytes(), "bbccddee")
	}
}

func TestRingBufferLargeWrite(t *testing.T) {
	rb := NewRingBuffer(5)
	// Write more than buffer size in one go
	rb.Write([]byte("abcdefghij"))
	// Should contain last 5 bytes
	if string(rb.Bytes()) != "fghij" {
		t.Errorf("got %q, want %q", rb.Bytes(), "fghij")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/relay/ -v -run TestRingBuffer`
Expected: compilation error.

- [ ] **Step 3: Implement the ring buffer**

```go
package relay

import "sync"

type RingBuffer struct {
	buf  []byte
	size int
	pos  int // next write position
	full bool
	mu   sync.Mutex
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{
		buf:  make([]byte, size),
		size: size,
	}
}

func (rb *RingBuffer) Write(data []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	// If data is larger than buffer, only keep the last `size` bytes
	if len(data) >= rb.size {
		copy(rb.buf, data[len(data)-rb.size:])
		rb.pos = 0
		rb.full = true
		return
	}

	n := len(data)
	// How much fits before wrap?
	firstPart := rb.size - rb.pos
	if firstPart >= n {
		copy(rb.buf[rb.pos:], data)
	} else {
		copy(rb.buf[rb.pos:], data[:firstPart])
		copy(rb.buf, data[firstPart:])
	}

	rb.pos = (rb.pos + n) % rb.size
	if !rb.full && rb.pos == 0 && n > 0 {
		rb.full = true
	} else if !rb.full {
		// Check if we wrapped past the start
		oldPos := (rb.pos - n + rb.size) % rb.size
		if oldPos >= rb.pos && n > 0 {
			rb.full = true
		}
	}
}

func (rb *RingBuffer) Bytes() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if !rb.full {
		return append([]byte(nil), rb.buf[:rb.pos]...)
	}
	result := make([]byte, rb.size)
	// Data from pos to end, then from 0 to pos
	firstPart := rb.size - rb.pos
	copy(result, rb.buf[rb.pos:])
	copy(result[firstPart:], rb.buf[:rb.pos])
	return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/relay/ -v -run TestRingBuffer`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/relay/buffer.go internal/relay/buffer_test.go
git commit -m "feat(relay): add ring buffer for scrollback replay"
```

---

### Task 3: Relay Server

The relay server runs as a detached subprocess. It creates a PTY, starts the command, listens on a Unix socket, and relays I/O. Buffers output for replay on reconnect.

**Files:**
- Create: `internal/relay/server.go`
- Create: `internal/relay/server_test.go`

- [ ] **Step 1: Write failing tests**

```go
package relay

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestServerStartAndConnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"hello from relay"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()

	// Give the server a moment to start listening
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	// Read frames until we get data containing "hello from relay"
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
		if typ == FrameReplayEnd || strings.Contains(output.String(), "hello from relay") {
			break
		}
	}

	if !strings.Contains(output.String(), "hello from relay") {
		t.Errorf("output = %q, want to contain %q", output.String(), "hello from relay")
	}
}

func TestServerReplay(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"replay test"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	// First client: read output, then disconnect
	conn1, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial 1: %v", err)
	}
	time.Sleep(500 * time.Millisecond)
	conn1.Close()

	// Wait for command to finish producing output
	time.Sleep(500 * time.Millisecond)

	// Second client: should get replayed output
	conn2, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial 2: %v", err)
	}
	defer conn2.Close()

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn2)
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

	if !strings.Contains(output.String(), "replay test") {
		t.Errorf("replayed output = %q, want to contain %q", output.String(), "replay test")
	}
}

func TestServerInput(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
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

	// Wait for replay to finish
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, _, err := ReadFrame(conn)
		if err != nil || typ == FrameReplayEnd {
			break
		}
	}

	// Send input
	WriteFrame(conn, FrameData, []byte("echo test\n"))

	// Read output — cat should echo it back
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
			if strings.Contains(output.String(), "echo test") {
				break
			}
		}
	}

	if !strings.Contains(output.String(), "echo test") {
		t.Errorf("output = %q, want to contain %q", output.String(), "echo test")
	}
}

func TestServerResize(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
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

	// Send resize — should not error or crash
	err = WriteFrame(conn, FrameResize, EncodeResize(132, 50))
	if err != nil {
		t.Errorf("WriteFrame resize: %v", err)
	}
}

func TestServerSocketCleanup(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"hi"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	if _, err := os.Stat(sockPath); err != nil {
		t.Fatalf("socket should exist: %v", err)
	}

	srv.Close()
	time.Sleep(100 * time.Millisecond)

	if _, err := os.Stat(sockPath); !os.IsNotExist(err) {
		t.Error("socket should be cleaned up after Close")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/relay/ -v -run TestServer`
Expected: compilation error.

- [ ] **Step 3: Implement the relay server**

```go
package relay

import (
	"io"
	"net"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

type Server struct {
	sockPath string
	cmd      *exec.Cmd
	ptmx     *os.File
	listener net.Listener
	buffer   *RingBuffer
	clients  map[net.Conn]struct{}
	mu       sync.Mutex
	done     chan struct{}
}

func NewServer(sockPath string, workDir string, command string, args []string, bufferSize int) (*Server, error) {
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

	// Remove stale socket if it exists
	os.Remove(sockPath)

	listener, err := net.Listen("unix", sockPath)
	if err != nil {
		ptmx.Close()
		cmd.Process.Kill()
		return nil, err
	}

	return &Server{
		sockPath: sockPath,
		cmd:      cmd,
		ptmx:     ptmx,
		listener: listener,
		buffer:   NewRingBuffer(bufferSize),
		clients:  make(map[net.Conn]struct{}),
		done:     make(chan struct{}),
	}, nil
}

func (s *Server) PID() int {
	if s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
}

func (s *Server) Serve() {
	go s.readPTY()
	go s.waitProcess()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.done:
				return
			default:
				continue
			}
		}
		go s.handleClient(conn)
	}
}

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
		}
		if err != nil {
			if err != io.EOF {
				// PTY closed
			}
			return
		}
	}
}

func (s *Server) waitProcess() {
	s.cmd.Wait()
	// Process exited — keep server alive so clients can read remaining buffer
}

func (s *Server) handleClient(conn net.Conn) {
	// Replay buffered output
	buffered := s.buffer.Bytes()
	if len(buffered) > 0 {
		WriteFrame(conn, FrameData, buffered)
	}
	WriteFrame(conn, FrameReplayEnd, nil)

	s.mu.Lock()
	s.clients[conn] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	// Read input from client
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
	s.mu.Unlock()

	os.Remove(s.sockPath)
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/relay/ -v -run TestServer -timeout 30s`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/relay/server.go internal/relay/server_test.go
git commit -m "feat(relay): add relay server with PTY, Unix socket, and replay"
```

---

### Task 4: Relay Client

Client that connects to a relay server's Unix socket and provides a `Session`-compatible interface.

**Files:**
- Create: `internal/relay/client.go`
- Create: `internal/relay/client_test.go`

- [ ] **Step 1: Write failing tests**

```go
package relay

import (
	"net"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClientConnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "echo", []string{"client test"}, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	var output strings.Builder
	var mu sync.Mutex
	client.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client.OnReplayEnd = func() {}

	client.StartReadLoop()

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "client test") {
			break
		}
		select {
		case <-deadline:
			mu.Lock()
			t.Fatalf("timed out; output: %q", output.String())
			mu.Unlock()
		default:
		}
	}
}

func TestClientWrite(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	replayDone := make(chan struct{})
	var output strings.Builder
	var mu sync.Mutex
	client.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client.OnReplayEnd = func() { close(replayDone) }

	client.StartReadLoop()

	select {
	case <-replayDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for replay end")
	}

	client.Write([]byte("input via client\n"))

	deadline := time.After(5 * time.Second)
	for {
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		got := output.String()
		mu.Unlock()
		if strings.Contains(got, "input via client") {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out; output: %q", output.String())
		default:
		}
	}
}

func TestClientResize(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	client, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer client.Close()

	if err := client.Resize(132, 50); err != nil {
		t.Errorf("Resize: %v", err)
	}
}

func TestClientConnectFailure(t *testing.T) {
	_, err := NewClient("/nonexistent/socket.sock")
	if err == nil {
		t.Error("expected error connecting to nonexistent socket")
	}
}

func TestClientReconnect(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")
	srv, err := NewServer(sockPath, "/tmp", "cat", nil, 4096)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()
	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	// First client writes data, then disconnects
	client1, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient 1: %v", err)
	}
	replayDone := make(chan struct{})
	client1.OnOutput = func(data []byte) {}
	client1.OnReplayEnd = func() { close(replayDone) }
	client1.StartReadLoop()
	<-replayDone

	client1.Write([]byte("persist this\n"))
	time.Sleep(300 * time.Millisecond)
	client1.Close()

	// Second client should get replayed output
	client2, err := NewClient(sockPath)
	if err != nil {
		t.Fatalf("NewClient 2: %v", err)
	}
	defer client2.Close()

	var output strings.Builder
	var mu sync.Mutex
	replayDone2 := make(chan struct{})
	client2.OnOutput = func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}
	client2.OnReplayEnd = func() { close(replayDone2) }
	client2.StartReadLoop()

	select {
	case <-replayDone2:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for replay end")
	}

	mu.Lock()
	got := output.String()
	mu.Unlock()
	if !strings.Contains(got, "persist this") {
		t.Errorf("replayed output = %q, want to contain %q", got, "persist this")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/relay/ -v -run TestClient`
Expected: compilation error.

- [ ] **Step 3: Implement the client**

```go
package relay

import (
	"net"
	"sync"
)

type Client struct {
	conn        net.Conn
	mu          sync.Mutex
	OnOutput    func(data []byte)
	OnReplayEnd func()
}

func NewClient(sockPath string) (*Client, error) {
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn}, nil
}

func (c *Client) StartReadLoop() {
	go func() {
		for {
			typ, payload, err := ReadFrame(c.conn)
			if err != nil {
				return
			}
			switch typ {
			case FrameData:
				if c.OnOutput != nil {
					c.OnOutput(payload)
				}
			case FrameReplayEnd:
				if c.OnReplayEnd != nil {
					c.OnReplayEnd()
				}
			}
		}
	}()
}

func (c *Client) Write(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return WriteFrame(c.conn, FrameData, data)
}

func (c *Client) Resize(cols, rows uint16) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return WriteFrame(c.conn, FrameResize, EncodeResize(cols, rows))
}

func (c *Client) Close() error {
	return c.conn.Close()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/relay/ -v -run TestClient -timeout 30s`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/relay/client.go internal/relay/client_test.go
git commit -m "feat(relay): add client for connecting to relay server"
```

---

### Task 5: Relay Subprocess Entry Point

Add a `relay` subcommand to the jackdaw binary so sessions can spawn relay subprocesses.

**Files:**
- Create: `internal/relay/cmd.go`
- Modify: `main.go`

- [ ] **Step 1: Create the relay subcommand handler**

```go
package relay

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

func RunMain(args []string) {
	fs := flag.NewFlagSet("relay", flag.ExitOnError)
	sockPath := fs.String("socket", "", "Unix socket path")
	workDir := fs.String("workdir", "", "Working directory")
	command := fs.String("command", "", "Command to run")
	cmdArgs := fs.String("args", "", "Comma-separated command arguments")
	bufSize := fs.Int("buffer", 1024*1024, "Scrollback buffer size in bytes")

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
		parsedArgs = strings.Split(*cmdArgs, ",")
	}

	srv, err := NewServer(*sockPath, *workDir, *command, parsedArgs, *bufSize)
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

- [ ] **Step 2: Update main.go to dispatch relay subcommand**

```go
// In main.go, at the top of main():
func main() {
	if len(os.Args) > 1 && os.Args[1] == "relay" {
		relay.RunMain(os.Args[2:])
		return
	}

	// ... existing Wails app code unchanged ...
}
```

Add `"os"` and `"github.com/andybarilla/jackdaw/internal/relay"` to imports.

- [ ] **Step 3: Verify it compiles**

Run: `go build -tags webkit2_41 ./...`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add internal/relay/cmd.go main.go
git commit -m "feat(relay): add relay subcommand entry point"
```

---

### Task 6: Manifest — Add Socket Path

Add `SocketPath` field to manifests so recovered sessions know where to reconnect.

**Files:**
- Modify: `internal/manifest/manifest.go:13-20`
- Modify: `internal/manifest/manifest_test.go`

- [ ] **Step 1: Write failing test**

Add to `manifest_test.go`:

```go
func TestWriteAndReadWithSocketPath(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		SessionID:  "test-sock",
		PID:        12345,
		Command:    "claude",
		WorkDir:    "/home/user/project",
		SocketPath: "/tmp/jackdaw/test-sock.sock",
		StartedAt:  time.Date(2026, 4, 6, 12, 0, 0, 0, time.UTC),
	}

	path := filepath.Join(dir, "test-sock.json")
	if err := Write(path, m); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.SocketPath != m.SocketPath {
		t.Errorf("SocketPath = %q, want %q", got.SocketPath, m.SocketPath)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/manifest/ -v -run TestWriteAndReadWithSocketPath`
Expected: compilation error — `SocketPath` field doesn't exist.

- [ ] **Step 3: Add SocketPath to Manifest struct**

In `internal/manifest/manifest.go`, add the field:

```go
type Manifest struct {
	SessionID  string    `json:"session_id"`
	PID        int       `json:"pid"`
	Command    string    `json:"command"`
	Args       []string  `json:"args"`
	WorkDir    string    `json:"work_dir"`
	SocketPath string    `json:"socket_path"`
	StartedAt  time.Time `json:"started_at"`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/manifest/ -v`
Expected: all pass (existing tests still pass — JSON unmarshalling ignores missing fields).

- [ ] **Step 5: Commit**

```bash
git add internal/manifest/manifest.go internal/manifest/manifest_test.go
git commit -m "feat(manifest): add socket_path field for relay connection"
```

---

### Task 7: Refactor Session to Use Relay

Replace direct PTY management in `Session` with relay subprocess spawning and client connection. The `Session` struct becomes a wrapper around a relay `Client`.

**Files:**
- Modify: `internal/session/session.go`
- Modify: `internal/session/session_test.go`

- [ ] **Step 1: Update tests to expect relay-based behavior**

The existing tests should still pass with the same interface. Add a test for the new `SocketPath` accessor and update `New` to accept a socket directory:

```go
// Add to session_test.go
func TestSessionSocketPath(t *testing.T) {
	sockDir := t.TempDir()
	s, err := New("test-sock", "/tmp", "echo", []string{"hello"}, sockDir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	if s.SocketPath == "" {
		t.Error("expected non-empty SocketPath")
	}
	if _, err := os.Stat(s.SocketPath); err != nil {
		// Socket might take a moment to appear
		time.Sleep(200 * time.Millisecond)
		if _, err := os.Stat(s.SocketPath); err != nil {
			t.Errorf("socket file should exist: %v", err)
		}
	}
}
```

Update existing test calls to pass a socket dir (6th arg):

```go
// Every call to New needs the socketDir argument added:
// New("test-1", "/tmp", "echo", []string{"hello"})
// becomes:
// New("test-1", "/tmp", "echo", []string{"hello"}, t.TempDir())
```

Update all 5 existing tests (`TestNewSession`, `TestSessionOutput`, `TestSessionWrite`, `TestSessionResize`, `TestSessionClose`) to pass `t.TempDir()` as the 5th argument to `New`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/session/ -v -run TestSession`
Expected: compilation error — `New` doesn't accept 5th arg yet.

- [ ] **Step 3: Rewrite session.go to use relay**

```go
package session

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/andybarilla/jackdaw/internal/relay"
)

type Session struct {
	ID         string
	WorkDir    string
	Command    string
	Args       []string
	StartedAt  time.Time
	SocketPath string
	OnOutput   func(data []byte)
	OnExit     func(exitCode int)

	relayCmd *exec.Cmd
	client   *relay.Client
	pid      int
	mu       sync.Mutex
}

func New(id string, workDir string, command string, args []string, socketDir string) (*Session, error) {
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
		relayArgs = append(relayArgs, "-args", strings.Join(args, ","))
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

	s := &Session{
		ID:         id,
		WorkDir:    workDir,
		Command:    command,
		Args:       args,
		StartedAt:  time.Now(),
		SocketPath: sockPath,
		relayCmd:   relayCmd,
		client:     client,
		pid:        relayCmd.Process.Pid,
	}

	return s, nil
}

func Reconnect(id string, sockPath string, workDir string, command string, pid int, startedAt time.Time) (*Session, error) {
	client, err := relay.NewClient(sockPath)
	if err != nil {
		return nil, fmt.Errorf("reconnect to relay: %w", err)
	}

	return &Session{
		ID:         id,
		WorkDir:    workDir,
		Command:    command,
		StartedAt:  startedAt,
		SocketPath: sockPath,
		client:     client,
		pid:        pid,
	}, nil
}

func (s *Session) PID() int {
	return s.pid
}

func (s *Session) StartReadLoop() {
	s.client.OnOutput = func(data []byte) {
		if s.OnOutput != nil {
			s.OnOutput(data)
		}
	}
	s.client.OnReplayEnd = func() {
		// Replay complete — terminal now shows live output
	}
	s.client.StartReadLoop()

	// Monitor relay process for exit
	if s.relayCmd != nil {
		go func() {
			state, _ := s.relayCmd.Process.Wait()
			exitCode := -1
			if state != nil {
				exitCode = state.ExitCode()
			}
			if s.OnExit != nil {
				s.OnExit(exitCode)
			}
		}()
	}
}

func (s *Session) Write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == nil {
		return fmt.Errorf("session %q not connected", s.ID)
	}
	return s.client.Write(data)
}

func (s *Session) Resize(cols, rows uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == nil {
		return fmt.Errorf("session %q not connected", s.ID)
	}
	return s.client.Resize(cols, rows)
}

func (s *Session) Wait() {
	if s.relayCmd != nil {
		s.relayCmd.Wait()
	}
}

func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.client != nil {
		s.client.Close()
		s.client = nil
	}
	if s.relayCmd != nil && s.relayCmd.Process != nil {
		s.relayCmd.Process.Signal(os.Interrupt)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/session/ -v -run TestSession -timeout 30s`
Expected: all pass. Note: `TestSessionOutput` and `TestSessionWrite` may need timing adjustments since relay adds a socket hop.

- [ ] **Step 5: Commit**

```bash
git add internal/session/session.go internal/session/session_test.go
git commit -m "refactor(session): use relay subprocess instead of direct PTY"
```

---

### Task 8: Refactor Manager for Relay Recovery

Update `Manager` to use socket paths, spawn relays, and reconnect on recovery.

**Files:**
- Modify: `internal/session/manager.go`
- Modify: `internal/session/manager_test.go`

- [ ] **Step 1: Update Manager to track socket directory and pass it to Session.New**

The `Manager` needs a `socketDir` alongside `manifestDir`. Update `NewManager`:

```go
type Manager struct {
	sessions    map[string]*Session
	sessionInfo map[string]*SessionInfo
	mu          sync.RWMutex
	manifestDir string
	socketDir   string
	onUpdate    func([]SessionInfo)
}

func NewManager(manifestDir string, socketDir string) *Manager {
	return &Manager{
		sessions:    make(map[string]*Session),
		sessionInfo: make(map[string]*SessionInfo),
		manifestDir: manifestDir,
		socketDir:   socketDir,
	}
}
```

- [ ] **Step 2: Update Create to pass socketDir and save SocketPath in manifest**

In `Manager.Create`, change the `New` call and manifest:

```go
func (m *Manager) Create(workDir string, command string, args []string) (*SessionInfo, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	s, err := New(id, workDir, command, args, m.socketDir)
	if err != nil {
		return nil, err
	}

	info := &SessionInfo{
		ID:        id,
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
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	s.StartReadLoop()
	m.notifyUpdate()

	return info, nil
}
```

- [ ] **Step 3: Update Recover to reconnect via socket**

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
			manifest.Remove(path)
			continue
		}

		// Try to reconnect via socket
		var s *Session
		if mf.SocketPath != "" {
			var err error
			s, err = Reconnect(mf.SessionID, mf.SocketPath, mf.WorkDir, mf.Command, mf.PID, mf.StartedAt)
			if err != nil {
				// Socket gone but process alive — can't reattach
				s = nil
			}
		}

		status := StatusRunning
		if s != nil {
			s.OnExit = func(exitCode int) {
				m.mu.Lock()
				if si, ok := m.sessionInfo[mf.SessionID]; ok {
					si.Status = StatusExited
					si.ExitCode = exitCode
				}
				m.mu.Unlock()
				m.notifyUpdate()
			}
		}

		info := &SessionInfo{
			ID:        mf.SessionID,
			WorkDir:   mf.WorkDir,
			Command:   mf.Command,
			Status:    status,
			PID:       mf.PID,
			StartedAt: mf.StartedAt,
		}

		m.mu.Lock()
		if s != nil {
			m.sessions[mf.SessionID] = s
		}
		m.sessionInfo[mf.SessionID] = info
		m.mu.Unlock()

		recovered = append(recovered, *info)
	}

	return recovered
}
```

- [ ] **Step 4: Update manager_test.go**

Update all `NewManager` calls to pass a socket dir:

```go
// NewManager(t.TempDir())
// becomes:
// NewManager(t.TempDir(), t.TempDir())
// (two separate temp dirs — one for manifests, one for sockets)
```

Update `TestManagerCreateAndList`, `TestManagerKill`, `TestManagerKillNonexistent`, `TestManagerManifestWritten` to use two-arg `NewManager`.

Update `TestManagerRecover` to test socket-based recovery:

```go
func TestManagerRecover(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	// Create a real relay to recover from
	m1 := NewManager(manifestDir, socketDir)
	info, err := m1.Create("/tmp", "cat", nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Simulate app restart: create a new manager, recover
	m2 := NewManager(manifestDir, socketDir)
	recovered := m2.Recover()

	foundAlive := false
	for _, ri := range recovered {
		if ri.ID == info.ID {
			foundAlive = true
			if ri.Status != StatusRunning {
				t.Errorf("recovered session status = %q, want %q", ri.Status, StatusRunning)
			}
		}
	}
	if !foundAlive {
		t.Error("expected to recover session")
	}

	// Verify I/O works on recovered session
	m2.SetOnOutput(info.ID, func(data []byte) {})
	err = m2.WriteToSession(info.ID, []byte("recovered input\n"))
	if err != nil {
		t.Errorf("WriteToSession on recovered session: %v", err)
	}

	// Cleanup
	m2.Kill(info.ID)
}

func TestManagerRecoverStaleManifest(t *testing.T) {
	manifestDir := t.TempDir()
	socketDir := t.TempDir()

	staleMf := &manifest.Manifest{
		SessionID: "stale-1",
		PID:       999999999,
		Command:   "cat",
		WorkDir:   "/tmp",
		StartedAt: time.Now().Add(-1 * time.Hour),
	}
	manifest.Write(filepath.Join(manifestDir, "stale-1.json"), staleMf)

	m := NewManager(manifestDir, socketDir)
	m.Recover()

	staleManifest, _ := manifest.Read(filepath.Join(manifestDir, "stale-1.json"))
	if staleManifest != nil {
		t.Error("stale manifest should have been removed")
	}
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/session/ -v -timeout 30s`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add internal/session/manager.go internal/session/manager_test.go
git commit -m "feat(manager): recover sessions with relay reconnection"
```

---

### Task 9: Update App Layer and Wire Socket Directory

Update `app.go` and `NewApp` to create and pass the socket directory.

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Update NewApp to create socket directory**

```go
func NewApp() *App {
	home := mustUserHome()
	jackdawDir := filepath.Join(home, ".jackdaw")
	manifestDir := filepath.Join(jackdawDir, "manifests")
	socketDir := filepath.Join(jackdawDir, "sockets")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)

	return &App{
		manager:    session.NewManager(manifestDir, socketDir),
		configPath: filepath.Join(jackdawDir, "config.json"),
	}
}
```

- [ ] **Step 2: Wire up OnOutput for recovered sessions in Startup**

After `a.manager.Recover()`, set up output handlers for recovered sessions:

```go
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	recovered := a.manager.Recover()

	a.manager.SetOnUpdate(func(sessions []session.SessionInfo) {
		runtime.EventsEmit(ctx, "sessions-updated", sessions)
	})

	// Wire output for recovered sessions
	for _, info := range recovered {
		id := info.ID
		a.manager.SetOnOutput(id, func(data []byte) {
			runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		})
	}

	// Start read loops for recovered sessions after output handlers are set
	a.manager.StartRecoveredReadLoops()

	runtime.EventsOn(ctx, "terminal-input", func(data ...interface{}) {
		if len(data) < 2 {
			return
		}
		sessionID, _ := data[0].(string)
		input, _ := data[1].(string)
		a.manager.WriteToSession(sessionID, []byte(input))
	})

	runtime.EventsOn(ctx, "terminal-resize", func(data ...interface{}) {
		if len(data) < 3 {
			return
		}
		sessionID, _ := data[0].(string)
		cols, _ := data[1].(float64)
		rows, _ := data[2].(float64)
		a.manager.ResizeSession(sessionID, uint16(cols), uint16(rows))
	})
}
```

- [ ] **Step 3: Add StartRecoveredReadLoops to Manager**

In `internal/session/manager.go`, add:

```go
func (m *Manager) StartRecoveredReadLoops() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		s.StartReadLoop()
	}
}
```

- [ ] **Step 4: Verify it compiles**

Run: `go build -tags webkit2_41 ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add app.go internal/session/manager.go
git commit -m "feat(app): wire socket directory and recovered session I/O"
```

---

### Task 10: Frontend — Handle Recovered Sessions

The frontend already works for recovered sessions (they appear in the sidebar), but currently clicking one shows nothing because there's no terminal output. With the relay, output will now flow. One small fix: the Terminal component creates a fresh xterm on mount, but a recovered session will replay buffered output, so xterm needs to be ready before the read loop starts. This already works because `EventsOn` is set up in `onMount` before any output arrives.

No frontend changes are strictly required — the existing event-based architecture handles it. However, we should verify end-to-end behavior.

**Files:** None to modify.

- [ ] **Step 1: Manual end-to-end test**

1. Run `wails dev -tags webkit2_41`
2. Create a session (click "+ New Session", enter a directory)
3. Verify terminal output appears
4. Close the Jackdaw window (Cmd+Q / Alt+F4)
5. Run `wails dev -tags webkit2_41` again
6. Verify the session appears in the sidebar with a green status dot
7. Click the session — verify buffered output replays in the terminal
8. Type in the terminal — verify input reaches the session
9. Kill the session via the sidebar X button

- [ ] **Step 2: Commit final docs update**

Update `docs/ROADMAP.md` — move "Session Re-attachment" to Completed.

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark session re-attachment as complete"
```
