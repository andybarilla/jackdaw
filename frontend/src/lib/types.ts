import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalApi {
  searchAddon: SearchAddon;
  focus: () => void;
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
  status: "running" | "stopped" | "exited";
  pid: number;
  started_at: string;
  exit_code: number;
}

export interface AppNotification {
  sessionID: string;
  sessionName: string;
  type: "session_exited" | "input_required";
  message: string;
  timestamp: string;
  approveResponse?: string;
  denyResponse?: string;
}
