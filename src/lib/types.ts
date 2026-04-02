export type AlertTier = 'high' | 'medium' | 'low' | 'off';

export interface ToolEvent {
  tool_name: string;
  timestamp: string; // ISO 8601 from Rust chrono
  summary: string | null;
  urls: string[];
  file_path: string | null;
}

export type MetadataValue =
  | { type: 'text'; content: string }
  | { type: 'progress'; content: number }
  | { type: 'log'; content: string[] };

export interface MetadataEntry {
  key: string;
  value: MetadataValue;
}

export interface Session {
  session_id: string;
  cwd: string;
  started_at: string; // ISO 8601
  git_branch: string | null;
  current_tool: ToolEvent | null;
  tool_history: ToolEvent[];
  active_subagents: number;
  pending_approval: boolean;
  processing: boolean;
  has_unread: boolean;
  source: 'external' | 'spawned';
  display_name: string | null;
  metadata: Record<string, MetadataEntry>;
  shell_pty_id: string | null;
  parent_session_id: string | null;
  alert_tier: AlertTier | null;
  source_tool: string | null;
  profile_name: string | null;
}

export type HookStatus = 'not_installed' | 'installed' | 'outdated';
export type HookScope = 'user' | 'project';

export interface HistoryToolEvent {
  tool_name: string;
  summary: string | null;
  timestamp: string;
}

export interface HistorySession {
  session_id: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  git_branch: string | null;
  tool_history: HistoryToolEvent[];
}

export interface TerminalOutputPayload {
  session_id: string;
  data: string; // base64-encoded
}

export interface TerminalExitedPayload {
  session_id: string;
  exit_code: number | null;
}

export interface UpdateInfo {
  available: boolean;
  version: string | null;
  body: string | null;
}

export interface UpdateProgress {
  chunk_length: number;
  content_length: number | null;
}

export interface Notification {
  id: number;
  session_id: string;
  event_type: string;
  title: string;
  body: string;
  cwd: string;
  is_read: boolean;
  created_at: string;
}

export type DateFilter = 'today' | 'this_week' | 'this_month';

export interface ResumeResult {
  pty_id: string;
  resumed: boolean;
}

export interface CustomCommand {
  name: string;
  command: string;
  icon: string | null;
  timeout: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
}
