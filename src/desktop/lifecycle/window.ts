import { BrowserWindow } from "electron";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererFilePath: string;
  rendererUrl?: string;
}

export interface CreateDesktopErrorWindowOptions {
  title: string;
  message: string;
  detail?: string;
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

export async function createDesktopErrorWindow(options: CreateDesktopErrorWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 920,
    height: 620,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#0A0A0A",
    title: "Jackdaw startup error",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Jackdaw startup error</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0a0a0a; color: #f5f5f5; }
    main { max-width: 760px; padding: 48px; }
    p { color: #cfcfcf; line-height: 1.5; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #171717; border: 1px solid #333; border-radius: 12px; padding: 16px; color: #ffb4a8; }
  </style>
</head>
<body>
  <main>
    <p>Jackdaw could not start the local workspace service.</p>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.message)}</p>
    ${options.detail === undefined ? "" : `<pre>${escapeHtml(options.detail)}</pre>`}
  </main>
</body>
</html>`;

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return window;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
