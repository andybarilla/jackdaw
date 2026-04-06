package session

import (
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

type Session struct {
	ID        string
	WorkDir   string
	Command   string
	Args      []string
	StartedAt time.Time
	OnOutput  func(data []byte)
	OnExit    func(exitCode int)

	cmd  *exec.Cmd
	ptmx *os.File
	mu   sync.Mutex
}

func New(id string, workDir string, command string, args []string) (*Session, error) {
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

	return &Session{
		ID:        id,
		WorkDir:   workDir,
		Command:   command,
		Args:      args,
		StartedAt: time.Now(),
		cmd:       cmd,
		ptmx:      ptmx,
	}, nil
}

func (s *Session) PID() int {
	if s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
}

func (s *Session) StartReadLoop() {
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := s.ptmx.Read(buf)
			if n > 0 && s.OnOutput != nil {
				data := make([]byte, n)
				copy(data, buf[:n])
				s.OnOutput(data)
			}
			if err != nil {
				if err != io.EOF {
					// PTY closed
				}
				break
			}
		}
		exitCode := -1
		if s.cmd.ProcessState != nil {
			exitCode = s.cmd.ProcessState.ExitCode()
		}
		if s.OnExit != nil {
			s.OnExit(exitCode)
		}
	}()
}

func (s *Session) Write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.ptmx.Write(data)
	return err
}

func (s *Session) Resize(cols, rows uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *Session) Wait() {
	s.cmd.Wait()
}

func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ptmx.Close()
	if s.cmd.Process != nil {
		s.cmd.Process.Signal(os.Interrupt)
	}
	return nil
}
