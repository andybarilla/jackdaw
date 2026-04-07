export interface SessionInfo {
  id: string;
  work_dir: string;
  command: string;
  status: "running" | "stopped" | "exited";
  pid: number;
  started_at: string;
  exit_code: number;
}
