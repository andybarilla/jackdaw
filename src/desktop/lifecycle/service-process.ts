import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export type LocalServiceProtocol = "http";

export interface LocalServiceEndpointConfig {
  protocol: LocalServiceProtocol;
  host: string;
  port: number;
}

export interface ServiceProcess {
  child: ChildProcess;
  baseUrl: string;
  endpoint: LocalServiceEndpointConfig;
  appDataDir: string;
  stop: () => Promise<void>;
}

export interface StartServiceProcessOptions {
  port: number;
  appDataDir: string;
  serviceEntrypoint: string;
  host?: string;
  protocol?: LocalServiceProtocol;
}

export function createLocalServiceBaseUrl(endpoint: LocalServiceEndpointConfig): string {
  return `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`;
}

export async function startServiceProcess(options: StartServiceProcessOptions): Promise<ServiceProcess> {
  const endpoint: LocalServiceEndpointConfig = {
    protocol: options.protocol ?? "http",
    host: validateLocalServiceHost(options.host ?? "127.0.0.1"),
    port: options.port,
  };
  const child = spawn(process.execPath, [path.resolve(options.serviceEntrypoint)], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      JACKDAW_HOST: endpoint.host,
      JACKDAW_PORT: String(endpoint.port),
      JACKDAW_APP_DATA_DIR: options.appDataDir,
    },
    stdio: "inherit",
  });

  return {
    child,
    endpoint,
    appDataDir: options.appDataDir,
    baseUrl: createLocalServiceBaseUrl(endpoint),
    stop: () => stopChild(child),
  };
}

function validateLocalServiceHost(host: string): string {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Invalid local service host for v1 loopback mode: ${host}`);
  }

  return host;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 1500);
  });
}
