import { GetConfig, SetConfig } from "../../wailsjs/go/main/App";
import { findTheme, applyTheme, type Theme } from "./themes";
import { DEFAULT_KEYMAP, type Keymap } from "./keybindings";

let currentTheme = $state<Theme>(findTheme("whattheflock"));
let keymap = $state<Keymap>({ ...DEFAULT_KEYMAP });
let toastDuration = $state(5);

export function getTheme(): Theme {
  return currentTheme;
}

export function getKeymap(): Keymap {
  return keymap;
}

export function getToastDuration(): number {
  return toastDuration;
}

export async function loadConfig(): Promise<void> {
  const cfg = await GetConfig();
  currentTheme = findTheme(cfg.theme);
  keymap = { ...DEFAULT_KEYMAP, ...cfg.keybindings };
  toastDuration = cfg.toast_duration_seconds || 5;
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
