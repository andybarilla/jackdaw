import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock,
  },
}));

import { resolveAppDataDir } from "./app-paths.js";

describe("resolveAppDataDir", () => {
  beforeEach(() => {
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
});
