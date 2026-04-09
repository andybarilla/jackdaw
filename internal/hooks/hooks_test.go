package hooks

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoad_MissingFile(t *testing.T) {
	cfg, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if cfg != nil {
		t.Fatalf("expected nil config, got %+v", cfg)
	}
}

func TestLoad_ValidConfig(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".jackdaw.json"), []byte(`{"hooks":{"pre_create":"echo hello"}}`), 0644)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected config, got nil")
	}
	if cfg.Hooks[PreCreate] != "echo hello" {
		t.Fatalf("expected 'echo hello', got %q", cfg.Hooks[PreCreate])
	}
}

func TestLoad_MalformedJSON(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".jackdaw.json"), []byte(`{bad json`), 0644)

	cfg, err := Load(dir)
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
	if cfg != nil {
		t.Fatalf("expected nil config, got %+v", cfg)
	}
}

func TestLoad_MissingHooksKey(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".jackdaw.json"), []byte(`{}`), 0644)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected config, got nil")
	}
	if cfg.Hooks != nil {
		t.Fatalf("expected nil hooks map, got %+v", cfg.Hooks)
	}
}

func TestRun_SuccessfulCommand(t *testing.T) {
	cfg := &Config{Hooks: map[Hook]string{PreCreate: "exit 0"}}
	ctx := context.Background()
	err := Run(ctx, PreCreate, cfg, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestRun_FailingCommand(t *testing.T) {
	cfg := &Config{Hooks: map[Hook]string{PreCreate: "exit 1"}}
	ctx := context.Background()
	err := Run(ctx, PreCreate, cfg, t.TempDir(), nil)
	if err == nil {
		t.Fatal("expected error for exit 1")
	}
}

func TestRun_Timeout(t *testing.T) {
	cfg := &Config{Hooks: map[Hook]string{PreCreate: "sleep 10"}}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := Run(ctx, PreCreate, cfg, t.TempDir(), nil)
	if err == nil {
		t.Fatal("expected error for timeout")
	}
}

func TestRun_NilConfig(t *testing.T) {
	ctx := context.Background()
	err := Run(ctx, PreCreate, nil, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("expected no error for nil config, got %v", err)
	}
}

func TestRun_HookNotInConfig(t *testing.T) {
	cfg := &Config{Hooks: map[Hook]string{PostCreate: "echo hi"}}
	ctx := context.Background()
	err := Run(ctx, PreCreate, cfg, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("expected no error for missing hook, got %v", err)
	}
}

func TestRun_EnvVars(t *testing.T) {
	dir := t.TempDir()
	outFile := filepath.Join(dir, "out.txt")
	cmd := "echo $JACKDAW_SESSION_ID > " + outFile
	cfg := &Config{Hooks: map[Hook]string{PreCreate: cmd}}
	ctx := context.Background()
	env := map[string]string{"JACKDAW_SESSION_ID": "test-123"}
	err := Run(ctx, PreCreate, cfg, dir, env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	data, _ := os.ReadFile(outFile)
	if got := string(data); got != "test-123\n" {
		t.Fatalf("expected 'test-123\\n', got %q", got)
	}
}
