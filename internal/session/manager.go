package session

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/andybarilla/jackdaw/internal/manifest"
	"github.com/andybarilla/jackdaw/internal/worktree"
)

type Status string

const (
	StatusIdle               Status = "idle"
	StatusWorking            Status = "working"
	StatusWaitingForApproval Status = "waiting_for_approval"
	StatusError              Status = "error"
	StatusStopped            Status = "stopped"
	StatusExited             Status = "exited"
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
	WorktreeEnabled bool      `json:"worktree_enabled,omitempty"`
	WorktreePath    string    `json:"worktree_path,omitempty"`
	OriginalDir     string    `json:"original_dir,omitempty"`
	BranchName      string    `json:"branch_name,omitempty"`
	BaseBranch      string    `json:"base_branch,omitempty"`
}

type WorktreeOptions struct {
	Enabled      bool
	BranchName   string
	WorktreeRoot string
}

type Manager struct {
	sessions        map[string]*Session
	sessionInfo     map[string]*SessionInfo
	statusTrackers  map[string]*StatusTracker
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
		statusTrackers:  make(map[string]*StatusTracker),
		manifestDir:     manifestDir,
		socketDir:       socketDir,
		historyDir:      historyDir,
		historyMaxBytes: historyMaxBytes,
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

func (m *Manager) StatusTracker(id string) *StatusTracker {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.statusTrackers[id]
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

func (m *Manager) Create(id string, workDir string, command string, args []string, env []string, onOutput func([]byte), wtOpts WorktreeOptions) (*SessionInfo, error) {
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}

	var wtPath, originalDir, branchName, baseBranch string

	if wtOpts.Enabled {
		wtRoot := wtOpts.WorktreeRoot
		if wtRoot == "" {
			repoBase := filepath.Base(workDir)
			wtRoot = filepath.Join(filepath.Dir(workDir), ".jackdaw-worktrees", repoBase)
		}

		detected, err := worktree.Create(workDir, wtRoot, wtOpts.BranchName, "")
		if err != nil {
			return nil, fmt.Errorf("create worktree: %w", err)
		}
		originalDir = workDir
		wtPath = detected
		branchName = wtOpts.BranchName
		baseBranch = detectBaseBranch(workDir)
		workDir = wtPath
	}

	historyPath := filepath.Join(m.historyDir, id+".log")

	s, err := New(id, workDir, command, args, m.socketDir, historyPath, m.historyMaxBytes, env)
	if err != nil {
		if wtOpts.Enabled && wtPath != "" {
			worktree.Remove(originalDir, wtPath, branchName)
		}
		return nil, err
	}

	name := m.generateName(workDir)

	info := &SessionInfo{
		ID:              id,
		Name:            name,
		WorkDir:         workDir,
		Command:         command,
		Status:          StatusWorking,
		PID:             s.PID(),
		StartedAt:       s.StartedAt,
		WorktreeEnabled: wtOpts.Enabled,
		WorktreePath:    wtPath,
		OriginalDir:     originalDir,
		BranchName:      branchName,
		BaseBranch:      baseBranch,
	}

	tracker := NewStatusTracker(func(status Status) {
		m.mu.Lock()
		if si, ok := m.sessionInfo[id]; ok {
			si.Status = status
		}
		m.mu.Unlock()
		m.notifyUpdate()
	})

	s.OnExit = func(exitCode int) {
		tracker.HandleExit(exitCode)
		m.mu.Lock()
		if si, ok := m.sessionInfo[id]; ok {
			si.ExitCode = exitCode
		}
		delete(m.statusTrackers, id)
		m.mu.Unlock()
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.sessionInfo[id] = info
	m.statusTrackers[id] = tracker
	m.mu.Unlock()

	mf := &manifest.Manifest{
		SessionID:       id,
		PID:             s.PID(),
		Command:         command,
		Args:            args,
		WorkDir:         workDir,
		SocketPath:      s.SocketPath,
		StartedAt:       s.StartedAt,
		Name:            name,
		HistoryPath:     historyPath,
		WorktreeEnabled: wtOpts.Enabled,
		WorktreePath:    wtPath,
		OriginalDir:     originalDir,
		BranchName:      branchName,
		BaseBranch:      baseBranch,
	}
	manifest.Write(filepath.Join(m.manifestDir, id+".json"), mf)

	if onOutput != nil {
		s.OnOutput = onOutput
	}
	m.notifyUpdate()

	return info, nil
}

func (m *Manager) GetSessionInfo(id string) *SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if info, ok := m.sessionInfo[id]; ok {
		cp := *info
		return &cp
	}
	return nil
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
	if tracker, ok := m.statusTrackers[id]; ok {
		tracker.HandleStop()
		delete(m.statusTrackers, id)
	} else if si, ok := m.sessionInfo[id]; ok {
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
			if mf.HistoryPath != "" {
				os.Remove(mf.HistoryPath)
			}
			manifest.Remove(path)
			continue
		}

		// For worktree sessions, check that the worktree directory still exists
		if mf.WorktreeEnabled && mf.WorktreePath != "" {
			if _, err := os.Stat(mf.WorktreePath); os.IsNotExist(err) {
				if mf.HistoryPath != "" {
					os.Remove(mf.HistoryPath)
				}
				manifest.Remove(path)
				continue
			}
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
			ID:              mf.SessionID,
			Name:            name,
			WorkDir:         mf.WorkDir,
			Command:         mf.Command,
			Status:          StatusWorking,
			PID:             mf.PID,
			StartedAt:       mf.StartedAt,
			WorktreeEnabled: mf.WorktreeEnabled,
			WorktreePath:    mf.WorktreePath,
			OriginalDir:     mf.OriginalDir,
			BranchName:      mf.BranchName,
			BaseBranch:      mf.BaseBranch,
		}

		sid := mf.SessionID
		tracker := NewStatusTracker(func(status Status) {
			m.mu.Lock()
			if si, ok := m.sessionInfo[sid]; ok {
				si.Status = status
			}
			m.mu.Unlock()
			m.notifyUpdate()
		})

		m.mu.Lock()
		m.sessions[mf.SessionID] = s
		m.sessionInfo[mf.SessionID] = info
		m.statusTrackers[mf.SessionID] = tracker
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

func (m *Manager) GetSessionHistory(id string) ([]byte, error) {
	historyPath := filepath.Join(m.historyDir, id+".log")
	data, err := os.ReadFile(historyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	// Cap at 256KB to avoid sending huge payloads
	const maxSize = 256 * 1024
	if len(data) > maxSize {
		data = data[len(data)-maxSize:]
	}
	return data, nil
}

func (m *Manager) notifyUpdate() {
	m.mu.RLock()
	fn := m.onUpdate
	m.mu.RUnlock()
	if fn != nil {
		fn(m.List())
	}
}

func detectBaseBranch(repoDir string) string {
	cmd := exec.Command("git", "-C", repoDir, "symbolic-ref", "refs/remotes/origin/HEAD")
	out, err := cmd.Output()
	if err != nil {
		cmd2 := exec.Command("git", "-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD")
		out2, err2 := cmd2.Output()
		if err2 != nil {
			return "main"
		}
		return strings.TrimSpace(string(out2))
	}
	ref := strings.TrimSpace(string(out))
	parts := strings.Split(ref, "/")
	return parts[len(parts)-1]
}
