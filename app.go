package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/andybarilla/jackdaw/internal/config"
	"github.com/andybarilla/jackdaw/internal/notification"
	"github.com/andybarilla/jackdaw/internal/session"
	"github.com/andybarilla/jackdaw/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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
	}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// Recover sessions that survived a previous shutdown
	recovered := a.manager.Recover()

	// Start hook listener
	hl, err := notification.NewHookListener(a.notifSvc, "127.0.0.1:0")
	if err == nil {
		a.hookListener = hl
		go hl.Serve()
	}

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
				if existed && prev == session.StatusRunning && s.Status == session.StatusExited {
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
	})

	// Wire output handlers for recovered sessions (read loops start when frontend attaches)
	for _, info := range recovered {
		id := info.ID
		a.manager.SetOnOutput(id, func(data []byte) {
			runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		})
	}

	runtime.EventsOn(ctx, "terminal-input", func(data ...interface{}) {
		if len(data) < 2 {
			return
		}
		id, _ := data[0].(string)
		input, _ := data[1].(string)
		if err := a.manager.WriteToSession(id, []byte(input)); err != nil {
			a.termManager.Write(id, []byte(input))
		}
	})

	runtime.EventsOn(ctx, "terminal-resize", func(data ...interface{}) {
		if len(data) < 3 {
			return
		}
		id, _ := data[0].(string)
		cols, _ := data[1].(float64)
		rows, _ := data[2].(float64)
		if err := a.manager.ResizeSession(id, uint16(cols), uint16(rows)); err != nil {
			a.termManager.Resize(id, uint16(cols), uint16(rows))
		}
	})
}

func (a *App) Shutdown(ctx context.Context) {
	if a.hookListener != nil {
		a.hookListener.Close()
	}
	a.notifSvc.Close()
	a.termManager.CloseAll()
}

func (a *App) CreateTerminal(workDir string) (*terminal.TerminalInfo, error) {
	workDir = expandHome(workDir)
	info, err := a.termManager.Create(workDir)
	if err != nil {
		return nil, err
	}

	a.termManager.StartReadLoop(info.ID, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+info.ID, string(data))
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

func (a *App) PickDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Working Directory",
	})
}

func (a *App) CreateSession(workDir string) (*session.SessionInfo, error) {
	workDir = expandHome(workDir)
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	var env []string
	if a.hookListener != nil {
		hookURL := fmt.Sprintf("http://%s/notify/%s", a.hookListener.Addr(), id)
		env = append(env, session.BuildClaudeHookEnv(hookURL))
	}

	info, err := a.manager.Create(id, workDir, "claude", nil, env, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
		if pm, ok := a.patternMatchers[id]; ok {
			if a.hookListener == nil || !a.hookListener.HasSession(id) {
				pm.Feed(data)
			}
		}
		if ed, ok := a.errorDetectors[id]; ok {
			ed.Feed(data)
		}
	})
	if err != nil {
		return nil, err
	}

	a.patternMatchers[info.ID] = notification.NewPatternMatcher(a.notifSvc, info.ID, info.Name)
	if a.errorDetectionEnabled {
		a.errorDetectors[info.ID] = notification.NewErrorDetector(a.notifSvc, info.ID, info.Name)
	}

	if a.hookListener != nil {
		a.hookListener.RegisterSession(info.ID, info.Name)
	}

	a.manager.StartSessionReadLoop(info.ID)
	return info, nil
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

func (a *App) ListSessions() []session.SessionInfo {
	return a.manager.List()
}

func (a *App) KillSession(id string) error {
	delete(a.patternMatchers, id)
	delete(a.errorDetectors, id)
	if a.hookListener != nil {
		a.hookListener.UnregisterSession(id)
	}
	return a.manager.Kill(id)
}

func (a *App) RenameSession(id string, name string) error {
	return a.manager.Rename(id, name)
}

func (a *App) GetConfig() (*config.Config, error) {
	return config.Load(a.configPath)
}

func (a *App) SetConfig(cfg *config.Config) error {
	return config.Save(a.configPath, cfg)
}

func mustUserHome() string {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	return home
}
