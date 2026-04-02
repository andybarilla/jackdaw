export interface HookPayload {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  spawned_session?: string;
  source_tool?: string;
}
