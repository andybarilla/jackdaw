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
