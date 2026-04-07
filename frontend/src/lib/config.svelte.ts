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
