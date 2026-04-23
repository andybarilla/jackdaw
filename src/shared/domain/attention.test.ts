import { describe, expect, it } from "vitest";
import {
  attentionBandForStatus,
  compareAttentionCandidates,
  createAttentionCandidate,
} from "./attention.js";
import type { WorkspaceSession } from "./session.js";

function session(status: WorkspaceSession["status"], id: string, updatedAt = "2026-04-23T00:00:00.000Z"): WorkspaceSession {
  return {
    id,
    workspaceId: "ws-1",
    name: id,
    repoRoot: "/repo",
    cwd: "/repo",
    runtime: {},
    status,
    liveSummary: "summary",
    recentFiles: [],
    linkedResources: {
      artifactIds: [],
      workItemIds: [],
      reviewIds: [],
    },
    connectionState: "live",
    updatedAt,
  };
}

describe("attention domain", () => {
  it("maps statuses to attention bands", () => {
    expect(attentionBandForStatus("awaiting-input")).toBe("needs-operator");
    expect(attentionBandForStatus("blocked")).toBe("needs-operator");
    expect(attentionBandForStatus("running")).toBe("active");
    expect(attentionBandForStatus("idle")).toBe("quiet");
    expect(attentionBandForStatus("done")).toBe("quiet");
  });

  it("ranks urgent sessions above running sessions", () => {
    const urgent = createAttentionCandidate(session("awaiting-input", "a"), 3);
    const running = createAttentionCandidate(session("running", "b"), 1);

    expect(compareAttentionCandidates(urgent, running)).toBeLessThan(0);
  });

  it("preserves stable ordering within the same status band", () => {
    const first = createAttentionCandidate(session("running", "first", "2026-04-23T00:00:10.000Z"), 0);
    const second = createAttentionCandidate(session("running", "second", "2026-04-23T00:02:10.000Z"), 1);

    expect(compareAttentionCandidates(first, second)).toBeLessThan(0);
    expect(compareAttentionCandidates(second, first)).toBeGreaterThan(0);
  });
});
