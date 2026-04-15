package relay

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// ExitState records how the relay's child process terminated. It is
// populated by waitProcess once Wait4 reports WIFEXITED or WIFSIGNALED
// and is nil while the child is still running.
type ExitState struct {
	// ExitCode is the process exit code when Exited is true, otherwise 0.
	ExitCode int
	// Signal is the terminating signal when Signaled is true, otherwise 0.
	Signal syscall.Signal
	// Exited is true when the child terminated normally (WIFEXITED).
	Exited bool
	// Signaled is true when the child was killed by a signal (WIFSIGNALED).
	Signaled bool
	// Err is non-nil when waitProcess terminated because Wait4 itself
	// returned an error (e.g. ECHILD, ESRCH), distinguishing anomalous
	// termination from a normal exit/signal.
	Err error
}

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
	exitState     atomic.Pointer[ExitState]
}

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
		f, err := os.OpenFile(historyPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
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

func (s *Server) PID() int {
	if s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
}

func (s *Server) Serve() {
	go s.readPTY()
	go s.waitProcess()
	s.startHistoryFlusher()

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
			s.mu.Lock()
			s.buffer.Write(data)
			for conn := range s.clients {
				WriteFrame(conn, FrameData, data)
			}
			s.writeHistory(data)
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

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

func (s *Server) truncateHistory() {
	s.historyWriter.Flush()

	tail := make([]byte, s.historyMax)
	n, err := s.historyFile.ReadAt(tail, s.historyBytes-s.historyMax)
	if err != nil && err != io.EOF {
		return
	}
	tail = tail[:n]

	s.historyFile.Close()
	f, err := os.OpenFile(s.historyPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0600)
	if err != nil {
		return
	}
	f.Write(tail)
	s.historyFile = f
	s.historyWriter = bufio.NewWriterSize(f, 32768)
	s.historyBytes = int64(n)
}

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

func (s *Server) waitProcess() {
	// We must be the only waiter for this pid. exec.Cmd.Wait() also
	// calls waitpid internally, so it must never run against this
	// process — two waiters on the same pid is undefined behavior.
	//
	// Wait4 with WUNTRACED returns on both stop and exit. On stop we
	// send SIGCONT so any child that self-suspends (e.g. Claude Code's
	// Ctrl-Z handler raises SIGTSTP) is resumed transparently. On exit
	// we publish the final status and return. Server stays alive after
	// the child exits so clients can still connect and replay buffered
	// output; cleanup happens when the manager calls Close() via Kill.
	if s.cmd.Process == nil {
		return
	}
	pid := s.cmd.Process.Pid
	for {
		var status syscall.WaitStatus
		_, err := syscall.Wait4(pid, &status, syscall.WUNTRACED, nil)
		if err != nil {
			if err == syscall.EINTR {
				continue
			}
			s.exitState.Store(&ExitState{Err: err})
			return
		}
		switch {
		case status.Stopped():
			// Child stopped itself (SIGTSTP/SIGSTOP). Resume it and
			// keep waiting — we want to learn when it really exits.
			s.cmd.Process.Signal(syscall.SIGCONT)
			continue
		case status.Exited():
			s.exitState.Store(&ExitState{
				ExitCode: status.ExitStatus(),
				Exited:   true,
			})
			return
		case status.Signaled():
			s.exitState.Store(&ExitState{
				Signal:   status.Signal(),
				Signaled: true,
			})
			return
		default:
			// Continued or some other transient state — keep waiting.
			continue
		}
	}
}

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

func (s *Server) handleClient(conn net.Conn) {
	s.mu.Lock()
	var buffered []byte
	if s.historyFile != nil {
		buffered = s.readHistoryTail(s.buffer.Size())
	} else {
		buffered = s.buffer.Bytes()
	}
	if len(buffered) > 0 {
		WriteFrame(conn, FrameData, buffered)
	}
	WriteFrame(conn, FrameReplayEnd, nil)
	s.clients[conn] = struct{}{}
	s.mu.Unlock()

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
