import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceActions } from "./useWorkspaceActions.js";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

describe("useWorkspaceActions", () => {
  it("rejects openPath calls without a session context instead of posting to a missing workspace route", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useWorkspaceActions("http://127.0.0.1:4312"));

    let actionResult: Awaited<ReturnType<typeof result.current.openPath>> | undefined;
    await act(async () => {
      actionResult = await result.current.openPath({ workspaceId: "ws-demo", path: "docs/task-8.md" });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(actionResult).toMatchObject({
      ok: false,
      mode: "remote",
      message: "Open path requires a session context.",
    });
    await waitFor(() => {
      expect(result.current.state.lastResult).toMatchObject({
        ok: false,
        mode: "remote",
        message: "Open path requires a session context.",
      });
    });
  });

  it("returns an unavailable result when the openPath route is missing", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ error: "Mutation route unavailable" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useWorkspaceActions("http://127.0.0.1:4312"));

    let actionResult: Awaited<ReturnType<typeof result.current.openPath>> | undefined;
    await act(async () => {
      actionResult = await result.current.openPath({ workspaceId: "ws-demo", path: "docs/task-8.md" }, "session-1");
    });

    expect(actionResult).toMatchObject({
      ok: false,
      mode: "unavailable",
      message: "Mutation route unavailable",
    });
    await waitFor(() => {
      expect(result.current.state.lastResult).toMatchObject({
        ok: false,
        mode: "unavailable",
        message: "Mutation route unavailable",
      });
    });
  });

  it("returns an unavailable result when the service request fails", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useWorkspaceActions("http://127.0.0.1:4312"));

    let actionResult: Awaited<ReturnType<typeof result.current.openPath>> | undefined;
    await act(async () => {
      actionResult = await result.current.openPath({ workspaceId: "ws-demo", path: "docs/task-8.md" }, "session-1");
    });

    expect(actionResult).toMatchObject({
      ok: false,
      mode: "unavailable",
      message: "Open path unavailable. Network error: connect ECONNREFUSED",
    });
    await waitFor(() => {
      expect(result.current.state.lastResult).toMatchObject({
        ok: false,
        mode: "unavailable",
        message: "Open path unavailable. Network error: connect ECONNREFUSED",
      });
    });
  });

  it("posts openPath requests to the session route when a session context is provided", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({
        result: {
          ok: true,
          acceptedAt: "2026-04-23T12:00:00.000Z",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useWorkspaceActions("http://127.0.0.1:4312"));

    await act(async () => {
      await result.current.openPath({ workspaceId: "ws-demo", path: "docs/task-8.md" }, "session-1");
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:4312/sessions/session-1/open-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-demo", path: "docs/task-8.md" }),
    });
  });
});
