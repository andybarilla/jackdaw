import { GetConfig, SetConfig } from "../../wailsjs/go/main/App";
import { findTheme, applyTheme, type Theme } from "./themes";
import { DEFAULT_KEYMAP, type Keymap } from "./keybindings";

let currentTheme = $state<Theme>(findTheme("whattheflock"));
let keymap = $state<Keymap>({ ...DEFAULT_KEYMAP });
let toastDuration = $state(5);
let notificationsEnabled = $state(true);
let desktopNotifications = $state(true);
let errorDetectionEnabled = $state(true);
let worktreeRoot = $state("");
let mergeMode = $state("squash");
let historyMaxBytes = $state(1048576);

export function getTheme(): Theme {
  return currentTheme;
}

export function getKeymap(): Keymap {
  return keymap;
}

export function getToastDuration(): number {
  return toastDuration;
}

export function getNotificationsEnabled(): boolean {
  return notificationsEnabled;
}

export function getDesktopNotifications(): boolean {
  return desktopNotifications;
}

export function getErrorDetectionEnabled(): boolean {
  return errorDetectionEnabled;
}

export function getWorktreeRoot(): string {
  return worktreeRoot;
}

export function getMergeMode(): string {
  return mergeMode;
}

export function getHistoryMaxBytes(): number {
  return historyMaxBytes;
}

export async function loadConfig(): Promise<void> {
  const cfg = await GetConfig();
  currentTheme = findTheme(cfg.theme);
  keymap = { ...DEFAULT_KEYMAP, ...cfg.keybindings };
  toastDuration = cfg.toast_duration_seconds || 5;
  notificationsEnabled = cfg.notifications_enabled ?? true;
  desktopNotifications = cfg.desktop_notifications ?? true;
  errorDetectionEnabled = cfg.error_detection_enabled ?? true;
  worktreeRoot = cfg.worktree_root || "";
  mergeMode = cfg.merge_mode || "squash";
  historyMaxBytes = cfg.history_max_bytes || 1048576;
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

export async function setToastDuration(seconds: number): Promise<void> {
  toastDuration = seconds;
  const cfg = await GetConfig();
  cfg.toast_duration_seconds = seconds;
  await SetConfig(cfg);
}

export async function setNotificationsEnabled(v: boolean): Promise<void> {
  notificationsEnabled = v;
  const cfg = await GetConfig();
  cfg.notifications_enabled = v;
  await SetConfig(cfg);
}

export async function setDesktopNotifications(v: boolean): Promise<void> {
  desktopNotifications = v;
  const cfg = await GetConfig();
  cfg.desktop_notifications = v;
  await SetConfig(cfg);
}

export async function setErrorDetectionEnabled(v: boolean): Promise<void> {
  errorDetectionEnabled = v;
  const cfg = await GetConfig();
  cfg.error_detection_enabled = v;
  await SetConfig(cfg);
}

export async function setWorktreeRoot(v: string): Promise<void> {
  worktreeRoot = v;
  const cfg = await GetConfig();
  cfg.worktree_root = v;
  await SetConfig(cfg);
}

export async function setMergeMode(v: string): Promise<void> {
  mergeMode = v;
  const cfg = await GetConfig();
  cfg.merge_mode = v;
  await SetConfig(cfg);
}

export async function setHistoryMaxBytes(v: number): Promise<void> {
  historyMaxBytes = v;
  const cfg = await GetConfig();
  cfg.history_max_bytes = v;
  await SetConfig(cfg);
}
