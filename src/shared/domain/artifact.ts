export const ARTIFACT_KINDS = [
  "spec",
  "plan",
  "decision-memo",
  "review-report",
  "summary-snapshot",
  "changed-files-snapshot",
  "other",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface WorkspaceArtifact {
  id: string;
  workspaceId: string;
  kind: ArtifactKind;
  title: string;
  filePath?: string;
  repoRootId?: string;
  sourceSessionId?: string;
  linkedSessionIds: string[];
  linkedWorkItemIds: string[];
  createdAt: string;
  updatedAt: string;
  hqArtifactId?: string;
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && ARTIFACT_KINDS.includes(value as ArtifactKind);
}
