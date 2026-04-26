import fs from "node:fs/promises";
import { createServer } from "./server.js";
import { resolveServiceAppDataDir } from "./persistence/paths.js";

const port = readPort();
const host = readHost();
const appDataDir = readAppDataDir();

await fs.mkdir(appDataDir, { recursive: true });

const app = createServer({ appDataDir });

try {
  await app.listen({ host, port });
  console.log(`[jackdaw-service] listening on http://${host}:${port}`);
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

function readHost(): string {
  const host = process.env.JACKDAW_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Invalid JACKDAW_HOST for local v1 service: ${host}`);
  }
  return host;
}

function readAppDataDir(): string {
  return resolveServiceAppDataDir();
}
