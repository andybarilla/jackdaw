package config

import (
	"bytes"
	"encoding/json"
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

func TestSaveAndLoadWithLayout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	layout := json.RawMessage(`{"type":"leaf","content":null}`)
	cfg := &Config{
		Theme:       "dark",
		Keybindings: map[string]string{},
		Layout:      layout,
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, loaded.Layout); err != nil {
		t.Fatalf("compact error: %v", err)
	}
	if compacted.String() != `{"type":"leaf","content":null}` {
		t.Errorf("layout = %s, want %s", compacted.String(), layout)
	}
}

func TestLoadDefaultsHaveNilLayout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Layout != nil {
		t.Errorf("expected nil layout for defaults, got %s", cfg.Layout)
	}
}

func TestDefaultHistoryMaxBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HistoryMaxBytes != 1048576 {
		t.Errorf("expected default HistoryMaxBytes 1048576, got %d", cfg.HistoryMaxBytes)
	}
}

func TestSaveAndLoadHistoryMaxBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	cfg := &Config{
		Theme:           "dark",
		Keybindings:     map[string]string{},
		HistoryMaxBytes: 5242880,
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("save error: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if loaded.HistoryMaxBytes != 5242880 {
		t.Errorf("expected HistoryMaxBytes 5242880, got %d", loaded.HistoryMaxBytes)
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
