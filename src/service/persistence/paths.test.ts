import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveServiceAppDataDir,
  resolveServicePersistencePaths,
  resolveWorkspacePersistencePaths,
} from "./paths.js";

describe("service persistence paths", () => {
  let originalAppDataDir: string | undefined;

  beforeEach(() => {
    originalAppDataDir = process.env.JACKDAW_APP_DATA_DIR;
  });

  afterEach(() => {
    if (originalAppDataDir === undefined) {
      delete process.env.JACKDAW_APP_DATA_DIR;
      return;
    }

    process.env.JACKDAW_APP_DATA_DIR = originalAppDataDir;
  });

  it("uses JACKDAW_APP_DATA_DIR as the root persistence directory", () => {
    process.env.JACKDAW_APP_DATA_DIR = "./tmp/user-data";

    expect(resolveServiceAppDataDir()).toBe(path.resolve("./tmp/user-data"));
    expect(resolveServicePersistencePaths()).toEqual({
      appDataDir: path.resolve("./tmp/user-data"),
      appStateFilePath: path.join(path.resolve("./tmp/user-data"), "app-state.json"),
      workspacesDirectoryPath: path.join(path.resolve("./tmp/user-data"), "workspaces"),
    });
  });

  it("uses the provided Electron userData directory directly when no env override exists", () => {
    delete process.env.JACKDAW_APP_DATA_DIR;

    expect(resolveServicePersistencePaths({ desktopUserDataDir: "/tmp/jackdaw-user-data" })).toEqual({
      appDataDir: "/tmp/jackdaw-user-data",
      appStateFilePath: "/tmp/jackdaw-user-data/app-state.json",
      workspacesDirectoryPath: "/tmp/jackdaw-user-data/workspaces",
    });
  });

  it("resolves workspace persistence directly under the userData workspaces directory", () => {
    process.env.JACKDAW_APP_DATA_DIR = "/tmp/jackdaw-user-data";

    expect(resolveWorkspacePersistencePaths("ws-42")).toEqual({
      workspaceDirectoryPath: "/tmp/jackdaw-user-data/workspaces/ws-42",
      workspaceStateFilePath: "/tmp/jackdaw-user-data/workspaces/ws-42/workspace.json",
      artifactsDirectoryPath: "/tmp/jackdaw-user-data/workspaces/ws-42/artifacts",
      cacheDirectoryPath: "/tmp/jackdaw-user-data/workspaces/ws-42/cache",
    });
  });

  it("rejects unsafe workspace id path segments", () => {
    process.env.JACKDAW_APP_DATA_DIR = "/tmp/jackdaw-user-data";

    expect(() => resolveWorkspacePersistencePaths("")).toThrow(/workspace id/i);
    expect(() => resolveWorkspacePersistencePaths("../escape")).toThrow(/workspace id/i);
    expect(() => resolveWorkspacePersistencePaths("nested/workspace")).toThrow(/workspace id/i);
    expect(() => resolveWorkspacePersistencePaths("nested\\workspace")).toThrow(/workspace id/i);
  });
});
