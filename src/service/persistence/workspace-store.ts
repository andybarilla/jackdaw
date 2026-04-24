import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { migratePersistedWorkspaceState } from "./migrations.js";
import { resolveWorkspacePersistencePaths } from "./paths.js";
import type { PersistedWorkspaceState } from "./schema.js";

export class WorkspaceStoreLoadError extends Error {
  constructor(
    readonly filePath: string,
    readonly cause: unknown,
  ) {
    super(`Failed to load persisted workspace state from ${filePath}`);
    this.name = "WorkspaceStoreLoadError";
  }
}

export class WorkspaceStorePathError extends Error {
  constructor(readonly directoryPath: string) {
    super(`Persistence directory must be a real directory, not a symlink or other file: ${directoryPath}`);
    this.name = "WorkspaceStorePathError";
  }
}

export class WorkspaceStore {
  private pendingState: PersistedWorkspaceState | undefined;
  private savePromise: Promise<void> | undefined;

  constructor(private readonly filePath: string) {}

  static default(workspaceId: string): WorkspaceStore {
    return new WorkspaceStore(resolveWorkspacePersistencePaths(workspaceId).workspaceStateFilePath);
  }

  async load(): Promise<PersistedWorkspaceState | undefined> {
    try {
      await assertReadablePersistenceDirectory(path.dirname(this.filePath));
      const raw = await readFile(this.filePath, "utf8");
      return migratePersistedWorkspaceState(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw new WorkspaceStoreLoadError(this.filePath, error);
    }
  }

  async save(state: PersistedWorkspaceState): Promise<void> {
    this.pendingState = state;
    if (this.savePromise) {
      return this.savePromise;
    }

    this.savePromise = this.flushPendingState().finally(() => {
      this.savePromise = undefined;
    });
    return this.savePromise;
  }

  private async flushPendingState(): Promise<void> {
    while (this.pendingState) {
      const nextState = this.pendingState;
      this.pendingState = undefined;
      await this.saveImmediately(nextState);
    }
  }

  private async saveImmediately(state: PersistedWorkspaceState): Promise<void> {
    const workspaceDirectoryPath = path.dirname(this.filePath);
    const artifactsDirectoryPath = path.join(workspaceDirectoryPath, "artifacts");
    const cacheDirectoryPath = path.join(workspaceDirectoryPath, "cache");
    const temporaryFilePath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

    await ensureWritablePersistenceDirectory(workspaceDirectoryPath);
    await ensureWritablePersistenceDirectory(artifactsDirectoryPath);
    await ensureWritablePersistenceDirectory(cacheDirectoryPath);
    await writeFile(temporaryFilePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporaryFilePath, this.filePath);
  }
}

async function assertReadablePersistenceDirectory(directoryPath: string): Promise<void> {
  try {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new WorkspaceStorePathError(directoryPath);
    }
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
}

async function ensureWritablePersistenceDirectory(directoryPath: string): Promise<void> {
  try {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new WorkspaceStorePathError(directoryPath);
    }
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      await mkdir(directoryPath, { recursive: true, mode: 0o700 });
      return;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
