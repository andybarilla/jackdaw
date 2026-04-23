import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "./server.js";

const port = readPort();
const appDataDir = readAppDataDir();

await fs.mkdir(appDataDir, { recursive: true });

const app = createServer({ appDataDir });

try {
  await app.listen({ host: "127.0.0.1", port });
  console.log(`[jackdaw-service] listening on http://127.0.0.1:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function readPort(): number {
  const raw = process.env.JACKDAW_PORT;
  const port = Number(raw ?? 7345);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid JACKDAW_PORT: ${raw ?? "<unset>"}`);
  }
  return port;
}

function readAppDataDir(): string {
  const configured = process.env.JACKDAW_APP_DATA_DIR;
  if (configured) {
    return path.resolve(configured);
  }

  if (process.env.NODE_ENV === "development") {
    return path.resolve(".jackdaw-app-data");
  }

  throw new Error("JACKDAW_APP_DATA_DIR is required outside development mode");
}
