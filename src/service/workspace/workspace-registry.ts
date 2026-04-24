import { readdir } from "node:fs/promises";
import { AppStore } from "../persistence/app-store.js";
import {
  workspaceToIndexEntry,
  type PersistedAppState,
  type PersistedWorkspaceIndexEntry,
  type PersistedWorkspaceState,
} from "../persistence/schema.js";
import { resolveServicePersistencePaths, type ResolveServiceAppDataDirOptions } from "../persistence/paths.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import { RepoRegistry } from "./repo-registry.js";
import { linkArtifactToWorkspace, linkSessionToWorkspace, sortArtifactsByWorkspaceOrder, sortSessionsByWorkspaceOrder } from "./session-links.js";
import type { WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import { createWorkspace, type Workspace, type WorkspaceRepoRoot, type WorkspaceWorktree } from "../../shared/domain/workspace.js";

export interface WorkspaceDetailRecord {
  workspace: Workspace;
  sessions: WorkspaceSession[];
  artifacts: WorkspaceArtifact[];
  lastOpenedAt?: string;
}

export interface WorkspaceRegistryLoadOptions {
  appStore?: AppStore;
  workspaceStoreFactory?: (workspaceId: string) => WorkspaceStore;
  workspacesDirectoryPath?: string;
  persistencePathOptions?: ResolveServiceAppDataDirOptions;
}

export interface CreateWorkspaceRecordInput {
  id: string;
  name: string;
  description?: string;
  repoRoots?: WorkspaceRepoRoot[];
  worktrees?: WorkspaceWorktree[];
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateWorkspaceRecordInput {
  name?: string;
  description?: string;
  preferences?: Workspace["preferences"];
  optionalIntegrations?: Workspace["optionalIntegrations"];
  updatedAt?: string;
}

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, WorkspaceDetailRecord>();
  private appState: PersistedAppState;
  private readonly repoRegistry = new RepoRegistry();

  private constructor(
    private readonly appStore: AppStore,
    private readonly workspaceStoreFactory: (workspaceId: string) => WorkspaceStore,
    appState: PersistedAppState,
    workspaceDetails: Iterable<WorkspaceDetailRecord>,
  ) {
    this.appState = appState;
    for (const workspaceDetail of workspaceDetails) {
      this.workspaces.set(workspaceDetail.workspace.id, workspaceDetail);
    }
  }

  static async load(options: WorkspaceRegistryLoadOptions = {}): Promise<WorkspaceRegistry> {
    const appStore = options.appStore ?? AppStore.default();
    const workspaceStoreFactory = options.workspaceStoreFactory ?? ((workspaceId: string) => WorkspaceStore.default(workspaceId));
    const workspacesDirectoryPath = options.workspacesDirectoryPath
      ?? resolveServicePersistencePaths(options.persistencePathOptions).workspacesDirectoryPath;
    const appState = await appStore.load();
    const workspaceDetails: WorkspaceDetailRecord[] = [];
    const discoveredWorkspaceIds = await discoverWorkspaceIds(workspacesDirectoryPath);
    const orderedWorkspaceIds = [...new Set<string>([
      ...appState.workspaces.map((entry) => entry.id),
      ...discoveredWorkspaceIds,
    ])];
    const lastOpenedAtByWorkspaceId = new Map<string, string | undefined>(
      appState.workspaces.map((entry) => [entry.id, entry.lastOpenedAt]),
    );
    const recoveredEntries: PersistedWorkspaceIndexEntry[] = [];

    for (const workspaceId of orderedWorkspaceIds) {
      const workspaceState = await workspaceStoreFactory(workspaceId).load();
      if (workspaceState === undefined) {
        continue;
      }

      const recoveredEntry = workspaceToIndexEntry(workspaceState.workspace, lastOpenedAtByWorkspaceId.get(workspaceId));
      recoveredEntries.push(recoveredEntry);
      workspaceDetails.push(toWorkspaceDetailRecord(workspaceState, recoveredEntry));
    }

    const selectedWorkspaceId = appState.selectedWorkspaceId;
    const recoveredAppState: PersistedAppState = {
      version: 1,
      selectedWorkspaceId: selectedWorkspaceId !== undefined && recoveredEntries.some((entry) => entry.id === selectedWorkspaceId)
        ? selectedWorkspaceId
        : undefined,
      workspaces: recoveredEntries,
    };

    if (!persistedAppStatesMatch(appState, recoveredAppState)) {
      await appStore.save(recoveredAppState);
    }

    return new WorkspaceRegistry(appStore, workspaceStoreFactory, recoveredAppState, workspaceDetails);
  }

  listWorkspaces(): Workspace[] {
    return this.appState.workspaces
      .map((entry) => this.workspaces.get(entry.id)?.workspace)
      .filter((workspace): workspace is Workspace => workspace !== undefined)
      .map((workspace) => structuredClone(workspace));
  }

  getWorkspaceDetail(workspaceId: string): WorkspaceDetailRecord | undefined {
    const workspaceDetail = this.workspaces.get(workspaceId);
    return workspaceDetail === undefined ? undefined : cloneWorkspaceDetailRecord(workspaceDetail);
  }

  async createWorkspace(input: CreateWorkspaceRecordInput): Promise<WorkspaceDetailRecord> {
    let workspace = createWorkspace({
      id: input.id,
      name: input.name,
      description: input.description,
      repoRoots: input.repoRoots ?? [],
      worktrees: [],
      sessionIds: [],
      artifactIds: [],
      preferences: {},
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    for (const worktree of input.worktrees ?? []) {
      workspace = this.repoRegistry.addWorktree(workspace, worktree);
    }

    const workspaceDetail: WorkspaceDetailRecord = {
      workspace,
      sessions: [],
      artifacts: [],
    };

    await this.persistWorkspaceDetail(workspaceDetail);
    return cloneWorkspaceDetailRecord(workspaceDetail);
  }

  async updateWorkspace(workspaceId: string, input: UpdateWorkspaceRecordInput): Promise<WorkspaceDetailRecord | undefined> {
    const currentDetail = this.workspaces.get(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const nextWorkspace: Workspace = {
      ...currentDetail.workspace,
      name: input.name ?? currentDetail.workspace.name,
      description: input.description ?? currentDetail.workspace.description,
      preferences: input.preferences === undefined
        ? currentDetail.workspace.preferences
        : { ...currentDetail.workspace.preferences, ...input.preferences },
      optionalIntegrations: input.optionalIntegrations === undefined
        ? currentDetail.workspace.optionalIntegrations
        : { ...currentDetail.workspace.optionalIntegrations, ...input.optionalIntegrations },
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    const nextDetail: WorkspaceDetailRecord = {
      ...currentDetail,
      workspace: nextWorkspace,
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async addRepoRoot(workspaceId: string, repoRoot: WorkspaceRepoRoot, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    const currentDetail = this.workspaces.get(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const nextWorkspace = this.repoRegistry.addRepoRoot(currentDetail.workspace, repoRoot);
    const nextDetail: WorkspaceDetailRecord = {
      ...currentDetail,
      workspace: {
        ...nextWorkspace,
        updatedAt: updatedAt ?? new Date().toISOString(),
      },
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async addWorktree(workspaceId: string, worktree: WorkspaceWorktree, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    const currentDetail = this.workspaces.get(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const nextWorkspace = this.repoRegistry.addWorktree(currentDetail.workspace, worktree);
    const nextDetail: WorkspaceDetailRecord = {
      ...currentDetail,
      workspace: {
        ...nextWorkspace,
        updatedAt: updatedAt ?? new Date().toISOString(),
      },
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async removeRepoRoot(workspaceId: string, repoRootId: string, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    const currentDetail = this.workspaces.get(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const nextWorkspace = this.repoRegistry.removeRepoRoot(currentDetail.workspace, repoRootId);
    const nextDetail: WorkspaceDetailRecord = {
      ...currentDetail,
      workspace: {
        ...nextWorkspace,
        updatedAt: updatedAt ?? new Date().toISOString(),
      },
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async upsertSession(session: WorkspaceSession, lastOpenedAt?: string): Promise<WorkspaceDetailRecord> {
    const currentDetail = this.requireWorkspace(session.workspaceId);
    const sessions = upsertById(currentDetail.sessions, session);
    const linkedWorkspace = linkSessionToWorkspace(currentDetail.workspace, session.id);
    const nextDetail: WorkspaceDetailRecord = {
      workspace: {
        ...linkedWorkspace,
        updatedAt: session.updatedAt,
      },
      sessions: sortSessionsByWorkspaceOrder(linkedWorkspace, sessions),
      artifacts: currentDetail.artifacts,
      lastOpenedAt: lastOpenedAt ?? currentDetail.lastOpenedAt,
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async upsertArtifact(artifact: WorkspaceArtifact, lastOpenedAt?: string): Promise<WorkspaceDetailRecord> {
    const currentDetail = this.requireWorkspace(artifact.workspaceId);
    const artifacts = upsertById(currentDetail.artifacts, artifact);
    const linkedWorkspace = linkArtifactToWorkspace(currentDetail.workspace, artifact.id);
    const nextDetail: WorkspaceDetailRecord = {
      workspace: {
        ...linkedWorkspace,
        updatedAt: artifact.updatedAt,
      },
      sessions: currentDetail.sessions,
      artifacts: sortArtifactsByWorkspaceOrder(linkedWorkspace, artifacts),
      lastOpenedAt: lastOpenedAt ?? currentDetail.lastOpenedAt,
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  async markWorkspaceOpened(workspaceId: string, openedAt: string): Promise<WorkspaceDetailRecord | undefined> {
    const currentDetail = this.workspaces.get(workspaceId);
    if (currentDetail === undefined) {
      return undefined;
    }

    const nextDetail: WorkspaceDetailRecord = {
      ...currentDetail,
      lastOpenedAt: openedAt,
    };

    await this.persistWorkspaceDetail(nextDetail);
    return cloneWorkspaceDetailRecord(nextDetail);
  }

  private requireWorkspace(workspaceId: string): WorkspaceDetailRecord {
    const workspaceDetail = this.workspaces.get(workspaceId);
    if (workspaceDetail === undefined) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspaceDetail;
  }

  private async persistWorkspaceDetail(workspaceDetail: WorkspaceDetailRecord): Promise<void> {
    const persistedWorkspaceState: PersistedWorkspaceState = {
      version: 1,
      workspace: workspaceDetail.workspace,
      sessions: workspaceDetail.sessions,
      artifacts: workspaceDetail.artifacts,
    };
    const nextAppState = syncAppStateIndex(this.appState, workspaceDetail.workspace, workspaceDetail.lastOpenedAt);

    await this.workspaceStoreFactory(workspaceDetail.workspace.id).save(persistedWorkspaceState);
    await this.appStore.save(nextAppState);

    this.workspaces.set(workspaceDetail.workspace.id, cloneWorkspaceDetailRecord(workspaceDetail));
    this.appState = nextAppState;
  }
}

async function discoverWorkspaceIds(workspacesDirectoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(workspacesDirectoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function syncAppStateIndex(
  appState: PersistedAppState,
  workspace: Workspace,
  lastOpenedAt?: string,
): PersistedAppState {
  const nextEntry = workspaceToIndexEntry(workspace, lastOpenedAt);
  const existingIndex = appState.workspaces.findIndex((entry) => entry.id === workspace.id);
  const nextWorkspaces = [...appState.workspaces];

  if (existingIndex === -1) {
    nextWorkspaces.push(nextEntry);
  } else {
    nextWorkspaces[existingIndex] = nextEntry;
  }

  return {
    ...appState,
    workspaces: nextWorkspaces,
  };
}

function persistedAppStatesMatch(left: PersistedAppState, right: PersistedAppState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function toWorkspaceDetailRecord(
  workspaceState: PersistedWorkspaceState,
  indexEntry: PersistedWorkspaceIndexEntry,
): WorkspaceDetailRecord {
  return {
    workspace: structuredClone(workspaceState.workspace),
    sessions: structuredClone(workspaceState.sessions),
    artifacts: structuredClone(workspaceState.artifacts),
    lastOpenedAt: indexEntry.lastOpenedAt,
  };
}

function cloneWorkspaceDetailRecord(workspaceDetail: WorkspaceDetailRecord): WorkspaceDetailRecord {
  return {
    workspace: structuredClone(workspaceDetail.workspace),
    sessions: structuredClone(workspaceDetail.sessions),
    artifacts: structuredClone(workspaceDetail.artifacts),
    lastOpenedAt: workspaceDetail.lastOpenedAt,
  };
}

function upsertById<T extends { id: string }>(items: readonly T[], nextItem: T): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[existingIndex] = nextItem;
  return nextItems;
}
