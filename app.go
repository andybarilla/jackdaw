package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/andybarilla/jackdaw/internal/config"
	"github.com/andybarilla/jackdaw/internal/notification"
	"github.com/andybarilla/jackdaw/internal/proxy"
	"github.com/andybarilla/jackdaw/internal/session"
	"github.com/andybarilla/jackdaw/internal/terminal"
	"github.com/andybarilla/jackdaw/internal/workspace"
	"github.com/andybarilla/jackdaw/internal/worktree"
	"github.com/andybarilla/jackdaw/internal/wsserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type RecentDir struct {
	Path     string    `json:"path"`
	LastUsed time.Time `json:"last_used"`
}

type App struct {
	ctx             context.Context
	manager         *session.Manager
	termManager     *terminal.Manager
	configPath      string
	notifSvc        *notification.Service
	hookListener    *notification.HookListener
	desktop         *notification.DesktopNotifier
	patternMatchers map[string]*notification.PatternMatcher
	errorDetectors        map[string]*notification.ErrorDetector
	errorDetectionEnabled bool
	notifCh               chan notifWork
	dashTicker      *time.Ticker
	recentDirsPath  string
	proxyServer     *proxy.Server
	wsServer        *wsserver.Server
}

func NewApp() *App {
	home := mustUserHome()
	jackdawDir := filepath.Join(home, ".jackdaw")
	manifestDir := filepath.Join(jackdawDir, "manifests")
	socketDir := filepath.Join(jackdawDir, "sockets")
	historyDir := filepath.Join(jackdawDir, "history")
	configPath := filepath.Join(jackdawDir, "config.json")
	os.MkdirAll(manifestDir, 0700)
	os.MkdirAll(socketDir, 0700)

	cfg, _ := config.Load(configPath)

	notifSvc := notification.NewService()
	notifSvc.Enabled = cfg.NotificationsEnabled

	desktop := notification.NewDesktopNotifier()
	desktop.Enabled = cfg.DesktopNotifications

	return &App{
		manager:         session.NewManager(manifestDir, socketDir, historyDir, int64(cfg.HistoryMaxBytes)),
		termManager:     terminal.NewManager(),
		configPath:      configPath,
		notifSvc:        notifSvc,
		desktop:         desktop,
		patternMatchers:       make(map[string]*notification.PatternMatcher),
		errorDetectors:        make(map[string]*notification.ErrorDetector),
		errorDetectionEnabled: cfg.ErrorDetectionEnabled,
		recentDirsPath:  filepath.Join(jackdawDir, "recent_dirs.json"),
	}
}

type notifWork struct {
	sessionID string
	data      []byte
}

func (a *App) startNotifWorker() {
	a.notifCh = make(chan notifWork, 256)
	go func() {
		for w := range a.notifCh {
			if tracker := a.manager.StatusTracker(w.sessionID); tracker != nil {
				tracker.HandleOutput(w.data)
			}
			if pm, ok := a.patternMatchers[w.sessionID]; ok {
				if a.hookListener == nil || !a.hookListener.HasSession(w.sessionID) {
					pm.Feed(w.data)
				}
			}
			if ed, ok := a.errorDetectors[w.sessionID]; ok {
				ed.Feed(w.data)
			}
		}
	}()
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize default workspace if needed
	if cfg, err := config.Load(a.configPath); err == nil {
		if len(cfg.Workspaces) == 0 {
			cfg.Workspaces = []workspace.Workspace{workspace.DefaultWorkspace()}
			cfg.ActiveWorkspaceID = "default"
			config.Save(a.configPath, cfg) //nolint:errcheck
		}
	}

	// Recover sessions that survived a previous shutdown
	recovered := a.manager.Recover()

	// Start hook listener
	hl, err := notification.NewHookListener(a.notifSvc, "127.0.0.1:0")
	if err == nil {
		a.hookListener = hl
		hl.OnNotification = func(sessionID string) {
			if tracker := a.manager.StatusTracker(sessionID); tracker != nil {
				tracker.HandlePermissionPrompt()
			}
		}
		go hl.Serve()
	}

	// Start proxy server for embedded browser panes
	if ps, err := proxy.Start(); err == nil {
		a.proxyServer = ps
	}

	// Start WebSocket server for terminal I/O
	if ws, err := wsserver.New(a); err == nil {
		a.wsServer = ws
	}

	// Start async notification processing worker
	a.startNotifWorker()

	// Track window focus state — frontend emits this via document.hasFocus()
	windowFocused := true
	runtime.EventsOn(ctx, "window-focus-changed", func(data ...interface{}) {
		if len(data) > 0 {
			if focused, ok := data[0].(bool); ok {
				windowFocused = focused
			}
		}
	})

	// Wire notification outputs
	a.notifSvc.OnNotification = func(n notification.Notification) {
		runtime.EventsEmit(ctx, "notification-fired", n)
		if !windowFocused {
			a.desktop.Send(n.SessionName, n.Message)
		}
	}

	var prevStatuses map[string]session.Status

	a.manager.SetOnUpdate(func(sessions []session.SessionInfo) {
		runtime.EventsEmit(ctx, "sessions-updated", sessions)

		// Detect session exits
		currentStatuses := make(map[string]session.Status, len(sessions))
		for _, s := range sessions {
			currentStatuses[s.ID] = s.Status
			if prevStatuses != nil {
				prev, existed := prevStatuses[s.ID]
				if existed && prev != session.StatusStopped && prev != session.StatusExited && s.Status == session.StatusExited {
					msg := fmt.Sprintf("Session exited (code %d)", s.ExitCode)
					a.notifSvc.Notify(notification.Notification{
						SessionID:   s.ID,
						SessionName: s.Name,
						Type:        notification.TypeSessionExited,
						Message:     msg,
					})
				}
			}
		}
		prevStatuses = currentStatuses
		runtime.EventsEmit(ctx, "dashboard-updated", a.manager.DashboardData())
	})

	a.dashTicker = time.NewTicker(2 * time.Second)
	go func() {
		for range a.dashTicker.C {
			runtime.EventsEmit(ctx, "dashboard-updated", a.manager.DashboardData())
		}
	}()

	// Wire output handlers for recovered sessions (read loops start when frontend attaches)
	for _, info := range recovered {
		id := info.ID
		a.manager.SetOnOutput(id, func(data []byte) {
			if a.wsServer != nil {
				a.wsServer.SendOutput(id, data)
			}
		})
	}

	// Migrate recovered sessions with no workspace to "default"
	for _, info := range recovered {
		if info.WorkspaceID == "" {
			a.manager.MoveSessionToWorkspace(info.ID, "default") //nolint:errcheck
		}
	}

}

func (a *App) Shutdown(ctx context.Context) {
	if a.notifCh != nil {
		close(a.notifCh)
	}
	if a.dashTicker != nil {
		a.dashTicker.Stop()
	}
	if a.hookListener != nil {
		a.hookListener.Close()
	}
	if a.proxyServer != nil {
		a.proxyServer.Close()
	}
	if a.wsServer != nil {
		a.wsServer.Close()
	}
	a.notifSvc.Close()
	a.termManager.CloseAll()
}

// WriteToSession implements wsserver.SessionWriter for WebSocket input routing.
func (a *App) WriteToSession(id string, data []byte) error {
	if err := a.manager.WriteToSession(id, data); err != nil {
		return a.termManager.Write(id, data)
	}
	if tracker := a.manager.StatusTracker(id); tracker != nil {
		tracker.HandleInput()
	}
	return nil
}

// ResizeSession implements wsserver.SessionWriter for WebSocket resize routing.
func (a *App) ResizeSession(id string, cols, rows uint16) error {
	if err := a.manager.ResizeSession(id, cols, rows); err != nil {
		return a.termManager.Resize(id, cols, rows)
	}
	return nil
}

func (a *App) GetWSPort() int {
	if a.wsServer == nil {
		return 0
	}
	return a.wsServer.Port()
}

func (a *App) GetProxyBaseURL() string {
	if a.proxyServer == nil {
		return ""
	}
	return a.proxyServer.BaseURL()
}

func (a *App) CreateTerminal(workDir string) (*terminal.TerminalInfo, error) {
	workDir = expandHome(workDir)
	info, err := a.termManager.Create(workDir)
	if err != nil {
		return nil, err
	}

	a.termManager.StartReadLoop(info.ID, func(data []byte) {
		if a.wsServer != nil {
			a.wsServer.SendOutput(info.ID, data)
		}
	}, func() {
		runtime.EventsEmit(a.ctx, "terminal-exited", info.ID)
	})

	return info, nil
}

func (a *App) KillTerminal(id string) error {
	return a.termManager.Kill(id)
}

func expandHome(path string) string {
	if strings.HasPrefix(path, "~/") || path == "~" {
		home := mustUserHome()
		return filepath.Join(home, path[1:])
	}
	return path
}

func (a *App) IsGitRepo(dir string) bool {
	dir = expandHome(dir)
	return worktree.IsGitRepo(dir)
}

func (a *App) PickDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Working Directory",
	})
}

func (a *App) CreateSession(workDir string, worktreeEnabled bool, branchName string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	a.addRecentDir(workDir)
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/%s", a.hookListener.Addr(), id)
		env = append(env, session.BuildClaudeHookEnv(hookURL))
	}

	cfg, _ := config.Load(a.configPath)
	wtOpts := session.WorktreeOptions{
		Enabled:      worktreeEnabled,
		BranchName:   branchName,
		WorktreeRoot: cfg.WorktreeRoot,
	}

	info, err := a.manager.Create(id, workDir, "claude", nil, env, func(data []byte) {
		// Send output via WebSocket (hot path — no blocking)
		if a.wsServer != nil {
			a.wsServer.SendOutput(id, data)
		}
		// Notification processing happens async to avoid blocking the read loop
		dataCopy := make([]byte, len(data))
		copy(dataCopy, data)
		select {
		case a.notifCh <- notifWork{sessionID: id, data: dataCopy}:
		default:
			// Drop notification work if channel is full — output delivery is more important
		}
	}, wtOpts, cfg.ActiveWorkspaceID)
	if err != nil {
		return nil, err
	}

	pm := notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)
	pm.OnMatch = func() {
		if tracker := a.manager.StatusTracker(info.ID); tracker != nil {
			tracker.HandlePermissionPrompt()
		}
	}
	a.patternMatchers[info.ID] = pm

	if a.errorDetectionEnabled {
		ed := notification.NewErrorDetector(a.notifSvc, info.ID, info.Name)
		ed.OnError = func() {
			if tracker := a.manager.StatusTracker(info.ID); tracker != nil {
				tracker.HandleError()
			}
		}
		a.errorDetectors[info.ID] = ed
	}

	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)
	return info, nil
}

func (a *App) GetSessionHistory(sessionID string) (string, error) {
	data, err := a.manager.GetSessionHistory(sessionID)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) DismissNotification(sessionID string) {
	a.notifSvc.Dismiss(sessionID)
}

func (a *App) RespondToNotification(sessionID string, response string) error {
	if !a.notifSvc.HasActive(sessionID) {
		return fmt.Errorf("no active notification for session %q", sessionID)
	}
	if err := a.manager.WriteToSession(sessionID, []byte(response)); err != nil {
		return fmt.Errorf("write to session: %w", err)
	}
	a.notifSvc.Dismiss(sessionID)
	return nil
}

func (a *App) AttachSession(id string) {
	a.manager.StartSessionReadLoop(id)
}

func (a *App) GetDashboardData() []session.DashboardSession {
	return a.manager.DashboardData()
}

func (a *App) ListSessions() []session.SessionInfo {
	return a.manager.List()
}

type WorktreeStatusResult struct {
	Branch           string `json:"branch"`
	UncommittedFiles int    `json:"uncommitted_files"`
	UnpushedCommits  int    `json:"unpushed_commits"`
}

func (a *App) GetWorktreeStatus(sessionID string) (*WorktreeStatusResult, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled || info.WorktreePath == "" {
		return nil, fmt.Errorf("session %q is not a worktree session", sessionID)
	}

	st, err := worktree.Status(info.WorktreePath)
	if err != nil {
		return nil, err
	}
	return &WorktreeStatusResult{
		Branch:           st.Branch,
		UncommittedFiles: st.UncommittedFiles,
		UnpushedCommits:  st.UnpushedCommits,
	}, nil
}

func (a *App) CleanupWorktree(sessionID string, deleteWorktree bool) error {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled {
		return nil
	}

	if deleteWorktree {
		if err := worktree.Remove(info.OriginalDir, info.WorktreePath, info.BranchName); err != nil {
			return fmt.Errorf("remove worktree: %w", err)
		}
	}

	return a.manager.Kill(sessionID)
}

func (a *App) MergeSession(sessionID string) (*worktree.MergeResult, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	if !info.WorktreeEnabled || info.WorktreePath == "" {
		return nil, fmt.Errorf("session %q is not a worktree session", sessionID)
	}

	cfg, _ := config.Load(a.configPath)
	squash := cfg.MergeMode != "merge"

	result, err := worktree.Merge(info.OriginalDir, info.WorktreePath, info.BranchName, info.BaseBranch, squash)
	if err != nil {
		return nil, err
	}
	if !result.Success {
		return result, nil
	}

	// Clean up worktree and branch — log errors but don't fail the merge
	if rmErr := worktree.Remove(info.OriginalDir, info.WorktreePath, info.BranchName); rmErr != nil {
		fmt.Fprintf(os.Stderr, "worktree cleanup after merge: %v\n", rmErr)
	}

	// Kill the session
	delete(a.patternMatchers, sessionID)
	delete(a.errorDetectors, sessionID)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(sessionID)
	}
	a.manager.Kill(sessionID) //nolint:errcheck

	return result, nil
}

func (a *App) GetSessionDiff(sessionID string) ([]worktree.FileDiff, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	return worktree.Diff(info.WorkDir, info.BaseBranch)
}

func (a *App) GetFileDiff(sessionID string, filePath string) (*worktree.FileDiff, error) {
	info := a.manager.GetSessionInfo(sessionID)
	if info == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	return worktree.DiffFile(info.WorkDir, info.BaseBranch, filePath)
}

func (a *App) KillSession(id string) error {
	delete(a.patternMatchers, id)
	delete(a.errorDetectors, id)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(id)
	}
	return a.manager.Kill(id)
}

func (a *App) RemoveSession(id string) {
	delete(a.patternMatchers, id)
	delete(a.errorDetectors, id)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(id)
	}
	a.manager.Remove(id)
}

func (a *App) RenameSession(id string, name string) error {
	return a.manager.Rename(id, name)
}

func (a *App) GetWorkspaces() ([]workspace.Workspace, error) {
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return nil, err
	}
	return cfg.Workspaces, nil
}

func (a *App) GetActiveWorkspaceID() (string, error) {
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return "", err
	}
	return cfg.ActiveWorkspaceID, nil
}

func (a *App) CreateWorkspace(name string) (*workspace.Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("workspace name cannot be empty")
	}
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return nil, err
	}
	ws := workspace.Workspace{
		ID:   workspace.GenerateID(),
		Name: name,
	}
	cfg.Workspaces = append(cfg.Workspaces, ws)
	if err := config.Save(a.configPath, cfg); err != nil {
		return nil, err
	}
	return &ws, nil
}

func (a *App) RenameWorkspace(id string, name string) error {
	if id == "default" {
		return fmt.Errorf("cannot rename the Default workspace")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("workspace name cannot be empty")
	}
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return err
	}
	for i := range cfg.Workspaces {
		if cfg.Workspaces[i].ID == id {
			cfg.Workspaces[i].Name = name
			return config.Save(a.configPath, cfg)
		}
	}
	return fmt.Errorf("workspace %q not found", id)
}

func (a *App) DeleteWorkspace(id string, moveSessionsToDefault bool) error {
	if id == "default" {
		return fmt.Errorf("cannot delete the Default workspace")
	}
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return err
	}

	found := false
	for _, ws := range cfg.Workspaces {
		if ws.ID == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("workspace %q not found", id)
	}

	// Handle sessions in this workspace
	for _, s := range a.manager.List() {
		if s.WorkspaceID == id {
			if moveSessionsToDefault {
				a.manager.MoveSessionToWorkspace(s.ID, "default") //nolint:errcheck
			} else {
				a.KillSession(s.ID) //nolint:errcheck
			}
		}
	}

	// Remove workspace from config
	filtered := make([]workspace.Workspace, 0, len(cfg.Workspaces)-1)
	for _, ws := range cfg.Workspaces {
		if ws.ID != id {
			filtered = append(filtered, ws)
		}
	}
	cfg.Workspaces = filtered

	if cfg.ActiveWorkspaceID == id {
		cfg.ActiveWorkspaceID = "default"
	}

	if err := config.Save(a.configPath, cfg); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "sessions-updated", a.manager.List())
	return nil
}

func (a *App) SetActiveWorkspace(id string) error {
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return err
	}
	found := false
	for _, ws := range cfg.Workspaces {
		if ws.ID == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("workspace %q not found", id)
	}
	cfg.ActiveWorkspaceID = id
	if err := config.Save(a.configPath, cfg); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "workspace-changed", id)
	return nil
}

func (a *App) MoveSessionToWorkspace(sessionID, workspaceID string) error {
	if err := a.manager.MoveSessionToWorkspace(sessionID, workspaceID); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "sessions-updated", a.manager.List())
	return nil
}

func (a *App) GetConfig() (*config.Config, error) {
	return config.Load(a.configPath)
}

func (a *App) SetConfig(cfg *config.Config) error {
	return config.Save(a.configPath, cfg)
}

func (a *App) GetRecentDirs() []RecentDir {
	data, err := os.ReadFile(a.recentDirsPath)
	if err != nil {
		return []RecentDir{}
	}
	var dirs []RecentDir
	if err := json.Unmarshal(data, &dirs); err != nil {
		return []RecentDir{}
	}
	return dirs
}

func (a *App) addRecentDir(path string) {
	dirs := a.GetRecentDirs()
	filtered := make([]RecentDir, 0, len(dirs))
	for _, d := range dirs {
		if d.Path != path {
			filtered = append(filtered, d)
		}
	}
	dirs = append([]RecentDir{{Path: path, LastUsed: time.Now().UTC()}}, filtered...)
	if len(dirs) > 20 {
		dirs = dirs[:20]
	}
	sort.SliceStable(dirs, func(i, j int) bool {
		return dirs[i].LastUsed.After(dirs[j].LastUsed)
	})
	data, err := json.Marshal(dirs)
	if err != nil {
		return
	}
	os.WriteFile(a.recentDirsPath, data, 0600) //nolint:errcheck
}

func mustUserHome() string {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	return home
}
