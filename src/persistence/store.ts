import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyPersistedState, parsePersistedWorkbenchState, type PersistedWorkbenchState } from "./schema.js";

export class WorkbenchStoreLoadError extends Error {
  constructor(
    readonly filePath: string,
    readonly cause: unknown,
  ) {
    super(`Failed to load persisted workbench state from ${filePath}`);
    this.name = "WorkbenchStoreLoadError";
  }
}

export class WorkbenchStorePathError extends Error {
  constructor(readonly directoryPath: string) {
    super(`Persistence directory must be a real directory, not a symlink or other file: ${directoryPath}`);
    this.name = "WorkbenchStorePathError";
  }
}

export class WorkbenchStore {
  private pendingState: PersistedWorkbenchState | undefined;
  private savePromise: Promise<void> | undefined;

  constructor(private readonly filePath: string) {}

  static default(projectRoot: string): WorkbenchStore {
    return new WorkbenchStore(path.join(projectRoot, ".jackdaw-workbench", "state.json"));
  }

  async load(): Promise<PersistedWorkbenchState> {
    try {
      await assertReadablePersistenceDirectory(path.dirname(this.filePath));
      const raw = await readFile(this.filePath, "utf8");
      return parsePersistedWorkbenchState(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return createEmptyPersistedState();
      }
      throw new WorkbenchStoreLoadError(this.filePath, error);
    }
  }

  async save(state: PersistedWorkbenchState): Promise<void> {
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

  private async saveImmediately(state: PersistedWorkbenchState): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryFilePath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

    await ensureWritablePersistenceDirectory(directory);
    await writeFile(temporaryFilePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporaryFilePath, this.filePath);
  }
}

async function assertReadablePersistenceDirectory(directory: string): Promise<void> {
  try {
    const directoryStats = await lstat(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new WorkbenchStorePathError(directory);
    }
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
}

async function ensureWritablePersistenceDirectory(directory: string): Promise<void> {
  try {
    const directoryStats = await lstat(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new WorkbenchStorePathError(directory);
    }
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      await mkdir(directory, { mode: 0o700 });
      return;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
