import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import { SummaryPanel } from "./summary-panel.js";

function createSession(overrides: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    id: "session-1",
    workspaceId: "ws-demo",
    name: "Historical session",
    repoRoot: "/repos/jackdaw",
    cwd: "/repos/jackdaw",
    runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
    status: "done",
    liveSummary: "Recovered historical session summary.",
    latestMeaningfulUpdate: "Last meaningful update before restart.",
    currentActivity: "Historical-only session. No live controller is attached.",
    recentFiles: [],
    linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
    connectionState: "historical",
    reconnectNote: "Could not reconnect after restart: session file missing.",
    updatedAt: "2026-04-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("SummaryPanel", () => {
  it("renders the reconnect note for historical-only sessions", () => {
    render(
      <SummaryPanel
        session={createSession()}
        linkedArtifacts={[]}
        onPinSummary={vi.fn()}
        onRefreshSummary={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Historical-only reconnect state")).toBeVisible();
    expect(screen.getByText("Could not reconnect after restart: session file missing.")).toBeVisible();
  });
});
