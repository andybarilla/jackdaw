import { contextBridge } from "electron";
import type { RendererBootstrap } from "../shared/transport/api.js";

const bootstrap: RendererBootstrap = {
  serviceBaseUrl: process.env.JACKDAW_SERVICE_BASE_URL ?? "http://127.0.0.1:7345",
  serviceToken: process.env.JACKDAW_SERVICE_TOKEN ?? "",
  appDataDir: process.env.JACKDAW_APP_DATA_DIR ?? "",
  platform: process.platform,
};

contextBridge.exposeInMainWorld("jackdaw", {
  bootstrap,
});
