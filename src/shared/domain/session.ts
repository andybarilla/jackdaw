export const WORKSPACE_SESSION_STATUSES = [
  "awaiting-input",
  "blocked",
  "failed",
  "running",
  "idle",
  "done",
] as const;

export type WorkspaceSessionStatus = (typeof WORKSPACE_SESSION_STATUSES)[number];

export const SESSION_CONNECTION_STATES = ["live", "historical"] as const;
export type SessionConnectionState = (typeof SESSION_CONNECTION_STATES)[number];

export const INTERVENTION_KINDS = ["steer", "follow-up", "abort"] as const;
export type SessionInterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_STATUSES = [
  "accepted-locally",
  "pending-observation",
  "observed",
  "failed-locally",
] as const;
export type SessionInterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export interface SessionRuntimeInfo {
  agent?: string;
  model?: string;
  runtime?: string;
}

export interface SessionRecentFile {
  path: string;
  operation?: "created" | "edited" | "deleted" | "unknown";
  timestamp?: string;
}

export interface SessionLinkedResources {
  artifactIds: string[];
  workItemIds: string[];
  reviewIds: string[];
  hqWorkItemId?: string;
}

export interface SessionIntervention {
  kind: SessionInterventionKind;
  status: SessionInterventionStatus;
  text: string;
  requestedAt: string;
  observedAt?: string;
  errorMessage?: string;
}

export interface WorkspaceSession {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  worktree?: string;
  cwd: string;
  branch?: string;
  runtime: SessionRuntimeInfo;
  status: WorkspaceSessionStatus;
  liveSummary: string;
  pinnedSummary?: string;
  latestMeaningfulUpdate?: string;
  currentActivity?: string;
  currentTool?: string;
  lastIntervention?: SessionIntervention;
  recentFiles: SessionRecentFile[];
  linkedResources: SessionLinkedResources;
  connectionState: SessionConnectionState;
  sessionFile?: string;
  reconnectNote?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  hqSessionId?: string;
}

const STATUS_RANK: Record<WorkspaceSessionStatus, number> = {
  "awaiting-input": 0,
  blocked: 1,
  failed: 2,
  running: 3,
  idle: 4,
  done: 5,
};

export function isWorkspaceSessionStatus(value: unknown): value is WorkspaceSessionStatus {
  return typeof value === "string" && WORKSPACE_SESSION_STATUSES.includes(value as WorkspaceSessionStatus);
}

export function rankWorkspaceSessionStatus(status: WorkspaceSessionStatus): number {
  return STATUS_RANK[status];
}

export function compareSessionStatusPriority(a: WorkspaceSessionStatus, b: WorkspaceSessionStatus): number {
  return rankWorkspaceSessionStatus(a) - rankWorkspaceSessionStatus(b);
}

export function isSessionConnectionState(value: unknown): value is SessionConnectionState {
  return typeof value === "string" && SESSION_CONNECTION_STATES.includes(value as SessionConnectionState);
}

export function isInterventionKind(value: unknown): value is SessionInterventionKind {
  return typeof value === "string" && INTERVENTION_KINDS.includes(value as SessionInterventionKind);
}

export function isInterventionStatus(value: unknown): value is SessionInterventionStatus {
  return typeof value === "string" && INTERVENTION_STATUSES.includes(value as SessionInterventionStatus);
}
