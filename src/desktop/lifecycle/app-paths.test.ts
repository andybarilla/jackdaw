import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAppPathMock, getPathMock } = vi.hoisted(() => ({
  getAppPathMock: vi.fn<() => string>(),
  getPathMock: vi.fn<(name: string) => string>(),
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: getAppPathMock,
    getPath: getPathMock,
  },
}));

import { resolveAppAssetPath, resolveAppDataDir } from "./app-paths.js";

describe("resolveAppDataDir", () => {
  beforeEach(() => {
    getAppPathMock.mockReset();
    getPathMock.mockReset();
    delete process.env.JACKDAW_APP_DATA_DIR;
  });

  it("returns the configured app data directory when JACKDAW_APP_DATA_DIR is set", () => {
    process.env.JACKDAW_APP_DATA_DIR = "./tmp/app-data";

    expect(resolveAppDataDir()).toBe(path.resolve("./tmp/app-data"));
    expect(getPathMock).not.toHaveBeenCalled();
  });

  it("uses Electron userData directly when no override is configured", () => {
    getPathMock.mockReturnValue("/Users/test/Library/Application Support/Jackdaw");

    expect(resolveAppDataDir()).toBe("/Users/test/Library/Application Support/Jackdaw");
    expect(getPathMock).toHaveBeenCalledWith("userData");
  });

  it("resolves packaged assets from the Electron app path", () => {
    getAppPathMock.mockReturnValue("/Applications/Jackdaw.app/Contents/Resources/app.asar");

    expect(resolveAppAssetPath("dist", "service", "main.js")).toBe(
      path.join("/Applications/Jackdaw.app/Contents/Resources/app.asar", "dist", "service", "main.js"),
    );
  });
});
