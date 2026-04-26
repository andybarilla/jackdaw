import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { resolveAppAssetPath, resolveAppDataDir } from "./lifecycle/app-paths.js";
import { startServiceProcess, type ServiceProcess } from "./lifecycle/service-process.js";
import { createDesktopErrorWindow, createMainWindow } from "./lifecycle/window.js";

let serviceProcess: ServiceProcess | undefined;
let preloadPath = "";
let rendererFilePath = "";

void bootstrap().catch((error: unknown) => {
  void showBootstrapFailure(error);
});

app.on("window-all-closed", async () => {
  await serviceProcess?.stop();
  app.quit();
});

app.on("before-quit", async () => {
  await serviceProcess?.stop();
});

app.on("activate", async () => {
  if (serviceProcess && BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow({
      preloadPath,
      rendererFilePath,
      rendererUrl: process.env.JACKDAW_WEB_URL,
    });
  }
});

async function showBootstrapFailure(error: unknown): Promise<void> {
  console.error("[jackdaw-desktop] bootstrap failed", error);
  try {
    await app.whenReady();
    await createDesktopErrorWindow({
      title: "Startup failed",
      message: "The local workspace service did not become ready. Close this window and restart Jackdaw after checking the details below.",
      detail: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } catch (windowError: unknown) {
    console.error("[jackdaw-desktop] failed to show startup error window", windowError);
  }
}

async function bootstrap(): Promise<void> {
  console.log("[jackdaw-desktop] waiting for Electron app readiness");
  await app.whenReady();
  console.log("[jackdaw-desktop] Electron app ready");

  const appDataDir = resolveAppDataDir();
  const port = await findAvailablePort();
  const serviceToken = randomBytes(32).toString("base64url");
  const appRoot = resolveAppAssetPath();
  const serviceWorkingDirectory = appRoot.endsWith(".asar") ? path.dirname(appRoot) : appRoot;
  const serviceEntrypoint = resolveAppAssetPath("dist", "service", "main.js");
  preloadPath = resolveAppAssetPath("dist", "desktop", "preload.cjs");
  rendererFilePath = resolveAppAssetPath("dist", "web", "index.html");
  console.log("[jackdaw-desktop] resolved runtime paths", {
    appDataDir,
    port,
    appRoot,
    serviceWorkingDirectory,
    serviceEntrypoint,
    preloadPath,
    rendererFilePath,
    webUrl: process.env.JACKDAW_WEB_URL,
  });

  serviceProcess = await startServiceProcess({
    port,
    appDataDir,
    serviceEntrypoint,
    workingDirectory: serviceWorkingDirectory,
    serviceToken,
  });
  console.log("[jackdaw-desktop] started local service process", { baseUrl: serviceProcess.baseUrl });

  process.env.JACKDAW_SERVICE_BASE_URL = serviceProcess.baseUrl;
  process.env.JACKDAW_SERVICE_TOKEN = serviceToken;
  process.env.JACKDAW_APP_DATA_DIR = appDataDir;

  await waitForService(serviceProcess.baseUrl, serviceToken);
  console.log("[jackdaw-desktop] service health check passed");

  await createMainWindow({
    preloadPath,
    rendererFilePath,
    rendererUrl: process.env.JACKDAW_WEB_URL,
  });
  console.log("[jackdaw-desktop] main window created");
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine an open port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForService(baseUrl: string, serviceToken: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${serviceToken}` },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // continue retrying
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for service health at ${baseUrl}/health`);
}
