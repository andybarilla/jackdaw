import path from "node:path";
import { app } from "electron";

export function resolveAppDataDir(): string {
  const configured = process.env.JACKDAW_APP_DATA_DIR;
  if (configured) {
    return path.resolve(configured);
  }

  return app.getPath("userData");
}
