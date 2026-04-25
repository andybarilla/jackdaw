import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceArtifact } from "../../../shared/domain/artifact.js";
import type { ArtifactDetailDto } from "../../../shared/transport/dto.js";
import type { ApiClient } from "../../lib/api-client.js";
import { ArtifactViewerScreen } from "./artifact-viewer-screen.js";

const ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: "artifact-plan",
    workspaceId: "ws-test",
    kind: "plan",
    title: "Workspace context plan",
    filePath: "docs/superpowers/plans/2026-04-24-workspace-context.md",
    linkedSessionIds: ["session-1"],
    linkedWorkItemIds: [],
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
  },
  {
    id: "artifact-spec",
    workspaceId: "ws-test",
    kind: "spec",
    title: "Workspace context design",
    filePath: "docs/superpowers/specs/2026-04-24-workspace-context-design.md",
    linkedSessionIds: [],
    linkedWorkItemIds: [],
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  },
];

function createArtifactDetail(artifact: WorkspaceArtifact): ArtifactDetailDto {
  return {
    artifact,
    content: `# ${artifact.title}\n\nRead-only artifact body.`,
    readOnly: true,
  };
}

function createApiClient(): ApiClient {
  return {
    serviceBaseUrl: "http://127.0.0.1:7345",
    getHealth: vi.fn(),
    listWorkspaces: vi.fn(),
    getWorkspaceDetail: vi.fn(),
    listWorkspaceArtifacts: vi.fn(),
    getArtifactDetail: vi.fn(async (_workspaceId: string, artifactId: string) => {
      const artifact = ARTIFACTS.find((candidate) => candidate.id === artifactId);
      if (artifact === undefined) {
        throw new Error("missing artifact");
      }
      return createArtifactDetail(artifact);
    }),
    getIntegrationSettings: vi.fn(),
  };
}

describe("ArtifactViewerScreen", () => {
  it("loads the selected artifact and presents it read-only", async () => {
    const apiClient = createApiClient();

    render(
      <ArtifactViewerScreen
        apiClient={apiClient}
        workspaceId="ws-test"
        artifacts={ARTIFACTS}
        selectedArtifactId="artifact-plan"
        onSelectArtifact={vi.fn()}
        onBackToSessions={vi.fn()}
      />,
    );

    expect(screen.getByText("Workspace artifacts")).toBeInTheDocument();
    await waitFor(() => expect(apiClient.getArtifactDetail).toHaveBeenCalledWith("ws-test", "artifact-plan"));
    expect(await screen.findByRole("article", { name: "Artifact preview" })).toBeInTheDocument();
    expect(screen.getByText("Read-only plan")).toBeInTheDocument();
    expect(screen.getByText(/# Workspace context plan/)).toBeInTheDocument();
    expect(screen.getByText("read-only")).toBeInTheDocument();
  });

  it("keeps artifact navigation lightweight and delegates selection", async () => {
    const apiClient = createApiClient();
    const onSelectArtifact = vi.fn();
    render(
      <ArtifactViewerScreen
        apiClient={apiClient}
        workspaceId="ws-test"
        artifacts={ARTIFACTS}
        selectedArtifactId="artifact-plan"
        onSelectArtifact={onSelectArtifact}
        onBackToSessions={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /spec Workspace context design/ }));

    expect(onSelectArtifact).toHaveBeenCalledWith("artifact-spec");
  });
});
