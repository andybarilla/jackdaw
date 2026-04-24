import { isArtifactKind, type WorkspaceArtifact } from "../../shared/domain/artifact.js";
import {
  isInterventionKind,
  isInterventionStatus,
  isSessionConnectionState,
  isWorkspaceSessionStatus,
  type SessionIntervention,
  type SessionLinkedResources,
  type SessionRecentFile,
  type SessionRuntimeInfo,
  type WorkspaceSession,
} from "../../shared/domain/session.js";
import type {
  Workspace,
  WorkspaceOptionalIntegrations,
  WorkspacePreferences,
  WorkspaceRepoRoot,
  WorkspaceWorktree,
} from "../../shared/domain/workspace.js";

export interface PersistedWorkspaceIndexEntry {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface PersistedAppState {
  version: 1;
  selectedWorkspaceId?: string;
  workspaces: PersistedWorkspaceIndexEntry[];
}

export interface PersistedWorkspaceState {
  version: 1;
  workspace: Workspace;
  sessions: WorkspaceSession[];
  artifacts: WorkspaceArtifact[];
}

const VALID_ATTENTION_VIEWS = new Set<NonNullable<WorkspacePreferences["attentionView"]>>([
  "all",
  "needs-operator",
  "active",
  "quiet",
]);
const VALID_DETAIL_VIEWS = new Set<NonNullable<WorkspacePreferences["detailView"]>>([
  "summary",
  "events",
  "artifacts",
]);
const VALID_RECENT_FILE_OPERATIONS = new Set<NonNullable<SessionRecentFile["operation"]>>([
  "created",
  "edited",
  "deleted",
  "unknown",
]);

export function createEmptyPersistedAppState(): PersistedAppState {
  return {
    version: 1,
    workspaces: [],
  };
}

export function createPersistedWorkspaceState(workspace: Workspace): PersistedWorkspaceState {
  return {
    version: 1,
    workspace,
    sessions: [],
    artifacts: [],
  };
}

export function workspaceToIndexEntry(workspace: Workspace, lastOpenedAt?: string): PersistedWorkspaceIndexEntry {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lastOpenedAt,
  };
}

export function parsePersistedAppState(value: unknown): PersistedAppState {
  const objectValue = readObject(value, "Persisted app state");
  if (objectValue.version !== 1) {
    throw new TypeError(`Persisted app state version must be 1`);
  }

  const workspacesValue = objectValue.workspaces;
  if (!Array.isArray(workspacesValue)) {
    throw new TypeError("Persisted app state workspaces must be an array");
  }

  const selectedWorkspaceId = readOptionalString(objectValue.selectedWorkspaceId, "Persisted app state selectedWorkspaceId");
  const workspaces = workspacesValue.map((entry, index) => parseWorkspaceIndexEntry(entry, index));

  return {
    version: 1,
    selectedWorkspaceId,
    workspaces,
  };
}

export function parsePersistedWorkspaceState(value: unknown): PersistedWorkspaceState {
  const objectValue = readObject(value, "Persisted workspace state");
  if (objectValue.version !== 1) {
    throw new TypeError("Persisted workspace state version must be 1");
  }

  const workspace = parseWorkspace(objectValue.workspace, "Persisted workspace state workspace");
  if (!Array.isArray(objectValue.sessions)) {
    throw new TypeError("Persisted workspace state sessions must be an array");
  }
  if (!Array.isArray(objectValue.artifacts)) {
    throw new TypeError("Persisted workspace state artifacts must be an array");
  }

  const sessions = objectValue.sessions.map((sessionValue, index) =>
    parseWorkspaceSession(sessionValue, `Persisted workspace state sessions[${index}]`, workspace.id),
  );
  const artifacts = objectValue.artifacts.map((artifactValue, index) =>
    parseWorkspaceArtifact(artifactValue, `Persisted workspace state artifacts[${index}]`, workspace.id),
  );

  assertWorkspaceLinks(workspace, sessions, artifacts);

  return {
    version: 1,
    workspace,
    sessions,
    artifacts,
  };
}

function parseWorkspaceIndexEntry(value: unknown, index: number): PersistedWorkspaceIndexEntry {
  const objectValue = readObject(value, `Persisted app state workspaces[${index}]`);

  return {
    id: readRequiredString(objectValue.id, `Persisted app state workspaces[${index}] id`),
    name: readRequiredString(objectValue.name, `Persisted app state workspaces[${index}] name`),
    description: readOptionalString(objectValue.description, `Persisted app state workspaces[${index}] description`),
    createdAt: readRequiredString(objectValue.createdAt, `Persisted app state workspaces[${index}] createdAt`),
    updatedAt: readRequiredString(objectValue.updatedAt, `Persisted app state workspaces[${index}] updatedAt`),
    lastOpenedAt: readOptionalString(objectValue.lastOpenedAt, `Persisted app state workspaces[${index}] lastOpenedAt`),
  };
}

function parseWorkspace(value: unknown, context: string): Workspace {
  const objectValue = readObject(value, context);

  return {
    id: readRequiredString(objectValue.id, `${context} id`),
    name: readRequiredString(objectValue.name, `${context} name`),
    description: readOptionalString(objectValue.description, `${context} description`),
    repoRoots: readArray(objectValue.repoRoots, `${context} repoRoots`).map((repoRootValue, index) =>
      parseRepoRoot(repoRootValue, `${context} repoRoots[${index}]`),
    ),
    worktrees: readArray(objectValue.worktrees, `${context} worktrees`).map((worktreeValue, index) =>
      parseWorktree(worktreeValue, `${context} worktrees[${index}]`),
    ),
    sessionIds: readStringArray(objectValue.sessionIds, `${context} sessionIds`),
    artifactIds: readStringArray(objectValue.artifactIds, `${context} artifactIds`),
    preferences: parseWorkspacePreferences(objectValue.preferences, `${context} preferences`),
    optionalIntegrations: parseWorkspaceOptionalIntegrations(
      objectValue.optionalIntegrations,
      `${context} optionalIntegrations`,
    ),
    createdAt: readRequiredString(objectValue.createdAt, `${context} createdAt`),
    updatedAt: readRequiredString(objectValue.updatedAt, `${context} updatedAt`),
  };
}

function parseRepoRoot(value: unknown, context: string): WorkspaceRepoRoot {
  const objectValue = readObject(value, context);

  return {
    id: readRequiredString(objectValue.id, `${context} id`),
    path: readRequiredString(objectValue.path, `${context} path`),
    name: readRequiredString(objectValue.name, `${context} name`),
    defaultBranch: readOptionalString(objectValue.defaultBranch, `${context} defaultBranch`),
  };
}

function parseWorktree(value: unknown, context: string): WorkspaceWorktree {
  const objectValue = readObject(value, context);

  return {
    id: readRequiredString(objectValue.id, `${context} id`),
    repoRootId: readRequiredString(objectValue.repoRootId, `${context} repoRootId`),
    path: readRequiredString(objectValue.path, `${context} path`),
    branch: readOptionalString(objectValue.branch, `${context} branch`),
    label: readOptionalString(objectValue.label, `${context} label`),
  };
}

function parseWorkspacePreferences(value: unknown, context: string): WorkspacePreferences {
  if (value === undefined) {
    return {};
  }

  const objectValue = readObject(value, context);
  const attentionView = readOptionalString(objectValue.attentionView, `${context} attentionView`);
  const detailView = readOptionalString(objectValue.detailView, `${context} detailView`);

  if (attentionView !== undefined && !VALID_ATTENTION_VIEWS.has(attentionView as NonNullable<WorkspacePreferences["attentionView"]>)) {
    throw new TypeError(`${context} attentionView must be a valid workspace attention view`);
  }
  if (detailView !== undefined && !VALID_DETAIL_VIEWS.has(detailView as NonNullable<WorkspacePreferences["detailView"]>)) {
    throw new TypeError(`${context} detailView must be a valid workspace detail view`);
  }

  return {
    selectedSessionId: readOptionalString(objectValue.selectedSessionId, `${context} selectedSessionId`),
    selectedArtifactId: readOptionalString(objectValue.selectedArtifactId, `${context} selectedArtifactId`),
    attentionView: attentionView as WorkspacePreferences["attentionView"],
    detailView: detailView as WorkspacePreferences["detailView"],
  };
}

function parseWorkspaceOptionalIntegrations(value: unknown, context: string): WorkspaceOptionalIntegrations | undefined {
  if (value === undefined) {
    return undefined;
  }

  const objectValue = readObject(value, context);
  return {
    hqProjectId: readOptionalString(objectValue.hqProjectId, `${context} hqProjectId`),
    figmaFileKey: readOptionalString(objectValue.figmaFileKey, `${context} figmaFileKey`),
  };
}

function parseWorkspaceSession(value: unknown, context: string, workspaceId: string): WorkspaceSession {
  const objectValue = readObject(value, context);
  const status = readRequiredString(objectValue.status, `${context} status`);
  const connectionState = readRequiredString(objectValue.connectionState, `${context} connectionState`);

  if (!isWorkspaceSessionStatus(status)) {
    throw new TypeError(`${context} status must be a valid workspace session status`);
  }
  if (!isSessionConnectionState(connectionState)) {
    throw new TypeError(`${context} connectionState must be live or historical`);
  }

  const sessionWorkspaceId = readRequiredString(objectValue.workspaceId, `${context} workspaceId`);
  if (sessionWorkspaceId !== workspaceId) {
    throw new TypeError(`${context} workspaceId must match workspace ${workspaceId}`);
  }

  return {
    id: readRequiredString(objectValue.id, `${context} id`),
    workspaceId: sessionWorkspaceId,
    name: readRequiredString(objectValue.name, `${context} name`),
    repoRoot: readRequiredString(objectValue.repoRoot, `${context} repoRoot`),
    worktree: readOptionalString(objectValue.worktree, `${context} worktree`),
    cwd: readRequiredString(objectValue.cwd, `${context} cwd`),
    branch: readOptionalString(objectValue.branch, `${context} branch`),
    runtime: parseSessionRuntimeInfo(objectValue.runtime, `${context} runtime`),
    status,
    liveSummary: readRequiredString(objectValue.liveSummary, `${context} liveSummary`),
    pinnedSummary: readOptionalString(objectValue.pinnedSummary, `${context} pinnedSummary`),
    latestMeaningfulUpdate: readOptionalString(objectValue.latestMeaningfulUpdate, `${context} latestMeaningfulUpdate`),
    currentActivity: readOptionalString(objectValue.currentActivity, `${context} currentActivity`),
    currentTool: readOptionalString(objectValue.currentTool, `${context} currentTool`),
    lastIntervention: parseSessionIntervention(objectValue.lastIntervention, `${context} lastIntervention`),
    recentFiles: readArray(objectValue.recentFiles, `${context} recentFiles`).map((recentFileValue, index) =>
      parseSessionRecentFile(recentFileValue, `${context} recentFiles[${index}]`),
    ),
    linkedResources: parseSessionLinkedResources(objectValue.linkedResources, `${context} linkedResources`),
    connectionState,
    sessionFile: readOptionalString(objectValue.sessionFile, `${context} sessionFile`),
    reconnectNote: readOptionalString(objectValue.reconnectNote, `${context} reconnectNote`),
    startedAt: readOptionalString(objectValue.startedAt, `${context} startedAt`),
    updatedAt: readRequiredString(objectValue.updatedAt, `${context} updatedAt`),
    completedAt: readOptionalString(objectValue.completedAt, `${context} completedAt`),
    hqSessionId: readOptionalString(objectValue.hqSessionId, `${context} hqSessionId`),
  };
}

function parseSessionRuntimeInfo(value: unknown, context: string): SessionRuntimeInfo {
  const objectValue = readObject(value, context);

  return {
    agent: readOptionalString(objectValue.agent, `${context} agent`),
    model: readOptionalString(objectValue.model, `${context} model`),
    runtime: readOptionalString(objectValue.runtime, `${context} runtime`),
  };
}

function parseSessionIntervention(value: unknown, context: string): SessionIntervention | undefined {
  if (value === undefined) {
    return undefined;
  }

  const objectValue = readObject(value, context);
  const kind = readRequiredString(objectValue.kind, `${context} kind`);
  const status = readRequiredString(objectValue.status, `${context} status`);

  if (!isInterventionKind(kind)) {
    throw new TypeError(`${context} kind must be a valid intervention kind`);
  }
  if (!isInterventionStatus(status)) {
    throw new TypeError(`${context} status must be a valid intervention status`);
  }

  return {
    kind,
    status,
    text: readRequiredString(objectValue.text, `${context} text`),
    requestedAt: readRequiredString(objectValue.requestedAt, `${context} requestedAt`),
    observedAt: readOptionalString(objectValue.observedAt, `${context} observedAt`),
    errorMessage: readOptionalString(objectValue.errorMessage, `${context} errorMessage`),
  };
}

function parseSessionRecentFile(value: unknown, context: string): SessionRecentFile {
  const objectValue = readObject(value, context);
  const operation = readOptionalString(objectValue.operation, `${context} operation`);
  if (operation !== undefined && !VALID_RECENT_FILE_OPERATIONS.has(operation as NonNullable<SessionRecentFile["operation"]>)) {
    throw new TypeError(`${context} operation must be a valid recent file operation`);
  }

  return {
    path: readRequiredString(objectValue.path, `${context} path`),
    operation: operation as SessionRecentFile["operation"],
    timestamp: readOptionalString(objectValue.timestamp, `${context} timestamp`),
  };
}

function parseSessionLinkedResources(value: unknown, context: string): SessionLinkedResources {
  const objectValue = readObject(value, context);

  return {
    artifactIds: readStringArray(objectValue.artifactIds, `${context} artifactIds`),
    workItemIds: readStringArray(objectValue.workItemIds, `${context} workItemIds`),
    reviewIds: readStringArray(objectValue.reviewIds, `${context} reviewIds`),
    hqWorkItemId: readOptionalString(objectValue.hqWorkItemId, `${context} hqWorkItemId`),
  };
}

function parseWorkspaceArtifact(value: unknown, context: string, workspaceId: string): WorkspaceArtifact {
  const objectValue = readObject(value, context);
  const kind = readRequiredString(objectValue.kind, `${context} kind`);
  if (!isArtifactKind(kind)) {
    throw new TypeError(`${context} kind must be a valid artifact kind`);
  }

  const artifactWorkspaceId = readRequiredString(objectValue.workspaceId, `${context} workspaceId`);
  if (artifactWorkspaceId !== workspaceId) {
    throw new TypeError(`${context} workspaceId must match workspace ${workspaceId}`);
  }

  return {
    id: readRequiredString(objectValue.id, `${context} id`),
    workspaceId: artifactWorkspaceId,
    kind,
    title: readRequiredString(objectValue.title, `${context} title`),
    filePath: readOptionalString(objectValue.filePath, `${context} filePath`),
    sourceSessionId: readOptionalString(objectValue.sourceSessionId, `${context} sourceSessionId`),
    linkedSessionIds: readStringArray(objectValue.linkedSessionIds, `${context} linkedSessionIds`),
    linkedWorkItemIds: readStringArray(objectValue.linkedWorkItemIds, `${context} linkedWorkItemIds`),
    createdAt: readRequiredString(objectValue.createdAt, `${context} createdAt`),
    updatedAt: readRequiredString(objectValue.updatedAt, `${context} updatedAt`),
    hqArtifactId: readOptionalString(objectValue.hqArtifactId, `${context} hqArtifactId`),
  };
}

function assertWorkspaceLinks(
  workspace: Workspace,
  sessions: readonly WorkspaceSession[],
  artifacts: readonly WorkspaceArtifact[],
): void {
  const repoRootIds = new Set<string>(workspace.repoRoots.map((repoRoot) => repoRoot.id));
  const sessionIds = new Set<string>(sessions.map((session) => session.id));
  const artifactIds = new Set<string>(artifacts.map((artifact) => artifact.id));

  for (const worktree of workspace.worktrees) {
    if (!repoRootIds.has(worktree.repoRootId)) {
      throw new TypeError(`Persisted workspace state worktree ${worktree.id} references missing repo root ${worktree.repoRootId}`);
    }
  }
  for (const sessionId of workspace.sessionIds) {
    if (!sessionIds.has(sessionId)) {
      throw new TypeError(`Persisted workspace state references missing session ${sessionId}`);
    }
  }
  for (const artifactId of workspace.artifactIds) {
    if (!artifactIds.has(artifactId)) {
      throw new TypeError(`Persisted workspace state references missing artifact ${artifactId}`);
    }
  }
  if (workspace.preferences.selectedSessionId !== undefined && !sessionIds.has(workspace.preferences.selectedSessionId)) {
    throw new TypeError(
      `Persisted workspace state preferences.selectedSessionId references missing session ${workspace.preferences.selectedSessionId}`,
    );
  }
  if (workspace.preferences.selectedArtifactId !== undefined && !artifactIds.has(workspace.preferences.selectedArtifactId)) {
    throw new TypeError(
      `Persisted workspace state preferences.selectedArtifactId references missing artifact ${workspace.preferences.selectedArtifactId}`,
    );
  }
  for (const session of sessions) {
    if (!workspace.sessionIds.includes(session.id)) {
      throw new TypeError(`Persisted workspace state session ${session.id} is not linked from workspace.sessionIds`);
    }
    for (const artifactId of session.linkedResources.artifactIds) {
      if (!artifactIds.has(artifactId)) {
        throw new TypeError(`Persisted workspace state session ${session.id} references missing artifact ${artifactId}`);
      }
    }
  }
  for (const artifact of artifacts) {
    if (!workspace.artifactIds.includes(artifact.id)) {
      throw new TypeError(`Persisted workspace state artifact ${artifact.id} is not linked from workspace.artifactIds`);
    }
    if (artifact.sourceSessionId !== undefined && !sessionIds.has(artifact.sourceSessionId)) {
      throw new TypeError(`Persisted workspace state artifact ${artifact.id} references missing source session ${artifact.sourceSessionId}`);
    }
    for (const sessionId of artifact.linkedSessionIds) {
      if (!sessionIds.has(sessionId)) {
        throw new TypeError(`Persisted workspace state artifact ${artifact.id} references missing linked session ${sessionId}`);
      }
    }
  }
}

function readObject(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }

  return value;
}

function readRequiredString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${context} must be a string`);
  }

  return value;
}

function readOptionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${context} must be a string`);
  }

  return value;
}

function readStringArray(value: unknown, context: string): string[] {
  const arrayValue = readArray(value, context);
  if (!arrayValue.every((item) => typeof item === "string")) {
    throw new TypeError(`${context} must be an array of strings`);
  }

  return [...arrayValue] as string[];
}
