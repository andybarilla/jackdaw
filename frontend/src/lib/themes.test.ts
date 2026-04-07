// @vitest-environment jsdom
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
