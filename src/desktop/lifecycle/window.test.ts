import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserWindowConstructorMock, loadUrlMock } = vi.hoisted(() => ({
  browserWindowConstructorMock: vi.fn(),
  loadUrlMock: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation((options: unknown) => {
    browserWindowConstructorMock(options);
    return {
      loadURL: loadUrlMock,
      loadFile: vi.fn(),
      once: vi.fn(),
      on: vi.fn(),
      webContents: {
        on: vi.fn(),
        openDevTools: vi.fn(),
      },
    };
  }),
}));

import { createDesktopErrorWindow } from "./window.js";

describe("createDesktopErrorWindow", () => {
  beforeEach(() => {
    browserWindowConstructorMock.mockClear();
    loadUrlMock.mockClear();
  });

  it("renders a visible startup failure surface instead of a blank window", async () => {
    await createDesktopErrorWindow({
      title: "Startup failed",
      message: "The local workspace service did not become ready.",
      detail: "Timed out waiting for service health",
    });

    expect(browserWindowConstructorMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Jackdaw startup error",
      backgroundColor: "#0A0A0A",
    }));
    expect(loadUrlMock).toHaveBeenCalledTimes(1);
    const loadedUrl = loadUrlMock.mock.calls[0]?.[0] ?? "";
    expect(loadedUrl.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    const html = decodeURIComponent(loadedUrl.slice("data:text/html;charset=utf-8,".length));
    expect(html).toContain("Jackdaw could not start the local workspace service.");
    expect(html).toContain("Startup failed");
    expect(html).toContain("Timed out waiting for service health");
  });
});
