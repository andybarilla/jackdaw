import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { migratePersistedAppState } from "./migrations.js";
import { resolveServicePersistencePaths } from "./paths.js";
import { createEmptyPersistedAppState, type PersistedAppState } from "./schema.js";

export class AppStoreLoadError extends Error {
  constructor(
    readonly filePath: string,
    readonly cause: unknown,
  ) {
    super(`Failed to load persisted app state from ${filePath}`);
    this.name = "AppStoreLoadError";
  }
}

export class AppStorePathError extends Error {
  constructor(readonly directoryPath: string) {
    super(`Persistence directory must be a real directory, not a symlink or other file: ${directoryPath}`);
    this.name = "AppStorePathError";
  }
}

export class AppStore {
  private pendingState: PersistedAppState | undefined;
  private savePromise: Promise<void> | undefined;

  constructor(private readonly filePath: string) {}

  static default(): AppStore {
    return new AppStore(resolveServicePersistencePaths().appStateFilePath);
  }

  async load(): Promise<PersistedAppState> {
    try {
      await assertReadablePersistenceDirectory(path.dirname(this.filePath));
      const raw = await readFile(this.filePath, "utf8");
      return migratePersistedAppState(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return createEmptyPersistedAppState();
      }
      throw new AppStoreLoadError(this.filePath, error);
    }
  }

  async save(state: PersistedAppState): Promise<void> {
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

  private async saveImmediately(state: PersistedAppState): Promise<void> {
    const directoryPath = path.dirname(this.filePath);
    const temporaryFilePath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

    await ensureWritablePersistenceDirectory(directoryPath);
    await writeFile(temporaryFilePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporaryFilePath, this.filePath);
  }
}

async function assertReadablePersistenceDirectory(directoryPath: string): Promise<void> {
  try {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new AppStorePathError(directoryPath);
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
      throw new AppStorePathError(directoryPath);
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
