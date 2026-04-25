import { describe, expect, it } from "vitest";
import { createSessionController } from "./session-controller.js";

describe("SessionController lifecycle", () => {
  it("accepts commands while live and rejects them after idempotent disposal", () => {
    const controller = createSessionController("ses-1", 7);

    controller.markLive();
    expect(controller.lifecycle).toBe("live");
    expect(controller.acceptsCommands()).toBe(true);

    controller.dispose();
    controller.dispose();

    expect(controller.lifecycle).toBe("disposed");
    expect(controller.acceptsCommands()).toBe(false);
  });

  it("ignores stale generation events", () => {
    const controller = createSessionController("ses-1", 2);
    controller.markLive();

    expect(controller.acceptsEvent({ sessionId: "ses-1", generation: 2, payload: { status: "running" } })).toBe(true);
    expect(controller.acceptsEvent({ sessionId: "ses-1", generation: 1, payload: { status: "failed" } })).toBe(false);
    expect(controller.acceptsEvent({ sessionId: "ses-other", generation: 2, payload: { status: "failed" } })).toBe(false);
  });

  it("does not let late lifecycle transitions revive a disposed controller", () => {
    const controller = createSessionController("ses-1", 1);

    controller.dispose();
    controller.markLive();
    controller.markReconnecting();
    controller.markFailed();

    expect(controller.lifecycle).toBe("disposed");
    expect(controller.acceptsEvent({ sessionId: "ses-1", generation: 1, payload: {} })).toBe(false);
  });
});
