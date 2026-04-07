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
	}, nil
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
	s.client.OnReplayEnd = func() {}
	s.client.StartReadLoop()

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
