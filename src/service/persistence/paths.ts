import path from "node:path";

export interface ResolveServiceAppDataDirOptions {
  desktopUserDataDir?: string;
}

export class WorkspaceIdValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceIdValidationError";
  }
}

export interface ServicePersistencePaths {
  appDataDir: string;
  appStateFilePath: string;
  workspacesDirectoryPath: string;
}

export interface WorkspacePersistencePaths {
  workspaceDirectoryPath: string;
  workspaceStateFilePath: string;
  artifactsDirectoryPath: string;
  cacheDirectoryPath: string;
}

export function resolveServiceAppDataDir(options: ResolveServiceAppDataDirOptions = {}): string {
  const configuredAppDataDir = process.env.JACKDAW_APP_DATA_DIR;
  if (configuredAppDataDir) {
    return path.resolve(configuredAppDataDir);
  }

  if (options.desktopUserDataDir) {
    return path.resolve(options.desktopUserDataDir);
  }

  throw new Error("JACKDAW_APP_DATA_DIR is required when no desktop userData path is provided");
}

export function resolveServicePersistencePaths(options: ResolveServiceAppDataDirOptions = {}): ServicePersistencePaths {
  const appDataDir = resolveServiceAppDataDir(options);

  return {
    appDataDir,
    appStateFilePath: path.join(appDataDir, "app-state.json"),
    workspacesDirectoryPath: path.join(appDataDir, "workspaces"),
  };
}

export function resolveWorkspacePersistencePaths(
  workspaceId: string,
  options: ResolveServiceAppDataDirOptions = {},
): WorkspacePersistencePaths {
  assertSafeWorkspaceId(workspaceId, "workspace id");

  const servicePaths = resolveServicePersistencePaths(options);
  const workspaceDirectoryPath = path.join(servicePaths.workspacesDirectoryPath, workspaceId);

  return {
    workspaceDirectoryPath,
    workspaceStateFilePath: path.join(workspaceDirectoryPath, "workspace.json"),
    artifactsDirectoryPath: path.join(workspaceDirectoryPath, "artifacts"),
    cacheDirectoryPath: path.join(workspaceDirectoryPath, "cache"),
  };
}

export function assertSafeWorkspaceId(workspaceId: string, context: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workspaceId)) {
    throw new WorkspaceIdValidationError(`${context} must be a safe workspace id path segment: ${workspaceId}`);
  }
}
