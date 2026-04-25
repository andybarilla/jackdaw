import { describe, expect, it, vi } from "vitest";
import { createSessionRuntimeManager } from "./runtime-manager.js";
import type { DemoStateStore } from "../demo-state.js";
import type { WorkspaceEventBus } from "../api/sse/event-bus.js";
import type { MutationResponseDto, WorkspaceStreamEventDto } from "../../shared/transport/dto.js";

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function acceptedResponse(): MutationResponseDto {
  return {
    result: {
      ok: true,
      acceptedAt: "2026-04-25T12:00:00.000Z",
    },
  };
}

function makeEvent(sessionId: string): WorkspaceStreamEventDto {
  return {
    version: 1,
    type: "session.summary-updated",
    payload: {
      workspaceId: "ws-demo",
      sessionId,
      liveSummary: `Updated ${sessionId}`,
      updatedAt: "2026-04-25T12:00:00.000Z",
    },
  };
}

function createEventBus(): WorkspaceEventBus {
  return {
    publish: vi.fn((workspaceId: string, event: WorkspaceStreamEventDto) => ({ id: `${workspaceId}:${event.type}`, event })),
    createTransientEvent: vi.fn((workspaceId: string, event: WorkspaceStreamEventDto) => ({ id: `${workspaceId}:${event.type}`, event })),
    replaySince: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe("SessionRuntimeManager", () => {
  it("serializes mutations for the same session", async () => {
    const firstGate = createDeferred<void>();
    const calls: string[] = [];
    const store = {
      async steerSession() {
        calls.push("first-start");
        await firstGate.promise;
        calls.push("first-end");
        return { response: acceptedResponse(), events: [{ workspaceId: "ws-demo", event: makeEvent("ses-1") }] };
      },
      followUpSession() {
        calls.push("second");
        return { response: acceptedResponse(), events: [{ workspaceId: "ws-demo", event: makeEvent("ses-1") }] };
      },
    } as unknown as DemoStateStore;
    const manager = createSessionRuntimeManager({ store, eventBus: createEventBus() });

    const first = manager.steerSession("ses-1", { sessionId: "ses-1", text: "one" });
    const second = manager.followUpSession("ses-1", { sessionId: "ses-1", text: "two" });

    await flushPromises();
    expect(calls).toEqual(["first-start"]);

    firstGate.resolve();
    await Promise.all([first, second]);

    expect(calls).toEqual(["first-start", "first-end", "second"]);
  });

  it("allows mutations for different sessions to run concurrently", async () => {
    const gate = createDeferred<void>();
    const calls: string[] = [];
    const store = {
      async steerSession(sessionId: string) {
        calls.push(`${sessionId}-start`);
        await gate.promise;
        calls.push(`${sessionId}-end`);
        return { response: acceptedResponse(), events: [{ workspaceId: "ws-demo", event: makeEvent(sessionId) }] };
      },
    } as unknown as DemoStateStore;
    const manager = createSessionRuntimeManager({ store, eventBus: createEventBus() });

    const first = manager.steerSession("ses-1", { sessionId: "ses-1", text: "one" });
    const second = manager.steerSession("ses-2", { sessionId: "ses-2", text: "two" });

    await flushPromises();
    expect(calls).toEqual(["ses-1-start", "ses-2-start"]);

    gate.resolve();
    await Promise.all([first, second]);
  });

  it("surfaces persistence failures without publishing committed events", async () => {
    const eventBus = createEventBus();
    const store = {
      steerSession() {
        throw new Error("disk full");
      },
    } as unknown as DemoStateStore;
    const manager = createSessionRuntimeManager({ store, eventBus });

    const result = await manager.steerSession("ses-1", { sessionId: "ses-1", text: "one" });

    expect(result?.result.ok).toBe(false);
    if (result?.result.ok === false) {
      expect(result.result.reason).toBe("disk full");
      expect(result.result).toMatchObject({ code: "persistence_failed", retryable: true, sessionState: "degraded" });
    }
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it("rejects commands after a session controller is disposed", async () => {
    const eventBus = createEventBus();
    const store = {
      steerSession: vi.fn(),
    } as unknown as DemoStateStore;
    const manager = createSessionRuntimeManager({ store, eventBus });

    manager.disposeSession("ses-1");
    const result = await manager.steerSession("ses-1", { sessionId: "ses-1", text: "one" });

    expect(result?.result.ok).toBe(false);
    if (result?.result.ok === false) {
      expect(result.result).toMatchObject({ code: "controller_disposed", retryable: false });
    }
    expect(store.steerSession).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
