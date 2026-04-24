import { describe, expect, it, vi } from "vitest";
import { createWorkspaceEventBus } from "./event-bus.js";
import type { WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

const WORKSPACE_ID = "ws-1";

function createWorkspaceUpdatedEvent(updatedAt: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "workspace.updated",
    payload: {
      workspaceId: WORKSPACE_ID,
      updatedAt,
    },
  };
}

describe("workspace event bus", () => {
  it("keeps publish best-effort when a listener throws", () => {
    const eventBus = createWorkspaceEventBus();
    const healthyListener = vi.fn();

    eventBus.subscribe(WORKSPACE_ID, () => {
      throw new Error("socket closed");
    });
    eventBus.subscribe(WORKSPACE_ID, healthyListener);

    expect(() => {
      eventBus.publish(WORKSPACE_ID, createWorkspaceUpdatedEvent("2026-04-23T00:00:00.000Z"));
    }).not.toThrow();

    expect(healthyListener).toHaveBeenCalledTimes(1);

    eventBus.publish(WORKSPACE_ID, createWorkspaceUpdatedEvent("2026-04-23T00:00:01.000Z"));

    expect(healthyListener).toHaveBeenCalledTimes(2);
  });

  it("replays retained events after a last seen event id", () => {
    const eventBus = createWorkspaceEventBus();

    eventBus.publish(WORKSPACE_ID, createWorkspaceUpdatedEvent("2026-04-23T00:00:00.000Z"));
    eventBus.publish(WORKSPACE_ID, createWorkspaceUpdatedEvent("2026-04-23T00:00:01.000Z"));
    eventBus.publish(WORKSPACE_ID, createWorkspaceUpdatedEvent("2026-04-23T00:00:02.000Z"));

    expect(eventBus.replaySince(WORKSPACE_ID, "1")?.map((entry) => entry.id)).toEqual(["2", "3"]);
  });
});
