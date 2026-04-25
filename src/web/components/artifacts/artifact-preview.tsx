import React from "react";
import type { ArtifactDetailDto } from "../../../shared/transport/dto.js";

export interface ArtifactPreviewProps {
  detail?: ArtifactDetailDto;
  isLoading?: boolean;
  errorMessage?: string;
}

export function ArtifactPreview({ detail, isLoading = false, errorMessage }: ArtifactPreviewProps): React.JSX.Element {
  if (isLoading) {
    return <section className="panel artifact-preview"><p>Loading artifact…</p></section>;
  }

  if (errorMessage !== undefined) {
    return <section className="panel artifact-preview" role="alert"><p>{errorMessage}</p></section>;
  }

  if (detail === undefined) {
    return <section className="panel artifact-preview"><p>Select an artifact to preview it read-only.</p></section>;
  }

  return (
    <article className="panel artifact-preview" aria-label="Artifact preview">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Read-only {detail.artifact.kind}</p>
          <h2>{detail.artifact.title}</h2>
        </div>
        <span className="status-pill">read-only</span>
      </div>
      {detail.artifact.filePath !== undefined && <p className="artifact-path">{detail.artifact.filePath}</p>}
      <pre className="artifact-content">{detail.content}</pre>
    </article>
  );
}
