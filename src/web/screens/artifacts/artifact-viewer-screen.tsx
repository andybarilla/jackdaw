import React from "react";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { ArtifactDetailDto } from "../../../shared/transport/dto.js";
import { ArtifactList } from "../../components/artifacts/artifact-list.js";
import { ArtifactPreview } from "../../components/artifacts/artifact-preview.js";
import type { ApiClient } from "../../lib/api-client.js";

export interface ArtifactViewerScreenProps {
  apiClient: ApiClient;
  workspaceId: string;
  artifacts: WorkspaceArtifact[];
  selectedArtifactId?: string;
  onSelectArtifact: (artifactId: string) => void;
  onBackToSessions: () => void;
}

type ArtifactLoadable =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; detail: ArtifactDetailDto }
  | { status: "error"; message: string };

export function ArtifactViewerScreen(props: ArtifactViewerScreenProps): React.JSX.Element {
  const [detail, setDetail] = React.useState<ArtifactLoadable>({ status: "idle" });
  const selectedArtifactId = props.selectedArtifactId ?? props.artifacts[0]?.id;

  React.useEffect(() => {
    if (selectedArtifactId === undefined) {
      setDetail({ status: "idle" });
      return;
    }

    let cancelled = false;
    setDetail({ status: "loading" });
    void props.apiClient.getArtifactDetail(props.workspaceId, selectedArtifactId)
      .then((artifactDetail) => {
        if (!cancelled) {
          setDetail({ status: "ready", detail: artifactDetail });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.apiClient, props.workspaceId, selectedArtifactId]);

  const preview = detail.status === "ready"
    ? <ArtifactPreview detail={detail.detail} />
    : detail.status === "error"
      ? <ArtifactPreview errorMessage={detail.message} />
      : <ArtifactPreview isLoading={detail.status === "loading"} />;

  return (
    <div className="artifact-viewer-screen" data-route="artifact-viewer-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Artifact viewer</p>
          <h2>Workspace artifacts</h2>
          <p>Specs, plans, decision memos, reviews, and summary snapshots are read-only in v1.</p>
        </div>
        <button type="button" className="secondary-button" onClick={props.onBackToSessions}>Back to sessions</button>
      </header>
      <div className="artifact-viewer-layout">
        <section className="panel artifact-sidebar">
          <ArtifactList artifacts={props.artifacts} selectedArtifactId={selectedArtifactId} onSelectArtifact={props.onSelectArtifact} />
        </section>
        {preview}
      </div>
    </div>
  );
}
