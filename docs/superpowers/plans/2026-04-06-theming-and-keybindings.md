# Theming & Keybindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add theme switching (3 built-in themes) and customizable keyboard shortcuts, both backed by a Go-managed config file at `~/.jackdaw/config.json`.

**Architecture:** A Go `config` package handles reading/writing a JSON config file. The frontend defines theme objects (CSS custom properties + xterm theme) and a keybinding registry (action IDs → key combos). Config is loaded on startup; theme changes update CSS vars on `:root` and call `terminal.options.theme`. Keybindings are handled by a single `window` keydown listener that dispatches to an action map. User overrides live in the config file.

**Tech Stack:** Go (config persistence), Svelte 5 runes (reactive state), TypeScript (theme/keybinding logic), xterm.js v5 (terminal theming), vitest (frontend tests), Go testing (backend tests)

---

## File Structure

### Go (new)
- `internal/config/config.go` — Config struct, Load(), Save(), defaults
- `internal/config/config_test.go` — Unit tests for config CRUD

### Go (modify)
- `app.go:12-24` — Add config field to App, expose GetConfig/SetConfig bindings
- `main.go:28-30` — Add config to Bind list (auto-handled by binding App)

### Frontend (new)
- `frontend/src/lib/themes.ts` — Theme type, 3 built-in themes, applyTheme(), getXtermTheme()
- `frontend/src/lib/themes.test.ts` — Tests for theme application
- `frontend/src/lib/keybindings.ts` — Action type, KeyBinding type, defaults, matchKeybinding()
- `frontend/src/lib/keybindings.test.ts` — Tests for keybinding matching
- `frontend/src/lib/config.svelte.ts` — Reactive config state, load/save via Go bindings

### Frontend (modify)
- `frontend/src/app.css:1-13` — Remove hardcoded CSS variables (themes apply them dynamically)
- `frontend/src/main.ts:1-5` — Load config and apply theme on startup
- `frontend/src/App.svelte:1-44` — Import keybinding handler, register global listener
- `frontend/src/lib/Terminal.svelte:21-31` — Read xterm theme from config instead of hardcoding

---

## Task 1: Go Config Package

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`

- [ ] **Step 1: Write failing tests for config Load/Save**

```go
// internal/config/config_test.go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/config/...`
Expected: compilation errors (package doesn't exist yet)

- [ ] **Step 3: Implement config package**

```go
// internal/config/config.go
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type Config struct {
	Theme       string            `json:"theme"`
	Keybindings map[string]string `json:"keybindings"`
}

func Defaults() *Config {
	return &Config{
		Theme:       "whattheflock",
		Keybindings: map[string]string{},
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./internal/config/...`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat: add config package for theme and keybinding persistence"
```

---

## Task 2: Wails Config Bindings

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Add config path and field to App struct, add GetConfig/SetConfig methods**

In `app.go`, add a `configPath` field to `App`, initialize it in `NewApp()`, and add two bound methods:

```go
// Add to imports
import (
	"github.com/andybarilla/jackdaw/internal/config"
)

// Update App struct (app.go:12-15)
type App struct {
	ctx        context.Context
	manager    *session.Manager
	configPath string
}

// Update NewApp() (app.go:17-24) — add configPath initialization
func NewApp() *App {
	home := mustUserHome()
	jackdawDir := filepath.Join(home, ".jackdaw")
	manifestDir := filepath.Join(jackdawDir, "manifests")
	os.MkdirAll(manifestDir, 0700)

	return &App{
		manager:    session.NewManager(manifestDir),
		configPath: filepath.Join(jackdawDir, "config.json"),
	}
}

// Add after KillSession method (app.go:79)
func (a *App) GetConfig() (*config.Config, error) {
	return config.Load(a.configPath)
}

func (a *App) SetConfig(cfg *config.Config) error {
	return config.Save(a.configPath, cfg)
}
```

No changes needed to `main.go` — `App` is already in the `Bind` list, so these methods are auto-exposed.

- [ ] **Step 2: Regenerate Wails JS bindings**

Run: `cd /home/andy/dev/andybarilla/jackdaw && wails generate module`
Expected: generates updated TS bindings in `frontend/wailsjs/go/main/App.js` with `GetConfig()` and `SetConfig()`

- [ ] **Step 3: Verify Go compiles and tests still pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go build ./... && go test ./...`
Expected: build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add app.go frontend/wailsjs/
git commit -m "feat: expose GetConfig/SetConfig as Wails bindings"
```

---

## Task 3: Frontend Theme Definitions

**Files:**
- Create: `frontend/src/lib/themes.ts`
- Create: `frontend/src/lib/themes.test.ts`

- [ ] **Step 1: Write failing tests for theme logic**

```typescript
// frontend/src/lib/themes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  type Theme,
  THEMES,
  applyTheme,
  getXtermTheme,
} from "./themes";

describe("THEMES", () => {
  it("includes whattheflock, dark, and light", () => {
    const names = THEMES.map((t) => t.name);
    expect(names).toContain("whattheflock");
    expect(names).toContain("dark");
    expect(names).toContain("light");
  });

  it("each theme has all required color keys", () => {
    const requiredKeys = [
      "bgPrimary", "bgSecondary", "bgTertiary",
      "textPrimary", "textSecondary", "textMuted",
      "accent", "success", "warning", "error",
      "border", "selectionBackground",
    ];
    for (const theme of THEMES) {
      for (const key of requiredKeys) {
        expect(theme.colors).toHaveProperty(key);
      }
    }
  });
});

describe("applyTheme", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.documentElement;
  });

  afterEach(() => {
    // Clean up CSS variables
    for (const theme of THEMES) {
      for (const key of Object.keys(theme.colors)) {
        const cssVar = "--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        root.style.removeProperty(cssVar);
      }
    }
  });

  it("sets CSS custom properties on :root", () => {
    const theme = THEMES.find((t) => t.name === "whattheflock")!;
    applyTheme(theme);
    expect(root.style.getPropertyValue("--bg-primary")).toBe(theme.colors.bgPrimary);
    expect(root.style.getPropertyValue("--accent")).toBe(theme.colors.accent);
  });
});

describe("getXtermTheme", () => {
  it("returns xterm-compatible theme object", () => {
    const theme = THEMES.find((t) => t.name === "whattheflock")!;
    const xtermTheme = getXtermTheme(theme);
    expect(xtermTheme.background).toBe(theme.colors.bgPrimary);
    expect(xtermTheme.foreground).toBe(theme.colors.textPrimary);
    expect(xtermTheme.cursor).toBe(theme.colors.textPrimary);
    expect(xtermTheme.selectionBackground).toBe(theme.colors.selectionBackground);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: FAIL — module `./themes` not found

- [ ] **Step 3: Implement themes module**

```typescript
// frontend/src/lib/themes.ts
import type { ITheme } from "@xterm/xterm";

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  selectionBackground: string;
}

export interface Theme {
  name: string;
  label: string;
  colors: ThemeColors;
}

const whattheflock: Theme = {
  name: "whattheflock",
  label: "WhatTheFlock",
  colors: {
    bgPrimary: "#000000",
    bgSecondary: "#0a0a0a",
    bgTertiary: "#1a1a1a",
    textPrimary: "#d4d4d4",
    textSecondary: "#777777",
    textMuted: "#666666",
    accent: "#ff2d78",
    success: "#4ade80",
    warning: "#fbbf24",
    error: "#f87171",
    border: "#222222",
    selectionBackground: "#ff2d7840",
  },
};

const dark: Theme = {
  name: "dark",
  label: "Dark",
  colors: {
    bgPrimary: "#1a1b26",
    bgSecondary: "#24283b",
    bgTertiary: "#414868",
    textPrimary: "#c0caf5",
    textSecondary: "#a9b1d6",
    textMuted: "#565f89",
    accent: "#7aa2f7",
    success: "#9ece6a",
    warning: "#e0af68",
    error: "#f7768e",
    border: "#3b4261",
    selectionBackground: "#33467c",
  },
};

const light: Theme = {
  name: "light",
  label: "Light",
  colors: {
    bgPrimary: "#ffffff",
    bgSecondary: "#f0f0f0",
    bgTertiary: "#e0e0e0",
    textPrimary: "#1a1a1a",
    textSecondary: "#4a4a4a",
    textMuted: "#8a8a8a",
    accent: "#d92362",
    success: "#16a34a",
    warning: "#ca8a04",
    error: "#dc2626",
    border: "#d4d4d4",
    selectionBackground: "#d923621a",
  },
};

export const THEMES: Theme[] = [whattheflock, dark, light];

export function findTheme(name: string): Theme {
  return THEMES.find((t) => t.name === name) ?? whattheflock;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    const cssVar = "--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    root.style.setProperty(cssVar, value);
  }
}

export function getXtermTheme(theme: Theme): ITheme {
  return {
    background: theme.colors.bgPrimary,
    foreground: theme.colors.textPrimary,
    cursor: theme.colors.textPrimary,
    selectionBackground: theme.colors.selectionBackground,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: all theme tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/themes.ts frontend/src/lib/themes.test.ts
git commit -m "feat: add theme definitions with whattheflock, dark, and light themes"
```

---

## Task 4: Frontend Keybinding Definitions

**Files:**
- Create: `frontend/src/lib/keybindings.ts`
- Create: `frontend/src/lib/keybindings.test.ts`

- [ ] **Step 1: Write failing tests for keybinding matching**

```typescript
// frontend/src/lib/keybindings.test.ts
import { describe, it, expect } from "vitest";
import {
  type Action,
  DEFAULT_KEYMAP,
  parseBinding,
  matchKeybinding,
} from "./keybindings";

describe("DEFAULT_KEYMAP", () => {
  it("has bindings for core actions", () => {
    const actions = Object.keys(DEFAULT_KEYMAP) as Action[];
    expect(actions).toContain("session.new");
    expect(actions).toContain("session.kill");
    expect(actions).toContain("session.next");
    expect(actions).toContain("session.prev");
  });
});

describe("parseBinding", () => {
  it("parses simple key", () => {
    expect(parseBinding("Escape")).toEqual({
      key: "Escape",
      ctrl: false,
      shift: false,
      alt: false,
    });
  });

  it("parses Ctrl+Shift combo", () => {
    expect(parseBinding("Ctrl+Shift+N")).toEqual({
      key: "n",
      ctrl: true,
      shift: true,
      alt: false,
    });
  });

  it("parses Alt combo", () => {
    expect(parseBinding("Alt+1")).toEqual({
      key: "1",
      ctrl: false,
      shift: false,
      alt: true,
    });
  });

  it("parses Ctrl+Shift+bracket", () => {
    expect(parseBinding("Ctrl+Shift+]")).toEqual({
      key: "]",
      ctrl: true,
      shift: true,
      alt: false,
    });
  });
});

describe("matchKeybinding", () => {
  it("matches a Ctrl+Shift+N event to session.new", () => {
    const event = new KeyboardEvent("keydown", {
      key: "N",
      ctrlKey: true,
      shiftKey: true,
    });
    const keymap = { ...DEFAULT_KEYMAP };
    expect(matchKeybinding(event, keymap)).toBe("session.new");
  });

  it("returns null for unbound keys", () => {
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
    });
    expect(matchKeybinding(event, DEFAULT_KEYMAP)).toBeNull();
  });

  it("respects user overrides", () => {
    const event = new KeyboardEvent("keydown", {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
    });
    const overrides = { "session.new": "Ctrl+Shift+T" };
    const keymap = { ...DEFAULT_KEYMAP, ...overrides };
    expect(matchKeybinding(event, keymap)).toBe("session.new");
  });

  it("does not match when modifier is missing", () => {
    const event = new KeyboardEvent("keydown", {
      key: "N",
      ctrlKey: false,
      shiftKey: true,
    });
    expect(matchKeybinding(event, DEFAULT_KEYMAP)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: FAIL — module `./keybindings` not found

- [ ] **Step 3: Implement keybindings module**

```typescript
// frontend/src/lib/keybindings.ts
export type Action =
  | "session.new"
  | "session.kill"
  | "session.next"
  | "session.prev"
  | "app.toggleSidebar";

export interface ParsedBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type Keymap = Record<string, string>;

export const DEFAULT_KEYMAP: Keymap = {
  "session.new": "Ctrl+Shift+N",
  "session.kill": "Ctrl+Shift+W",
  "session.next": "Ctrl+Shift+]",
  "session.prev": "Ctrl+Shift+[",
  "app.toggleSidebar": "Ctrl+Shift+B",
};

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split("+");
  const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const key = parts[parts.length - 1];

  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    ctrl: modifiers.has("ctrl"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
  };
}

export function matchKeybinding(
  event: KeyboardEvent,
  keymap: Keymap,
): string | null {
  for (const [action, binding] of Object.entries(keymap)) {
    const parsed = parseBinding(binding);
    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (
      eventKey === parsed.key &&
      event.ctrlKey === parsed.ctrl &&
      event.shiftKey === parsed.shift &&
      event.altKey === parsed.alt
    ) {
      return action;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: all keybinding tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/keybindings.ts frontend/src/lib/keybindings.test.ts
git commit -m "feat: add keybinding registry with matching and user overrides"
```

---

## Task 5: Frontend Config State

**Files:**
- Create: `frontend/src/lib/config.svelte.ts`

- [ ] **Step 1: Implement reactive config module**

This module wraps the Go bindings and provides reactive state. It's thin glue — no unit tests needed; it's validated by the integration in Task 6-7.

```typescript
// frontend/src/lib/config.svelte.ts
import { GetConfig, SetConfig } from "../../wailsjs/go/main/App";
import { findTheme, applyTheme, type Theme } from "./themes";
import { DEFAULT_KEYMAP, type Keymap } from "./keybindings";

let currentTheme = $state<Theme>(findTheme("whattheflock"));
let keymap = $state<Keymap>({ ...DEFAULT_KEYMAP });

export function getTheme(): Theme {
  return currentTheme;
}

export function getKeymap(): Keymap {
  return keymap;
}

export async function loadConfig(): Promise<void> {
  const cfg = await GetConfig();
  currentTheme = findTheme(cfg.theme);
  keymap = { ...DEFAULT_KEYMAP, ...cfg.keybindings };
  applyTheme(currentTheme);
}

export async function setTheme(name: string): Promise<void> {
  currentTheme = findTheme(name);
  applyTheme(currentTheme);
  const cfg = await GetConfig();
  cfg.theme = name;
  await SetConfig(cfg);
}

export async function setKeybinding(
  action: string,
  binding: string,
): Promise<void> {
  keymap = { ...keymap, [action]: binding };
  const cfg = await GetConfig();
  cfg.keybindings = { ...cfg.keybindings, [action]: binding };
  await SetConfig(cfg);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/config.svelte.ts
git commit -m "feat: add reactive config state with Go binding integration"
```

---

## Task 6: Wire Themes Into Components

**Files:**
- Modify: `frontend/src/app.css`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/lib/Terminal.svelte`

- [ ] **Step 1: Remove hardcoded CSS variables from app.css**

Replace the `:root` block in `app.css` with just the reset and base styles. Theme variables are now applied dynamically by `applyTheme()`.

Replace lines 1-13 of `frontend/src/app.css` with:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

- [ ] **Step 2: Load config on app startup in main.ts**

Replace `frontend/src/main.ts` with:

```typescript
import App from "./App.svelte";
import { mount } from "svelte";
import { loadConfig } from "./lib/config.svelte";
import "./app.css";

loadConfig().then(() => {
  mount(App, { target: document.getElementById("app")! });
});
```

This ensures the theme is applied before the app renders, preventing a flash of unstyled content.

- [ ] **Step 3: Update Terminal.svelte to use theme from config**

Replace the hardcoded theme in `Terminal.svelte` (lines 1-8 of the script):

```typescript
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { EventsOn, EventsEmit } from "../../wailsjs/runtime/runtime";
  import { getTheme } from "./config.svelte";
  import { getXtermTheme } from "./themes";
  import "@xterm/xterm/css/xterm.css";
```

Replace the `new Terminal({...})` block (lines 21-31) with:

```typescript
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: getXtermTheme(getTheme()),
    });
```

- [ ] **Step 4: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: no type errors

- [ ] **Step 5: Run frontend tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app.css frontend/src/main.ts frontend/src/lib/Terminal.svelte
git commit -m "feat: wire theme system into app startup and terminal rendering"
```

---

## Task 7: Wire Keybindings Into App

**Files:**
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Add global keybinding handler to App.svelte**

Update the `<script>` section of `App.svelte`. Add imports and a keybinding handler:

```typescript
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EventsOn } from "../wailsjs/runtime/runtime";
  import { CreateSession, ListSessions, KillSession } from "../wailsjs/go/main/App";
  import type { SessionInfo } from "./lib/types";
  import Sidebar from "./lib/Sidebar.svelte";
  import Terminal from "./lib/Terminal.svelte";
  import NewSessionDialog from "./lib/NewSessionDialog.svelte";
  import { getKeymap } from "./lib/config.svelte";
  import { matchKeybinding } from "./lib/keybindings";

  let sessions = $state<SessionInfo[]>([]);
  let activeSessionId = $state<string | null>(null);
  let showNewDialog = $state(false);
  let sidebarVisible = $state(true);
  let cleanups: Array<() => void> = [];

  const actions: Record<string, () => void> = {
    "session.new": () => (showNewDialog = true),
    "session.kill": () => {
      if (activeSessionId) handleKill(activeSessionId);
    },
    "session.next": () => selectAdjacentSession(1),
    "session.prev": () => selectAdjacentSession(-1),
    "app.toggleSidebar": () => (sidebarVisible = !sidebarVisible),
  };

  function selectAdjacentSession(delta: number): void {
    if (sessions.length === 0) return;
    const currentIndex = sessions.findIndex((s) => s.id === activeSessionId);
    const nextIndex =
      (currentIndex + delta + sessions.length) % sessions.length;
    activeSessionId = sessions[nextIndex].id;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const action = matchKeybinding(event, getKeymap());
    if (action && actions[action]) {
      event.preventDefault();
      actions[action]();
    }
  }

  onMount(async () => {
    sessions = (await ListSessions()) || [];

    const cancel = EventsOn("sessions-updated", (updated: SessionInfo[]) => {
      sessions = updated || [];
    });
    cleanups.push(cancel);
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
  });

  async function handleNewSession(workDir: string) {
    showNewDialog = false;
    const info = await CreateSession(workDir);
    activeSessionId = info.id;
  }

  async function handleKill(id: string) {
    await KillSession(id);
    if (activeSessionId === id) {
      activeSessionId = null;
    }
  }

  let activeSession = $derived(
    sessions.find((s) => s.id === activeSessionId),
  );
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<main>
  {#if sidebarVisible}
    <Sidebar
      {sessions}
      {activeSessionId}
      onSelect={(id) => (activeSessionId = id)}
      onNew={() => (showNewDialog = true)}
      onKill={handleKill}
    />
  {/if}

  <div class="content">
    {#if activeSession}
      {#key activeSession.id}
        <Terminal sessionId={activeSession.id} />
      {/key}
    {:else}
      <div class="empty">
        <p>No session selected</p>
        <button onclick={() => (showNewDialog = true)}>
          Launch a new session
        </button>
      </div>
    {/if}
  </div>

  {#if showNewDialog}
    <NewSessionDialog
      onSubmit={handleNewSession}
      onCancel={() => (showNewDialog = false)}
    />
  {/if}
</main>
```

The `<style>` block remains unchanged.

- [ ] **Step 2: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: no type errors

- [ ] **Step 3: Run all frontend tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: all tests PASS

- [ ] **Step 4: Run Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./...`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat: add global keybinding handler with sidebar toggle and session navigation"
```

---

## Task 8: Remove Escape Handler From NewSessionDialog

**Files:**
- Modify: `frontend/src/lib/NewSessionDialog.svelte`

The `NewSessionDialog` currently has its own `svelte:window onkeydown` for Escape. This conflicts with the global handler in App.svelte and should be scoped to the dialog element instead.

- [ ] **Step 1: Replace global window listener with dialog-scoped handler**

In `NewSessionDialog.svelte`, remove the `handleKeydown` function and the `<svelte:window>` directive. Instead, add `onkeydown` to the overlay div:

Remove lines 18-22 and line 25:
```typescript
  // DELETE: function handleKeydown and svelte:window
```

Update the overlay div (line 28) to handle Escape:

```svelte
<div class="overlay" onclick={onCancel} onkeydown={(e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }} role="presentation">
```

- [ ] **Step 2: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/NewSessionDialog.svelte
git commit -m "refactor: scope Escape handler to dialog overlay instead of window"
```

---

## Task 9: Verify Full Build

- [ ] **Step 1: Run all Go tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw && go test ./...`
Expected: all PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm test`
Expected: all PASS

- [ ] **Step 3: Run frontend type check**

Run: `cd /home/andy/dev/andybarilla/jackdaw/frontend && npm run check`
Expected: no errors

- [ ] **Step 4: Build the full app**

Run: `cd /home/andy/dev/andybarilla/jackdaw && GOPROXY=https://proxy.golang.org,direct wails build -tags webkit2_41`
Expected: successful build

- [ ] **Step 5: Manual smoke test**

Launch the app and verify:
1. Default theme is WhatTheFlock (pure black background, pink accent)
2. `Ctrl+Shift+N` opens new session dialog
3. `Ctrl+Shift+B` toggles sidebar
4. `Ctrl+Shift+]` / `Ctrl+Shift+[` cycle sessions
5. `Ctrl+Shift+W` kills active session
6. Edit `~/.jackdaw/config.json`, change `"theme": "dark"`, restart — theme switches
7. Edit keybindings in config, restart — overrides work
