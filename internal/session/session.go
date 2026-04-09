package session

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/andybarilla/jackdaw/internal/relay"
)

func BuildClaudeHookEnv(hookURL string) string {
	hookConfig := map[string]interface{}{
		"hooks": map[string]interface{}{
			"Notification": []map[string]interface{}{
				{
					"type":    "command",
					"command": fmt.Sprintf("curl -s -X POST -H 'Content-Type: application/json' -d @- '%s'", hookURL),
				},
			},
		},
	}
	data, _ := json.Marshal(hookConfig)
	return "CLAUDE_CODE_HOOKS=" + string(data)
}

type Session struct {
	ID         string
	WorkDir    string
	Command    string
	Args       []string
	StartedAt  time.Time
	SocketPath string
	OnOutput   func(data []byte) // convenience: primary subscriber (sub ID 0)
	OnExit     func(exitCode int)

	relayCmd    *exec.Cmd
	client      *relay.Client
	pid         int
	mu          sync.Mutex
	exitDone    chan struct{}
	readStarted bool

	outputMu   sync.RWMutex
	outputSubs map[int]func([]byte)
	nextSubID  int
}

func New(id string, workDir string, command string, args []string, socketDir string, historyPath string, historyMax int64, env []string) (*Session, error) {
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
	relayCmd.Env = append(os.Environ(), env...)
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

// AddOutputSub registers a subscriber for output data. Returns a subscriber ID
// that can be passed to RemoveOutputSub.
func (s *Session) AddOutputSub(fn func([]byte)) int {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	if s.outputSubs == nil {
		s.outputSubs = make(map[int]func([]byte))
	}
	id := s.nextSubID
	s.nextSubID++
	s.outputSubs[id] = fn
	return id
}

// RemoveOutputSub removes a previously registered output subscriber.
func (s *Session) RemoveOutputSub(id int) {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	delete(s.outputSubs, id)
}

// dispatchOutput fans out output data to all registered subscribers and the
// legacy OnOutput callback.
func (s *Session) dispatchOutput(data []byte) {
	// Legacy single-callback path
	if s.OnOutput != nil {
		s.OnOutput(data)
	}

	s.outputMu.RLock()
	defer s.outputMu.RUnlock()
	for _, fn := range s.outputSubs {
		fn(data)
	}
}

func (s *Session) StartReadLoop() {
	s.mu.Lock()
	if s.readStarted {
		s.mu.Unlock()
		return
	}
	s.readStarted = true
	s.mu.Unlock()

	s.client.OnOutput = func(data []byte) {
		s.dispatchOutput(data)
	}
	s.client.OnReplayEnd = func() {}
	s.client.StartReadLoop()

	if s.relayCmd != nil {
		go func() {
			s.relayCmd.Wait()
			exitCode := -1
			if s.relayCmd.ProcessState != nil {
				exitCode = s.relayCmd.ProcessState.ExitCode()
			}
			if s.OnExit != nil {
				s.OnExit(exitCode)
			}
			close(s.exitDone)
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
	if s.exitDone != nil {
		<-s.exitDone
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
