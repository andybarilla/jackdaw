package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

type TerminalInfo struct {
	ID      string `json:"id"`
	WorkDir string `json:"work_dir"`
	PID     int    `json:"pid"`
}

type terminal struct {
	id      string
	workDir string
	cmd     *exec.Cmd
	ptmx    *os.File
	mu      sync.Mutex
}

type Manager struct {
	terminals map[string]*terminal
	mu        sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		terminals: make(map[string]*terminal),
	}
}

func (m *Manager) Create(workDir string) (*TerminalInfo, error) {
	id := fmt.Sprintf("term-%d", time.Now().UnixNano())

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	cmd := exec.Command(shell)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("start pty: %w", err)
	}

	t := &terminal{
		id:      id,
		workDir: workDir,
		cmd:     cmd,
		ptmx:    ptmx,
	}

	m.mu.Lock()
	m.terminals[id] = t
	m.mu.Unlock()

	return &TerminalInfo{
		ID:      id,
		WorkDir: workDir,
		PID:     cmd.Process.Pid,
	}, nil
}

func (m *Manager) Kill(id string) error {
	m.mu.Lock()
	t, ok := m.terminals[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("terminal %q not found", id)
	}
	delete(m.terminals, id)
	m.mu.Unlock()

	t.mu.Lock()
	defer t.mu.Unlock()

	t.ptmx.Close()
	t.cmd.Process.Signal(os.Interrupt)
	return nil
}

func (m *Manager) Write(id string, data []byte) error {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	_, err := t.ptmx.Write(data)
	return err
}

func (m *Manager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %q not found", id)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	return pty.Setsize(t.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (m *Manager) StartReadLoop(id string, onOutput func([]byte), onExit func()) {
	m.mu.RLock()
	t, ok := m.terminals[id]
	m.mu.RUnlock()
	if !ok {
		return
	}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := t.ptmx.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				onOutput(data)
			}
			if err != nil {
				if onExit != nil {
					onExit()
				}
				return
			}
		}
	}()
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.terminals))
	for id := range m.terminals {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		m.Kill(id)
	}
}
