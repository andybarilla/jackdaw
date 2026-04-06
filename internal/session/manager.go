package session

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/andybarilla/jackdaw/internal/manifest"
)

type Status string

const (
	StatusRunning Status = "running"
	StatusStopped Status = "stopped"
	StatusExited  Status = "exited"
)

type SessionInfo struct {
	ID        string    `json:"id"`
	WorkDir   string    `json:"work_dir"`
	Command   string    `json:"command"`
	Status    Status    `json:"status"`
	PID       int       `json:"pid"`
	StartedAt time.Time `json:"started_at"`
	ExitCode  int       `json:"exit_code"`
}

type Manager struct {
	sessions    map[string]*Session
	sessionInfo map[string]*SessionInfo
	mu          sync.RWMutex
	manifestDir string
	onUpdate    func([]SessionInfo)
}

func NewManager(manifestDir string) *Manager {
	return &Manager{
		sessions:    make(map[string]*Session),
		sessionInfo: make(map[string]*SessionInfo),
		manifestDir: manifestDir,
	}
}

func (m *Manager) SetOnUpdate(fn func([]SessionInfo)) {
	m.mu.Lock()
	m.onUpdate = fn
	m.mu.Unlock()
}

func (m *Manager) SetOnOutput(sessionID string, fn func(data []byte)) {
	m.mu.RLock()
	s, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if ok {
		s.OnOutput = fn
	}
}

func (m *Manager) Create(workDir string, command string, args []string) (*SessionInfo, error) {
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	s, err := New(id, workDir, command, args)
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
		SessionID: id,
		PID:       s.PID(),
		Command:   command,
		Args:      args,
		WorkDir:   workDir,
		StartedAt: s.StartedAt,
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	s.StartReadLoop()
	m.notifyUpdate()

	return info, nil
}

func (m *Manager) List() []SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]SessionInfo, 0, len(m.sessionInfo))
	for _, info := range m.sessionInfo {
		result = append(result, *info)
	}
	return result
}

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

	manifest.Remove(filepath.Join(m.manifestDir, id+".json"))
	m.notifyUpdate()

	return err
}

func (m *Manager) WriteToSession(id string, data []byte) error {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session %q not found", id)
	}
	return s.Write(data)
}

func (m *Manager) ResizeSession(id string, cols, rows uint16) error {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session %q not found", id)
	}
	return s.Resize(cols, rows)
}

func (m *Manager) ListManifests() ([]*manifest.Manifest, error) {
	return manifest.List(m.manifestDir)
}

func (m *Manager) notifyUpdate() {
	m.mu.RLock()
	fn := m.onUpdate
	m.mu.RUnlock()
	if fn != nil {
		fn(m.List())
	}
}
