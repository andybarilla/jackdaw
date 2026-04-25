import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeWorkspacePath,
  canonicalizeWorkspacePathSync,
} from "./workspace-paths.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace path canonicalization", () => {
  it("resolves missing descendants against the deepest existing real ancestor", async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "jackdaw-workspace-paths-"));
    directories.push(tempDirectory);

    const realRepoPath = path.join(tempDirectory, "real", "jackdaw");
    const aliasDirectoryPath = path.join(tempDirectory, "aliases");
    const repoAliasPath = path.join(aliasDirectoryPath, "jackdaw-link");
    await mkdir(realRepoPath, { recursive: true });
    await mkdir(aliasDirectoryPath, { recursive: true });
    await symlink(realRepoPath, repoAliasPath, "dir");

    const missingDescendantPath = path.join(repoAliasPath, ".worktrees", "task-3", "src");
    const expectedCanonicalPath = path.join(await realpath(realRepoPath), ".worktrees", "task-3", "src");

    await expect(canonicalizeWorkspacePath(missingDescendantPath, "missing descendant")).resolves.toBe(expectedCanonicalPath);
    expect(canonicalizeWorkspacePathSync(missingDescendantPath, "missing descendant")).toBe(expectedCanonicalPath);
  });
});
