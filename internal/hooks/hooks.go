package hooks

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

type Hook string

const (
	PreCreate   Hook = "pre_create"
	PostCreate  Hook = "post_create"
	PreDestroy  Hook = "pre_destroy"
	PostDestroy Hook = "post_destroy"
)

type Config struct {
	Hooks map[Hook]string `json:"hooks"`
}

// Load reads .jackdaw.json from dir. Returns nil, nil if the file doesn't exist.
func Load(dir string) (*Config, error) {
	data, err := os.ReadFile(filepath.Join(dir, ".jackdaw.json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Run executes a hook command. If cfg is nil or the hook is not configured, it's a no-op.
// The caller provides a context (with timeout) and decides how to handle errors.
func Run(ctx context.Context, hook Hook, cfg *Config, dir string, env map[string]string) error {
	if cfg == nil || cfg.Hooks == nil {
		return nil
	}
	cmdStr, ok := cfg.Hooks[hook]
	if !ok || cmdStr == "" {
		return nil
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", cmdStr)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	return cmd.Run()
}
