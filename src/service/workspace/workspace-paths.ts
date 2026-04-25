import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";

export class WorkspacePathValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathValidationError";
  }
}

export async function canonicalizeWorkspacePath(filePath: string, context: string): Promise<string> {
  assertSupportedWorkspacePath(filePath, context);

  try {
    return normalizeAbsoluteWorkspacePath(await realpath(filePath));
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return normalizeAbsoluteWorkspacePath(filePath);
    }
    throw error;
  }
}

export function canonicalizeWorkspacePathSync(filePath: string, context: string): string {
  assertSupportedWorkspacePath(filePath, context);

  try {
    return normalizeAbsoluteWorkspacePath(realpathSync(filePath));
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return normalizeAbsoluteWorkspacePath(filePath);
    }
    throw error;
  }
}

export function workspacePathsMatch(leftPath: string, rightPath: string): boolean {
  return canonicalizeWorkspacePathSync(leftPath, "workspace path") === canonicalizeWorkspacePathSync(rightPath, "workspace path");
}

export function normalizeWorkspacePathForComparison(filePath: string): string {
  return canonicalizeWorkspacePathSync(filePath, "workspace path");
}

export function isWorkspacePathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(
    normalizeWorkspacePathForComparison(parentPath),
    normalizeWorkspacePathForComparison(childPath),
  );

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function assertSupportedWorkspacePath(filePath: string, context: string): void {
  if (!path.isAbsolute(filePath)) {
    throw new WorkspacePathValidationError(`${context} must be an absolute path: ${filePath}`);
  }
}

function normalizeAbsoluteWorkspacePath(filePath: string): string {
  const normalizedPath = path.normalize(filePath);
  const rootPath = path.parse(normalizedPath).root;
  if (normalizedPath === rootPath) {
    return normalizedPath;
  }

  return normalizedPath.replace(/[\\/]+$/, "");
}

function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
