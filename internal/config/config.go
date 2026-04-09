package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/andybarilla/jackdaw/internal/workspace"
)

type Config struct {
	Theme                string            `json:"theme"`
	Keybindings          map[string]string `json:"keybindings"`
	Layout               json.RawMessage   `json:"layout,omitempty"`
	HistoryMaxBytes      int               `json:"history_max_bytes,omitempty"`
	NotificationsEnabled bool              `json:"notifications_enabled"`
	DesktopNotifications bool              `json:"desktop_notifications"`
	ToastDurationSeconds    int               `json:"toast_duration_seconds,omitempty"`
	ErrorDetectionEnabled   bool              `json:"error_detection_enabled"`
	WorktreeRoot            string            `json:"worktree_root,omitempty"`
	MergeMode               string            `json:"merge_mode,omitempty"` // "squash" (default) or "merge"
	AutoRemoveKilledSessions bool                  `json:"auto_remove_killed_sessions"`
	Workspaces               []workspace.Workspace `json:"workspaces,omitempty"`
	ActiveWorkspaceID        string                `json:"active_workspace_id,omitempty"`
	TerminalFontFamily       string                `json:"terminal_font_family,omitempty"`
	TerminalFontSize         int              `json:"terminal_font_size,omitempty"`
	UIFontFamily             string           `json:"ui_font_family,omitempty"`
	UIFontSize               int              `json:"ui_font_size,omitempty"`
}

func Defaults() *Config {
	return &Config{
		Theme:                "whattheflock",
		Keybindings:          map[string]string{},
		HistoryMaxBytes:      1048576,
		NotificationsEnabled: true,
		DesktopNotifications: true,
		ToastDurationSeconds:  5,
		ErrorDetectionEnabled: true,
	}
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Defaults(), nil
		}
		return nil, err
	}
	cfg := Defaults()
	if err := json.Unmarshal(data, cfg); err != nil {
		return Defaults(), nil
	}
	return cfg, nil
}

func Save(path string, cfg *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
