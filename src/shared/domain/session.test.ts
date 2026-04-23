import { describe, expect, it } from "vitest";
import {
  WORKSPACE_SESSION_STATUSES,
  compareSessionStatusPriority,
  isWorkspaceSessionStatus,
  rankWorkspaceSessionStatus,
} from "./session.js";

describe("session domain", () => {
  it("accepts the canonical v1 status set", () => {
    expect(WORKSPACE_SESSION_STATUSES).toEqual([
      "awaiting-input",
      "blocked",
      "failed",
      "running",
      "idle",
      "done",
    ]);
  });

  it("validates session statuses", () => {
    expect(isWorkspaceSessionStatus("awaiting-input")).toBe(true);
    expect(isWorkspaceSessionStatus("running")).toBe(true);
    expect(isWorkspaceSessionStatus("historical")).toBe(false);
    expect(isWorkspaceSessionStatus(undefined)).toBe(false);
  });

  it("ranks operator-needed statuses above active and quiet statuses", () => {
    expect(rankWorkspaceSessionStatus("awaiting-input")).toBeLessThan(rankWorkspaceSessionStatus("running"));
    expect(rankWorkspaceSessionStatus("blocked")).toBeLessThan(rankWorkspaceSessionStatus("idle"));
    expect(rankWorkspaceSessionStatus("failed")).toBeLessThan(rankWorkspaceSessionStatus("done"));
  });

  it("compares statuses by urgency order", () => {
    expect(compareSessionStatusPriority("awaiting-input", "running")).toBeLessThan(0);
    expect(compareSessionStatusPriority("done", "idle")).toBeGreaterThan(0);
    expect(compareSessionStatusPriority("blocked", "blocked")).toBe(0);
  });
});
