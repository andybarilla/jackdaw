package session

import (
	"fmt"
	"path/filepath"
	"strings"
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
	Name      string    `json:"name"`
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

		s, err := Reconnect(mf.SessionID, mf.SocketPath, mf.WorkDir, mf.Command, mf.PID, mf.StartedAt)
		if err != nil {
			manifest.Remove(path)
			continue
		}

		info := &SessionInfo{
			ID:        mf.SessionID,
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

func (m *Manager) StartSessionReadLoop(id string) {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	if ok {
		s.StartReadLoop()
	}
}

func (m *Manager) StartRecoveredReadLoops() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.sessions {
		s.StartReadLoop()
	}
}

func (m *Manager) notifyUpdate() {
	m.mu.RLock()
	fn := m.onUpdate
	m.mu.RUnlock()
	if fn != nil {
		fn(m.List())
	}
}
