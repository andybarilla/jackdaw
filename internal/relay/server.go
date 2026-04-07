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
			}
			return
		}
	}
}

func (s *Server) waitProcess() {
	s.cmd.Wait()
}

func (s *Server) handleClient(conn net.Conn) {
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
