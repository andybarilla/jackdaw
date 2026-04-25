import { readdir } from "node:fs/promises";
import { AppStore } from "../persistence/app-store.js";
import {
  createEmptyPersistedAppState,
  parsePersistedWorkspaceState,
  workspaceToIndexEntry,
  type PersistedAppState,
  type PersistedWorkspaceIndexEntry,
  type PersistedWorkspaceState,
} from "../persistence/schema.js";
import { assertSafeWorkspaceId, resolveServicePersistencePaths, type ResolveServiceAppDataDirOptions } from "../persistence/paths.js";
import { WorkspaceStore } from "../persistence/workspace-store.js";
import { RepoRegistry } from "./repo-registry.js";
import { linkArtifactToWorkspace, linkSessionToWorkspace, sortArtifactsByWorkspaceOrder, sortSessionsByWorkspaceOrder } from "./session-links.js";
import {
  canonicalizeWorkspacePath,
  normalizeWorkspacePathForComparison,
  workspacePathsMatch,
} from "./workspace-paths.js";
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
  private readonly workspaceMutationQueues = new Map<string, Promise<void>>();
  private appStateMutationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly appStore: AppStore,
    private readonly workspaceStoreFactory: (workspaceId: string) => WorkspaceStore,
    appState: PersistedAppState,
    workspaceDetails: Iterable<WorkspaceDetailRecord>,
    private readonly reservedWorkspaceIds: Set<string>,
  ) {
    this.appState = appState;
    for (const workspaceDetail of workspaceDetails) {
      this.workspaces.set(workspaceDetail.workspace.id, workspaceDetail);
      this.reservedWorkspaceIds.add(workspaceDetail.workspace.id);
    }
  }

  static async load(options: WorkspaceRegistryLoadOptions = {}): Promise<WorkspaceRegistry> {
    const appStore = options.appStore ?? AppStore.default();
    const rawWorkspaceStoreFactory = options.workspaceStoreFactory ?? ((workspaceId: string) => WorkspaceStore.default(workspaceId));
    const workspaceStoreFactory = createCachingWorkspaceStoreFactory(rawWorkspaceStoreFactory);
    const workspacesDirectoryPath = options.workspacesDirectoryPath
      ?? resolveServicePersistencePaths(options.persistencePathOptions).workspacesDirectoryPath;
    const appState = await loadRecoverableAppState(appStore);
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
      if (!isSafeWorkspaceId(workspaceId)) {
        continue;
      }

      const workspaceState = await loadRecoverableWorkspaceState(workspaceStoreFactory, workspaceId);
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
      try {
        await appStore.save(recoveredAppState);
      } catch (error: unknown) {
        console.warn("Failed to save recovered app-state.json during workspace registry load.", error);
      }
    }

    return new WorkspaceRegistry(appStore, workspaceStoreFactory, recoveredAppState, workspaceDetails, new Set(orderedWorkspaceIds.filter(isSafeWorkspaceId)));
  }

  listReservedWorkspaceIds(): string[] {
    return [...this.reservedWorkspaceIds].sort();
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
    assertSafeWorkspaceId(input.id, "workspace id");

    return await this.runWorkspaceMutation(input.id, async (): Promise<WorkspaceDetailRecord> => {
      if (this.workspaces.has(input.id)) {
        throw new Error(`Workspace id already exists: ${input.id}`);
      }
      if (this.reservedWorkspaceIds.has(input.id)) {
        throw new Error(`Workspace id is reserved by an unrecovered workspace directory: ${input.id}`);
      }

      let workspace = createWorkspace({
        id: input.id,
        name: input.name,
        description: input.description,
        repoRoots: [],
        worktrees: [],
        sessionIds: [],
        artifactIds: [],
        preferences: {},
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });

      for (const repoRoot of input.repoRoots ?? []) {
        workspace = this.repoRegistry.addRepoRoot(workspace, await canonicalizeRepoRoot(repoRoot));
      }

      for (const worktree of input.worktrees ?? []) {
        workspace = this.repoRegistry.addWorktree(workspace, await canonicalizeWorktree(worktree));
      }

      const workspaceDetail: WorkspaceDetailRecord = {
        workspace,
        sessions: [],
        artifacts: [],
      };

      await this.persistWorkspaceDetail(workspaceDetail, input.id);
      return cloneWorkspaceDetailRecord(workspaceDetail);
    });
  }

  async updateWorkspace(workspaceId: string, input: UpdateWorkspaceRecordInput): Promise<WorkspaceDetailRecord | undefined> {
    return await this.runWorkspaceMutation(workspaceId, async (): Promise<WorkspaceDetailRecord | undefined> => {
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

      await this.persistWorkspaceDetail(nextDetail, workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async addRepoRoot(workspaceId: string, repoRoot: WorkspaceRepoRoot, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    return await this.runWorkspaceMutation(workspaceId, async (): Promise<WorkspaceDetailRecord | undefined> => {
      const currentDetail = this.workspaces.get(workspaceId);
      if (currentDetail === undefined) {
        return undefined;
      }

      const nextWorkspace = this.repoRegistry.addRepoRoot(currentDetail.workspace, await canonicalizeRepoRoot(repoRoot));
      const nextDetail: WorkspaceDetailRecord = {
        ...currentDetail,
        workspace: {
          ...nextWorkspace,
          updatedAt: updatedAt ?? new Date().toISOString(),
        },
      };

      await this.persistWorkspaceDetail(nextDetail, workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async addWorktree(workspaceId: string, worktree: WorkspaceWorktree, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    return await this.runWorkspaceMutation(workspaceId, async (): Promise<WorkspaceDetailRecord | undefined> => {
      const currentDetail = this.workspaces.get(workspaceId);
      if (currentDetail === undefined) {
        return undefined;
      }

      const nextWorkspace = this.repoRegistry.addWorktree(currentDetail.workspace, await canonicalizeWorktree(worktree));
      const nextDetail: WorkspaceDetailRecord = {
        ...currentDetail,
        workspace: {
          ...nextWorkspace,
          updatedAt: updatedAt ?? new Date().toISOString(),
        },
      };

      await this.persistWorkspaceDetail(nextDetail, workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async removeRepoRoot(workspaceId: string, repoRootId: string, updatedAt?: string): Promise<WorkspaceDetailRecord | undefined> {
    return await this.runWorkspaceMutation(workspaceId, async (): Promise<WorkspaceDetailRecord | undefined> => {
      const currentDetail = this.workspaces.get(workspaceId);
      if (currentDetail === undefined) {
        return undefined;
      }

      const nextWorkspace = removeRepoRootPreservingHistoricalSessionReferences(
        this.repoRegistry,
        currentDetail.workspace,
        currentDetail.sessions,
        repoRootId,
      );
      const nextDetail: WorkspaceDetailRecord = {
        ...currentDetail,
        workspace: {
          ...nextWorkspace,
          updatedAt: updatedAt ?? new Date().toISOString(),
        },
      };

      await this.persistWorkspaceDetail(nextDetail, workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async upsertSession(session: WorkspaceSession, lastOpenedAt?: string): Promise<WorkspaceDetailRecord> {
    return await this.runWorkspaceMutation(session.workspaceId, async (): Promise<WorkspaceDetailRecord> => {
      const canonicalSession = await canonicalizeSessionPaths(session);
      const currentDetail = this.requireWorkspace(canonicalSession.workspaceId);
      const sessions = upsertById(currentDetail.sessions, canonicalSession);
      const linkedWorkspace = linkSessionToWorkspace(currentDetail.workspace, canonicalSession.id);
      const nextDetail: WorkspaceDetailRecord = {
        workspace: {
          ...linkedWorkspace,
          updatedAt: canonicalSession.updatedAt,
        },
        sessions: sortSessionsByWorkspaceOrder(linkedWorkspace, sessions),
        artifacts: currentDetail.artifacts,
        lastOpenedAt: lastOpenedAt ?? currentDetail.lastOpenedAt,
      };

      await this.persistWorkspaceDetail(nextDetail, canonicalSession.workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async upsertArtifact(artifact: WorkspaceArtifact, lastOpenedAt?: string): Promise<WorkspaceDetailRecord> {
    return await this.runWorkspaceMutation(artifact.workspaceId, async (): Promise<WorkspaceDetailRecord> => {
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

      await this.persistWorkspaceDetail(nextDetail, artifact.workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  async markWorkspaceOpened(workspaceId: string, openedAt: string): Promise<WorkspaceDetailRecord | undefined> {
    return await this.runWorkspaceMutation(workspaceId, async (): Promise<WorkspaceDetailRecord | undefined> => {
      const currentDetail = this.workspaces.get(workspaceId);
      if (currentDetail === undefined) {
        return undefined;
      }

      const nextDetail: WorkspaceDetailRecord = {
        ...currentDetail,
        lastOpenedAt: openedAt,
      };

      await this.persistWorkspaceDetail(nextDetail, workspaceId);
      return cloneWorkspaceDetailRecord(nextDetail);
    });
  }

  private async runWorkspaceMutation<T>(workspaceId: string, mutation: () => Promise<T>): Promise<T> {
    assertSafeWorkspaceId(workspaceId, "workspace id");

    const previousQueue = this.workspaceMutationQueues.get(workspaceId) ?? Promise.resolve();
    const operation = (async (): Promise<T> => {
      try {
        await previousQueue;
      } catch {
        // Keep later mutations moving after an earlier mutation reports its own error.
      }

      return await mutation();
    })();
    const nextQueue = operation.then(
      (): void => undefined,
      (): void => undefined,
    );
    this.workspaceMutationQueues.set(workspaceId, nextQueue);
    void nextQueue.then((): void => {
      if (this.workspaceMutationQueues.get(workspaceId) === nextQueue) {
        this.workspaceMutationQueues.delete(workspaceId);
      }
    });

    return await operation;
  }

  private async runAppStateMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const previousQueue = this.appStateMutationQueue;
    const operation = (async (): Promise<T> => {
      try {
        await previousQueue;
      } catch {
        // Keep later app-state writes moving after an earlier write reports its own error.
      }

      return await mutation();
    })();
    this.appStateMutationQueue = operation.then(
      (): void => undefined,
      (): void => undefined,
    );

    return await operation;
  }

  private requireWorkspace(workspaceId: string): WorkspaceDetailRecord {
    const workspaceDetail = this.workspaces.get(workspaceId);
    if (workspaceDetail === undefined) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspaceDetail;
  }

  private async persistWorkspaceDetail(workspaceDetail: WorkspaceDetailRecord, expectedWorkspaceId: string): Promise<void> {
    await this.runAppStateMutation(async (): Promise<void> => {
      const persistedWorkspaceState: PersistedWorkspaceState = {
        version: 1,
        workspace: workspaceDetail.workspace,
        sessions: workspaceDetail.sessions,
        artifacts: workspaceDetail.artifacts,
      };
      const canonicalWorkspaceState = parsePersistedWorkspaceState(persistedWorkspaceState);
      if (canonicalWorkspaceState.workspace.id !== expectedWorkspaceId) {
        throw new Error(
          `Workspace id ${canonicalWorkspaceState.workspace.id} must match persistence slot ${expectedWorkspaceId}`,
        );
      }

      const canonicalWorkspaceDetail: WorkspaceDetailRecord = {
        workspace: canonicalWorkspaceState.workspace,
        sessions: canonicalWorkspaceState.sessions,
        artifacts: canonicalWorkspaceState.artifacts,
        lastOpenedAt: workspaceDetail.lastOpenedAt,
      };
      const nextAppState = syncAppStateIndex(this.appState, canonicalWorkspaceDetail.workspace, canonicalWorkspaceDetail.lastOpenedAt);

      await this.workspaceStoreFactory(canonicalWorkspaceDetail.workspace.id).save(canonicalWorkspaceState);

      this.workspaces.set(canonicalWorkspaceDetail.workspace.id, cloneWorkspaceDetailRecord(canonicalWorkspaceDetail));
      this.reservedWorkspaceIds.add(canonicalWorkspaceDetail.workspace.id);
      this.appState = nextAppState;

      await this.appStore.save(nextAppState);
    });
  }
}

function createCachingWorkspaceStoreFactory(
  rawWorkspaceStoreFactory: (workspaceId: string) => WorkspaceStore,
): (workspaceId: string) => WorkspaceStore {
  const workspaceStores = new Map<string, WorkspaceStore>();

  return (workspaceId: string): WorkspaceStore => {
    assertSafeWorkspaceId(workspaceId, "workspace id");

    const existingStore = workspaceStores.get(workspaceId);
    if (existingStore !== undefined) {
      return existingStore;
    }

    const store = rawWorkspaceStoreFactory(workspaceId);
    workspaceStores.set(workspaceId, store);
    return store;
  };
}

function isSafeWorkspaceId(workspaceId: string): boolean {
  try {
    assertSafeWorkspaceId(workspaceId, "workspace id");
    return true;
  } catch {
    return false;
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

async function loadRecoverableAppState(appStore: AppStore): Promise<PersistedAppState> {
  try {
    return await appStore.load();
  } catch {
    return createEmptyPersistedAppState();
  }
}

async function loadRecoverableWorkspaceState(
  workspaceStoreFactory: (workspaceId: string) => WorkspaceStore,
  workspaceId: string,
): Promise<PersistedWorkspaceState | undefined> {
  try {
    const workspaceState = await workspaceStoreFactory(workspaceId).load();
    if (workspaceState !== undefined && workspaceState.workspace.id !== workspaceId) {
      throw new TypeError(`Persisted workspace id ${workspaceState.workspace.id} must match ${workspaceId}`);
    }

    return workspaceState;
  } catch {
    return undefined;
  }
}

async function canonicalizeRepoRoot(repoRoot: WorkspaceRepoRoot): Promise<WorkspaceRepoRoot> {
  return {
    ...repoRoot,
    path: await canonicalizeWorkspacePath(repoRoot.path, `repo root ${repoRoot.id} path`),
  };
}

async function canonicalizeWorktree(worktree: WorkspaceWorktree): Promise<WorkspaceWorktree> {
  return {
    ...worktree,
    path: await canonicalizeWorkspacePath(worktree.path, `worktree ${worktree.id} path`),
  };
}

async function canonicalizeSessionPaths(session: WorkspaceSession): Promise<WorkspaceSession> {
  return {
    ...session,
    repoRoot: await canonicalizeWorkspacePath(session.repoRoot, `session ${session.id} repoRoot`),
    worktree: session.worktree === undefined
      ? undefined
      : await canonicalizeWorkspacePath(session.worktree, `session ${session.id} worktree`),
    cwd: await canonicalizeWorkspacePath(session.cwd, `session ${session.id} cwd`),
  };
}

function removeRepoRootPreservingHistoricalSessionReferences(
  repoRegistry: RepoRegistry,
  workspace: Workspace,
  sessions: readonly WorkspaceSession[],
  repoRootId: string,
): Workspace {
  const repoRoot = workspace.repoRoots.find((entry) => entry.id === repoRootId);
  if (repoRoot === undefined) {
    return workspace;
  }

  const removedWorktrees = workspace.worktrees.filter((worktree) => worktree.repoRootId === repoRootId);
  const referencedWorktreePaths = new Set<string>(
    sessions
      .map((session) => session.worktree)
      .filter((worktreePath): worktreePath is string => worktreePath !== undefined)
      .map((worktreePath) => normalizeWorkspacePathForComparison(worktreePath)),
  );
  const referencesRemovedRepoRoot = sessions.some((session) => workspacePathsMatch(session.repoRoot, repoRoot.path));
  const referencesRemovedWorktree = removedWorktrees.some((worktree) =>
    referencedWorktreePaths.has(normalizeWorkspacePathForComparison(worktree.path)),
  );

  if (!referencesRemovedRepoRoot && !referencesRemovedWorktree) {
    return repoRegistry.removeRepoRoot(workspace, repoRootId);
  }

  return workspace;
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
