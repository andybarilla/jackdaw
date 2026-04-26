import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserEventSource } from "./event-source.js";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

describe("event-source", () => {
  it("opens SSE streams with the renderer service token in an Authorization header", async () => {
    let capturedInit: RequestInit | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>): void {
        controller.enqueue(new TextEncoder().encode("event: workspace.snapshot\ndata: {\"version\":1,\"type\":\"workspace.snapshot\",\"payload\":{}}\n\n"));
        controller.close();
      },
    });
    global.fetch = vi.fn<typeof fetch>(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    createBrowserEventSource("http://127.0.0.1:7345/workspaces/ws-1/events", "renderer-service-token");
    await vi.waitFor(() => {
      expect(capturedInit).toBeDefined();
    });

    expect(capturedInit?.headers).toBeInstanceOf(Headers);
    expect((capturedInit?.headers as Headers).get("Authorization")).toBe("Bearer renderer-service-token");
    expect((capturedInit?.headers as Headers).get("Accept")).toBe("text/event-stream");
  });
});
