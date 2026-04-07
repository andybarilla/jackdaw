import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalApi {
  searchAddon: SearchAddon;
  focus: () => void;
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
