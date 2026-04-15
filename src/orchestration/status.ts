import type { WorkbenchActivity, WorkbenchStatus } from "../types/workbench.js";

export function deriveStatus(activity?: WorkbenchActivity): WorkbenchStatus {
  if (!activity) return "idle";

  switch (activity.type) {
    case "message_streaming":
    case "tool_running":
      return "running";
    case "awaiting_user":
      return "awaiting-input";
    case "session_blocked":
      return "blocked";
    case "session_failed":
      return "failed";
    case "session_completed":
      return "done";
    case "session_idle":
    case "tool_finished":
    default:
      return "idle";
  }
}
