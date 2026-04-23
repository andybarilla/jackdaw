import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export interface ServiceProcess {
  child: ChildProcess;
  baseUrl: string;
  appDataDir: string;
  stop: () => Promise<void>;
}

export interface StartServiceProcessOptions {
  port: number;
  appDataDir: string;
  serviceEntrypoint: string;
}

export async function startServiceProcess(options: StartServiceProcessOptions): Promise<ServiceProcess> {
  const child = spawn(process.execPath, [path.resolve(options.serviceEntrypoint)], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      JACKDAW_PORT: String(options.port),
      JACKDAW_APP_DATA_DIR: options.appDataDir,
    },
    stdio: "inherit",
  });

  return {
    child,
    appDataDir: options.appDataDir,
    baseUrl: `http://127.0.0.1:${options.port}`,
    stop: () => stopChild(child),
  };
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
