package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/andybarilla/jackdaw/internal/config"
	"github.com/andybarilla/jackdaw/internal/session"
	"github.com/andybarilla/jackdaw/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	manager     *session.Manager
	termManager *terminal.Manager
	configPath  string
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

	return &App{
		manager:     session.NewManager(manifestDir, socketDir, historyDir, int64(cfg.HistoryMaxBytes)),
		termManager: terminal.NewManager(),
		configPath:  configPath,
	}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// Recover sessions that survived a previous shutdown
	recovered := a.manager.Recover()

	a.manager.SetOnUpdate(func(sessions []session.SessionInfo) {
		runtime.EventsEmit(ctx, "sessions-updated", sessions)
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
	// Sessions survive app shutdown — don't kill them.
	// Manifests remain on disk for re-adoption on next launch.
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
	id := ""
	info, err := a.manager.Create(workDir, "claude", nil, func(data []byte) {
		runtime.EventsEmit(a.ctx, "terminal-output-"+id, string(data))
	})
	if err != nil {
		return nil, err
	}
	id = info.ID

	a.manager.StartSessionReadLoop(info.ID)

	return info, nil
}

func (a *App) AttachSession(id string) {
	a.manager.StartSessionReadLoop(id)
}

func (a *App) ListSessions() []session.SessionInfo {
	return a.manager.List()
}

func (a *App) KillSession(id string) error {
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
