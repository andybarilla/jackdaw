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
  if (!isObject(value)) {
    throw new TypeError("Persisted workbench state must be an object");
  }
  if ("sessions" in value && !Array.isArray(value.sessions)) {
    throw new TypeError("Persisted workbench state sessions must be an array");
  }
  if ("selectedSessionId" in value && value.selectedSessionId !== undefined && typeof value.selectedSessionId !== "string") {
    throw new TypeError("Persisted workbench state selectedSessionId must be a string");
  }
  if ("lastOpenedAt" in value && value.lastOpenedAt !== undefined && typeof value.lastOpenedAt !== "number") {
    throw new TypeError("Persisted workbench state lastOpenedAt must be a number");
  }
  if ("preferences" in value && value.preferences !== undefined && !isObject(value.preferences)) {
    throw new TypeError("Persisted workbench state preferences must be an object");
  }

  const rawSessions: unknown[] = Array.isArray(value.sessions) ? value.sessions : [];
  const sessions = rawSessions.map((session, index) => parsePersistedSession(session, index));
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

function parsePersistedSession(value: unknown, index: number): WorkbenchSession {
  if (!isObject(value)) throw new TypeError(`Persisted session ${index} must be an object`);
  if (typeof value.id !== "string") throw new TypeError(`Persisted session ${index} id must be a string`);
  if (typeof value.name !== "string") throw new TypeError(`Persisted session ${index} name must be a string`);
  if (typeof value.cwd !== "string") throw new TypeError(`Persisted session ${index} cwd must be a string`);
  if (typeof value.model !== "string") throw new TypeError(`Persisted session ${index} model must be a string`);
  if (typeof value.taskLabel !== "string") throw new TypeError(`Persisted session ${index} taskLabel must be a string`);
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    throw new TypeError(`Persisted session ${index} tags must be an array of strings`);
  }
  if (typeof value.lastUpdateAt !== "number") {
    throw new TypeError(`Persisted session ${index} lastUpdateAt must be a number`);
  }
  if (typeof value.summary !== "string") throw new TypeError(`Persisted session ${index} summary must be a string`);
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status as WorkbenchStatus)) {
    throw new TypeError(`Persisted session ${index} status must be a valid workbench status`);
  }
  if (value.pinnedSummary !== undefined && typeof value.pinnedSummary !== "string") {
    throw new TypeError(`Persisted session ${index} pinnedSummary must be a string`);
  }
  if (value.currentTool !== undefined && typeof value.currentTool !== "string") {
    throw new TypeError(`Persisted session ${index} currentTool must be a string`);
  }
  if (value.sessionFile !== undefined && typeof value.sessionFile !== "string") {
    throw new TypeError(`Persisted session ${index} sessionFile must be a string`);
  }
  if (value.latestText !== undefined && typeof value.latestText !== "string") {
    throw new TypeError(`Persisted session ${index} latestText must be a string`);
  }
  if (value.lastError !== undefined && typeof value.lastError !== "string") {
    throw new TypeError(`Persisted session ${index} lastError must be a string`);
  }
  if (
    value.recentFiles !== undefined &&
    (!Array.isArray(value.recentFiles) || !value.recentFiles.every((item) => typeof item === "string"))
  ) {
    throw new TypeError(`Persisted session ${index} recentFiles must be an array of strings`);
  }
  if (
    value.connectionState !== undefined &&
    value.connectionState !== "live" &&
    value.connectionState !== "historical"
  ) {
    throw new TypeError(`Persisted session ${index} connectionState must be live or historical`);
  }
  if (value.reconnectNote !== undefined && typeof value.reconnectNote !== "string") {
    throw new TypeError(`Persisted session ${index} reconnectNote must be a string`);
  }
  if (value.lastShellCommand !== undefined && typeof value.lastShellCommand !== "string") {
    throw new TypeError(`Persisted session ${index} lastShellCommand must be a string`);
  }
  if (value.lastShellExitCode !== undefined && typeof value.lastShellExitCode !== "number") {
    throw new TypeError(`Persisted session ${index} lastShellExitCode must be a number`);
  }

  return {
    id: value.id,
    name: value.name,
    cwd: value.cwd,
    model: value.model,
    taskLabel: value.taskLabel,
    status: value.status as WorkbenchStatus,
    tags: value.tags,
    lastUpdateAt: value.lastUpdateAt,
    summary: value.summary,
    pinnedSummary: value.pinnedSummary,
    currentTool: value.currentTool,
    sessionFile: value.sessionFile,
    latestText: value.latestText,
    lastError: value.lastError,
    recentFiles: value.recentFiles,
    connectionState: value.connectionState,
    reconnectNote: value.reconnectNote,
    lastShellCommand: value.lastShellCommand,
    lastShellExitCode: value.lastShellExitCode,
  };
}

function readDetailViewMode(value: unknown): WorkbenchDetailViewMode {
  if (!isObject(value)) return "summary";
  if (!("detailViewMode" in value) || value.detailViewMode === undefined) return "summary";

  const detailViewMode = value.detailViewMode;
  if (typeof detailViewMode !== "string" || !VALID_DETAIL_VIEW_MODES.has(detailViewMode as WorkbenchDetailViewMode)) {
    throw new TypeError("Persisted workbench preferences detailViewMode must be a valid detail view mode");
  }
  return detailViewMode as WorkbenchDetailViewMode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
