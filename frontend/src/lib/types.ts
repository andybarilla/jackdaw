import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalApi {
  searchAddon: SearchAddon;
  focus: () => void;
  send: (data: string) => void;
}

export interface TerminalInfo {
  id: string;
  work_dir: string;
  pid: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  work_dir: string;
  command: string;
  status: "idle" | "working" | "waiting_for_approval" | "error" | "stopped" | "exited";
  pid: number;
  started_at: string;
  exit_code: number;
  workspace_id?: string;
  worktree_enabled?: boolean;
  worktree_path?: string;
  original_dir?: string;
  branch_name?: string;
  base_branch?: string;
}

export interface WorktreeStatus {
  branch: string;
  uncommitted_files: number;
  unpushed_commits: number;
}

export interface MergeResult {
  success: boolean;
  commit_message?: string;
  error?: string;
}

export interface FileDiff {
  path: string;
  old_path?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  binary: boolean;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "delete";
  content: string;
  old_line?: number;
  new_line?: number;
}

export interface DashboardSession {
  id: string;
  name: string;
  work_dir: string;
  status: SessionInfo["status"];
  started_at: string;
  last_line: string;
  workspace_id?: string;
  worktree_enabled?: boolean;
  branch_name?: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface ShellCommand {
  name: string;
  command: string;
  work_dir?: string;
}

export interface AppNotification {
  sessionID: string;
  sessionName: string;
  type: "session_exited" | "input_required" | "error_detected";
  message: string;
  timestamp: string;
  approveResponse?: string;
  denyResponse?: string;
}
