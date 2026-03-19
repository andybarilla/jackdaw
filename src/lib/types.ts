export interface ToolEvent {
  tool_name: string;
  timestamp: string; // ISO 8601 from Rust chrono
  summary: string | null;
}

export interface Session {
  session_id: string;
  cwd: string;
  started_at: string; // ISO 8601
  current_tool: ToolEvent | null;
  tool_history: ToolEvent[];
}
