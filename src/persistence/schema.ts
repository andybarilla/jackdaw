import type {
  WorkbenchDetailViewMode,
  WorkbenchSession,
  WorkbenchState,
  WorkbenchStatus,
} from "../types/workbench.js";

export interface PersistedWorkbenchState extends WorkbenchState {
  version: 1;
}

const VALID_STATUSES = new Set<WorkbenchStatus>(["idle", "running", "awaiting-input", "blocked", "failed", "done"]);
const VALID_DETAIL_VIEW_MODES = new Set<WorkbenchDetailViewMode>(["summary", "transcript", "log"]);

export function createEmptyPersistedState(): PersistedWorkbenchState {
  return {
    version: 1,
    sessions: [],
    preferences: {
      detailViewMode: "summary",
    },
  };
}

export function parsePersistedWorkbenchState(value: unknown): PersistedWorkbenchState {
  const empty = createEmptyPersistedState();
  if (!isObject(value)) return empty;

  const sessions = Array.isArray(value.sessions)
    ? value.sessions.map(parsePersistedSession).filter((session): session is WorkbenchSession => session !== undefined)
    : [];
  const selectedSessionId = typeof value.selectedSessionId === "string" ? value.selectedSessionId : undefined;
  const lastOpenedAt = typeof value.lastOpenedAt === "number" ? value.lastOpenedAt : undefined;
  const detailViewMode = readDetailViewMode(value.preferences);

  return {
    version: 1,
    sessions,
    selectedSessionId,
    lastOpenedAt,
    preferences: {
      detailViewMode,
    },
  };
}

function parsePersistedSession(value: unknown): WorkbenchSession | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.id !== "string") return undefined;
  if (typeof value.name !== "string") return undefined;
  if (typeof value.cwd !== "string") return undefined;
  if (typeof value.model !== "string") return undefined;
  if (typeof value.taskLabel !== "string") return undefined;
  if (typeof value.lastUpdateAt !== "number") return undefined;
  if (typeof value.summary !== "string") return undefined;
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status as WorkbenchStatus)) return undefined;

  return {
    id: value.id,
    name: value.name,
    cwd: value.cwd,
    model: value.model,
    taskLabel: value.taskLabel,
    status: value.status as WorkbenchStatus,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
    lastUpdateAt: value.lastUpdateAt,
    summary: value.summary,
    pinnedSummary: typeof value.pinnedSummary === "string" ? value.pinnedSummary : undefined,
    currentTool: typeof value.currentTool === "string" ? value.currentTool : undefined,
    sessionFile: typeof value.sessionFile === "string" ? value.sessionFile : undefined,
    latestText: typeof value.latestText === "string" ? value.latestText : undefined,
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    recentFiles: Array.isArray(value.recentFiles)
      ? value.recentFiles.filter((item): item is string => typeof item === "string")
      : undefined,
    connectionState:
      value.connectionState === "live" || value.connectionState === "historical" ? value.connectionState : undefined,
    reconnectNote: typeof value.reconnectNote === "string" ? value.reconnectNote : undefined,
  };
}

function readDetailViewMode(value: unknown): WorkbenchDetailViewMode {
  if (!isObject(value)) return "summary";
  const detailViewMode = value.detailViewMode;
  if (typeof detailViewMode === "string" && VALID_DETAIL_VIEW_MODES.has(detailViewMode as WorkbenchDetailViewMode)) {
    return detailViewMode as WorkbenchDetailViewMode;
  }
  return "summary";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
