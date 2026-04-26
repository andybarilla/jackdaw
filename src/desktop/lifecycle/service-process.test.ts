import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startServiceProcess } from "./service-process.js";

vi.mock("node:child_process", () => {
  const childProcessMock = { spawn: vi.fn() };
  return {
    ...childProcessMock,
    default: childProcessMock,
  };
});

const spawnMock = vi.mocked(spawn);

function createChildProcess(): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  Object.defineProperty(emitter, "kill", { value: vi.fn(() => true) });
  Object.defineProperty(emitter, "killed", { value: false });
  Object.defineProperty(emitter, "exitCode", { value: null });
  return emitter;
}

describe("startServiceProcess", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("spawns the service from explicit packaged paths without cwd-relative resolution", async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);

    await startServiceProcess({
      port: 43123,
      appDataDir: "/tmp/jackdaw-data",
      serviceEntrypoint: "/Applications/Jackdaw.app/Contents/Resources/app.asar/dist/service/main.js",
      workingDirectory: "/Applications/Jackdaw.app/Contents/Resources",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ["/Applications/Jackdaw.app/Contents/Resources/app.asar/dist/service/main.js"],
      expect.objectContaining({
        cwd: "/Applications/Jackdaw.app/Contents/Resources",
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: "1",
          JACKDAW_HOST: "127.0.0.1",
          JACKDAW_PORT: "43123",
          JACKDAW_APP_DATA_DIR: "/tmp/jackdaw-data",
        }),
      }),
    );
  });
});
