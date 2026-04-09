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
  searchMatch: string;
  searchMatchActive: string;
}

export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Theme {
  name: string;
  label: string;
  colors: ThemeColors;
  ansiColors?: AnsiColors;
}

const whattheflock: Theme = {
  name: "whattheflock",
  label: "WhatTheFlock",
  colors: {
    bgPrimary: "#141218",
    bgSecondary: "#1c1a21",
    bgTertiary: "#2b2930",
    textPrimary: "#e6e0e9",
    textSecondary: "#c4bfcc",
    textMuted: "#9d99a5",
    accent: "#87d7ff",
    success: "#7fff9a",
    warning: "#ffda72",
    error: "#ff728f",
    border: "#332f38",
    selectionBackground: "#4f378b",
    searchMatch: "#87d7ff40",
    searchMatchActive: "#87d7ff",
  },
  ansiColors: {
    black: "#141218",
    red: "#ff728f",
    green: "#7fff9a",
    yellow: "#ffda72",
    blue: "#bca5f2",
    magenta: "#4e3d76",
    cyan: "#D0BCFF",
    white: "#f4efff",
    brightBlack: "#9d99a5",
    brightRed: "#ff9fb2",
    brightGreen: "#a5ffb8",
    brightYellow: "#ffe7a5",
    brightBlue: "#d7c6ff",
    brightMagenta: "#ded0ff",
    brightCyan: "#e9e0ff",
    brightWhite: "#faf8ff",
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
    searchMatch: "#7aa2f740",
    searchMatchActive: "#7aa2f7",
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
    searchMatch: "#d9236240",
    searchMatchActive: "#d92362",
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
    cursor: theme.colors.accent,
    cursorAccent: theme.colors.bgPrimary,
    selectionBackground: theme.colors.selectionBackground,
    ...theme.ansiColors,
  };
}
