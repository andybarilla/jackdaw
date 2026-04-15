import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchStore } from "./store.js";
import type { PersistedWorkbenchState } from "./schema.js";

const persistedState: PersistedWorkbenchState = {
  version: 1,
  sessions: [],
  preferences: {
    detailViewMode: "summary",
  },
};

describe("WorkbenchStore", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("returns an empty state when the persistence file is missing", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const store = WorkbenchStore.default(projectRoot);

    await expect(store.load()).resolves.toEqual(persistedState);
  });

  it("throws when the persistence file exists but contains invalid json", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const statePath = path.join(projectRoot, ".jackdaw-workbench", "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"sessions":[');

    const store = WorkbenchStore.default(projectRoot);

    await expect(store.load()).rejects.toThrow("Failed to load persisted workbench state");
  });

  it("throws when the persistence file contains parseable but malformed state", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const statePath = path.join(projectRoot, ".jackdaw-workbench", "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"sessions":"oops"}');

    const store = WorkbenchStore.default(projectRoot);

    await expect(store.load()).rejects.toThrow("Failed to load persisted workbench state");
  });

  it("rejects a symlinked persistence directory on load", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    const symlinkTarget = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-target-"));
    directories.push(projectRoot, symlinkTarget);

    await symlink(symlinkTarget, path.join(projectRoot, ".jackdaw-workbench"), "dir");

    const store = WorkbenchStore.default(projectRoot);

    await expect(store.load()).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("Persistence directory must be a real directory"),
      }),
    });
  });

  it("saves state atomically via a temporary file rename", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const store = WorkbenchStore.default(projectRoot);
    const directory = path.join(projectRoot, ".jackdaw-workbench");
    const statePath = path.join(directory, "state.json");
    const nextState: PersistedWorkbenchState = {
      ...persistedState,
      lastOpenedAt: 42,
    };

    await store.save(nextState);

    await expect(store.load()).resolves.toEqual(nextState);
    expect(await readFile(statePath, "utf8")).toContain('"lastOpenedAt": 42');
    expect((await listDirectoryEntries(directory)).sort()).toEqual(["state.json"]);
  });

  it("creates the persistence directory and state file with restrictive permissions", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const store = WorkbenchStore.default(projectRoot);
    const directory = path.join(projectRoot, ".jackdaw-workbench");
    const statePath = path.join(directory, "state.json");

    await store.save({ ...persistedState, lastOpenedAt: 42 });

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects a symlinked persistence directory on save", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    const symlinkTarget = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-target-"));
    directories.push(projectRoot, symlinkTarget);

    await symlink(symlinkTarget, path.join(projectRoot, ".jackdaw-workbench"), "dir");

    const store = WorkbenchStore.default(projectRoot);

    await expect(store.save({ ...persistedState, lastOpenedAt: 42 })).rejects.toThrow(
      "Persistence directory must be a real directory",
    );
    await expect(listDirectoryEntries(symlinkTarget)).resolves.toEqual([]);
  });

  it("serializes concurrent saves and keeps only the latest state", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jackdaw-store-"));
    directories.push(projectRoot);

    const store = WorkbenchStore.default(projectRoot);
    const directory = path.join(projectRoot, ".jackdaw-workbench");
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);

    try {
      await Promise.all([
        store.save({ ...persistedState, lastOpenedAt: 1 }),
        store.save({ ...persistedState, lastOpenedAt: 2 }),
      ]);
    } finally {
      dateNowSpy.mockRestore();
    }

    await expect(store.load()).resolves.toEqual({ ...persistedState, lastOpenedAt: 2 });
    expect((await listDirectoryEntries(directory)).sort()).toEqual(["state.json"]);
  });
});

async function listDirectoryEntries(directory: string): Promise<string[]> {
  return readdir(directory);
}
