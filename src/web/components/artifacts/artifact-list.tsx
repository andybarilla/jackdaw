import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";

export interface ArtifactListProps {
  artifacts: WorkspaceArtifact[];
  selectedArtifactId?: string;
  onSelectArtifact?: (artifactId: string) => void;
}

export function ArtifactList({ artifacts, selectedArtifactId, onSelectArtifact }: ArtifactListProps): React.JSX.Element {
  if (artifacts.length === 0) {
    return <p className="muted">No workspace artifacts found yet.</p>;
  }

  return (
    <ul className="artifact-list" aria-label="Workspace artifacts">
      {artifacts.map((artifact) => (
        <li key={artifact.id}>
          <button
            type="button"
            className={artifact.id === selectedArtifactId ? "artifact-list-item selected" : "artifact-list-item"}
            onClick={() => onSelectArtifact?.(artifact.id)}
          >
            <span className="artifact-kind">{artifact.kind}</span>
            <span className="artifact-title">{artifact.title}</span>
            {artifact.filePath !== undefined && <span className="artifact-path">{artifact.filePath}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
