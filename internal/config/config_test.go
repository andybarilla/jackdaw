package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReturnsDefaultsWhenFileDoesNotExist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Theme != "whattheflock" {
		t.Errorf("expected default theme 'whattheflock', got %q", cfg.Theme)
	}
	if cfg.Keybindings == nil {
		t.Error("expected non-nil keybindings map")
	}
}

func TestSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := &Config{
		Theme:       "light",
		Keybindings: map[string]string{"session.new": "Ctrl+Shift+T"},
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if loaded.Theme != "light" {
		t.Errorf("expected theme 'light', got %q", loaded.Theme)
	}
	if loaded.Keybindings["session.new"] != "Ctrl+Shift+T" {
		t.Errorf("expected keybinding 'Ctrl+Shift+T', got %q", loaded.Keybindings["session.new"])
	}
}

func TestSaveCreatesParentDirectories(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deep", "config.json")

	cfg := &Config{Theme: "dark", Keybindings: map[string]string{}}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Error("expected config file to exist")
	}
}

func TestLoadIgnoresCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	os.WriteFile(path, []byte("not json{{{"), 0600)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Theme != "whattheflock" {
		t.Errorf("expected default theme on corrupt file, got %q", cfg.Theme)
	}
}
