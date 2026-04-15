import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

export class WorkbenchStore {
  constructor(private readonly filePath: string) {}

  static default(projectRoot: string): WorkbenchStore {
    return new WorkbenchStore(path.join(projectRoot, ".jackdaw-workbench", "state.json"));
  }

  async load(): Promise<PersistedWorkbenchState> {
    try {
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
    const directory = path.dirname(this.filePath);
    const temporaryFilePath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryFilePath, JSON.stringify(state, null, 2));
    await rename(temporaryFilePath, this.filePath);
  }
}

function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
