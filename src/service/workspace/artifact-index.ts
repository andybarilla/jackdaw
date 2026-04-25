import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactKind, WorkspaceArtifact } from "../../shared/domain/artifact.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { Workspace, WorkspaceRepoRoot } from "../../shared/domain/workspace.js";

const ARTIFACT_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx", ".txt"]);
const ARTIFACT_DIRECTORY_KINDS: ReadonlyArray<{ segment: string; kind: ArtifactKind }> = [
  { segment: "specs", kind: "spec" },
  { segment: "plans", kind: "plan" },
  { segment: "decision-memos", kind: "decision-memo" },
  { segment: "decisions", kind: "decision-memo" },
  { segment: "reviews", kind: "review-report" },
  { segment: "review-reports", kind: "review-report" },
  { segment: "summaries", kind: "summary-snapshot" },
  { segment: "snapshots", kind: "summary-snapshot" },
];

export interface ArtifactIndexInput {
  workspace: Workspace;
  sessions?: WorkspaceSession[];
  existingArtifacts?: WorkspaceArtifact[];
}

export interface IndexedWorkspaceArtifact extends WorkspaceArtifact {
  absolutePath: string;
  repoRootId: string;
}

export interface ArtifactReadResult {
  artifact: IndexedWorkspaceArtifact;
  content: string;
}

function normalizeForId(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function makeArtifactId(workspaceId: string, absolutePath: string): string {
  const digest = createHash("sha1").update(normalizeForId(absolutePath)).digest("hex").slice(0, 16);
  return `artifact-${workspaceId}-${digest}`;
}

function isSkippableFileError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

function findExistingArtifact(existingArtifacts: WorkspaceArtifact[], workspaceId: string, relativePath: string, kind: ArtifactKind): WorkspaceArtifact | undefined {
  const normalizedRelativePath = normalizeForId(relativePath);

  return existingArtifacts.find((artifact) => artifact.workspaceId === workspaceId
    && artifact.filePath !== undefined
    && normalizeForId(artifact.filePath) === normalizedRelativePath
    && artifact.kind === kind);
}

function getArtifactKind(relativePath: string): ArtifactKind | undefined {
  const segments = relativePath.split(path.sep);
  const docsIndex = segments.findIndex((segment) => segment === "docs");
  const relevantSegments = docsIndex >= 0 ? segments.slice(docsIndex) : segments;

  for (const rule of ARTIFACT_DIRECTORY_KINDS) {
    if (relevantSegments.includes(rule.segment)) {
      return rule.kind;
    }
  }

  return undefined;
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleFromContent(content: string, filePath: string): string {
  const heading = content.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
  if (heading === undefined) {
    return titleFromPath(filePath);
  }

  return heading.replace(/^#\s+/, "").trim();
}

async function walkFiles(directory: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(nextPath));
    } else if (entry.isFile() && ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(nextPath);
    }
  }

  return files;
}

function matchesSessionFile(session: WorkspaceSession, repoRoot: WorkspaceRepoRoot, absolutePath: string, relativePath: string): boolean {
  const normalizedAbsolutePath = normalizeForId(path.resolve(absolutePath));
  const normalizedRelativePath = normalizeForId(relativePath);
  const normalizedRepoPath = normalizeForId(path.resolve(repoRoot.path));

  return session.recentFiles.some((recentFile) => {
    const recentPath = recentFile.path;
    if (path.isAbsolute(recentPath)) {
      return normalizeForId(path.resolve(recentPath)) === normalizedAbsolutePath;
    }

    const fromRepoRoot = normalizeForId(path.resolve(repoRoot.path, recentPath));
    const fromSessionCwd = normalizeForId(path.resolve(session.cwd, recentPath));
    return recentPath === normalizedRelativePath
      || fromRepoRoot === normalizedAbsolutePath
      || fromSessionCwd === normalizedAbsolutePath
      || normalizeForId(path.resolve(normalizedRepoPath, recentPath)) === normalizedAbsolutePath;
  });
}

export async function indexWorkspaceArtifacts(input: ArtifactIndexInput): Promise<IndexedWorkspaceArtifact[]> {
  const artifacts: IndexedWorkspaceArtifact[] = [];
  const sessions = input.sessions ?? [];
  const existingArtifacts = input.existingArtifacts ?? [];

  for (const repoRoot of input.workspace.repoRoots) {
    const candidateFiles = await walkFiles(path.join(repoRoot.path, "docs"));

    for (const absolutePath of candidateFiles) {
      const relativePath = path.relative(repoRoot.path, absolutePath);
      const kind = getArtifactKind(relativePath);
      if (kind === undefined) {
        continue;
      }

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      let content: string;
      try {
        [stat, content] = await Promise.all([
          fs.stat(absolutePath),
          fs.readFile(absolutePath, "utf8"),
        ]);
      } catch (error: unknown) {
        if (isSkippableFileError(error)) {
          continue;
        }
        throw error;
      }

      const existingArtifact = findExistingArtifact(existingArtifacts, input.workspace.id, relativePath, kind);
      const discoveredLinkedSessionIds = sessions
        .filter((session) => matchesSessionFile(session, repoRoot, absolutePath, relativePath))
        .map((session) => session.id);
      const linkedSessionIds = Array.from(new Set([
        ...(existingArtifact?.linkedSessionIds ?? []),
        ...discoveredLinkedSessionIds,
      ]));
      const timestamp = stat.mtime.toISOString();

      artifacts.push({
        id: existingArtifact?.id ?? makeArtifactId(input.workspace.id, absolutePath),
        workspaceId: input.workspace.id,
        kind,
        title: existingArtifact?.title ?? titleFromContent(content, absolutePath),
        filePath: normalizeForId(relativePath),
        absolutePath,
        repoRootId: repoRoot.id,
        sourceSessionId: existingArtifact?.sourceSessionId,
        linkedSessionIds,
        linkedWorkItemIds: existingArtifact?.linkedWorkItemIds ?? [],
        createdAt: existingArtifact?.createdAt ?? stat.birthtime.toISOString(),
        updatedAt: timestamp,
      });
    }
  }

  return artifacts.sort((left, right) => {
    const kindCompare = left.kind.localeCompare(right.kind);
    return kindCompare === 0 ? left.title.localeCompare(right.title) : kindCompare;
  });
}

export async function readIndexedArtifact(artifact: IndexedWorkspaceArtifact): Promise<ArtifactReadResult> {
  return {
    artifact,
    content: await fs.readFile(artifact.absolutePath, "utf8"),
  };
}
