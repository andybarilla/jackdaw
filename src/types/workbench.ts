export type WorkbenchStatus =
  | "idle"
  | "running"
  | "awaiting-input"
  | "blocked"
  | "failed"
  | "done";

export type WorkbenchActivityType =
  | "message_streaming"
  | "tool_running"
  | "tool_finished"
  | "awaiting_user"
  | "session_idle"
  | "session_blocked"
  | "session_failed"
  | "session_completed";

export type WorkbenchDetailViewMode = "summary" | "transcript" | "log";

export type WorkbenchConnectionState = "live" | "historical";

export type WorkbenchActivityOrigin = "session" | "operator";

export type WorkbenchInterventionKind = "steer" | "followup" | "abort";

export type WorkbenchInterventionStatus = "sent" | "pending-observation" | "observed" | "failed";

export interface WorkbenchActivity {
  id: string;
  sessionId: string;
  type: WorkbenchActivityType;
  summary: string;
  timestamp: number;
  origin?: WorkbenchActivityOrigin;
  meaningful?: boolean;
}

export interface WorkbenchIntervention {
  kind: WorkbenchInterventionKind;
  text: string;
  status: WorkbenchInterventionStatus;
  requestedAt: number;
  observedAt?: number;
  errorMessage?: string;
  summary: string;
}

export interface WorkbenchSession {
  id: string;
  name: string;
  cwd: string;
  model: string;
  taskLabel: string;
  status: WorkbenchStatus;
  tags: string[];
  lastUpdateAt: number;
  summary: string;
  pinnedSummary?: string;
  currentTool?: string;
  sessionFile?: string;
  latestText?: string;
  lastError?: string;
  recentFiles?: string[];
  connectionState?: WorkbenchConnectionState;
  reconnectNote?: string;
  lastShellCommand?: string;
  lastShellOutput?: string;
  lastShellExitCode?: number;
  lastIntervention?: WorkbenchIntervention;
}

export interface WorkbenchPreferences {
  detailViewMode: WorkbenchDetailViewMode;
}

export interface WorkbenchState {
  sessions: WorkbenchSession[];
  selectedSessionId?: string;
  lastOpenedAt?: number;
  preferences: WorkbenchPreferences;
}
