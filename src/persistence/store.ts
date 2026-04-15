import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyPersistedState, parsePersistedWorkbenchState, type PersistedWorkbenchState } from "./schema.js";

export class WorkbenchStore {
  constructor(private readonly filePath: string) {}

  static default(projectRoot: string): WorkbenchStore {
    return new WorkbenchStore(path.join(projectRoot, ".jackdaw-workbench", "state.json"));
  }

  async load(): Promise<PersistedWorkbenchState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parsePersistedWorkbenchState(JSON.parse(raw) as unknown);
    } catch {
      return createEmptyPersistedState();
    }
  }

  async save(state: PersistedWorkbenchState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2));
  }
}
