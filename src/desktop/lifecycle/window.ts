import { BrowserWindow } from "electron";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererFilePath: string;
  rendererUrl?: string;
}

export async function createMainWindow(options: CreateMainWindowOptions): Promise<BrowserWindow> {
  console.log("[jackdaw-desktop] creating BrowserWindow", options);
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#0A0A0A",
    title: "Jackdaw",
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => {
    console.log("[jackdaw-desktop] BrowserWindow ready-to-show");
  });
  window.on("show", () => {
    console.log("[jackdaw-desktop] BrowserWindow show event");
  });
  window.on("closed", () => {
    console.log("[jackdaw-desktop] BrowserWindow closed");
  });
  window.webContents.on("did-finish-load", () => {
    console.log("[jackdaw-desktop] renderer finished load");
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[jackdaw-desktop] renderer failed load", { errorCode, errorDescription, validatedURL });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[jackdaw-desktop] render process gone", details);
  });

  if (options.rendererUrl) {
    await window.loadURL(options.rendererUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return window;
  }

  await window.loadFile(options.rendererFilePath);
  return window;
}
