import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApiClient,
  createServiceApiConfig,
  DEFAULT_LOCAL_SERVICE_BASE_URL,
  normalizeServiceBaseUrl,
  resolveBootstrap,
} from "./api-client.js";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
  delete window.jackdaw;
});

describe("api-client", () => {
  it("normalizes bootstrap service URLs while preserving the loopback default", () => {
    expect(createServiceApiConfig().baseUrl).toBe(DEFAULT_LOCAL_SERVICE_BASE_URL);
    expect(normalizeServiceBaseUrl(" http://127.0.0.1:7345/ ")).toBe(DEFAULT_LOCAL_SERVICE_BASE_URL);

    window.jackdaw = {
      bootstrap: {
        serviceBaseUrl: "https://jackdaw.example.test/runtime/",
        serviceToken: "renderer-service-token",
        appDataDir: "/tmp/jackdaw",
        platform: "linux",
      },
    };

    expect(resolveBootstrap()).toEqual({
      serviceBaseUrl: "https://jackdaw.example.test/runtime",
      serviceToken: "renderer-service-token",
      appDataDir: "/tmp/jackdaw",
      platform: "linux",
    });
  });

  it("keeps a configurable remote-ready base URL instead of assuming same-origin or same-process service access", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true, service: "jackdaw-service", version: "0.1.0", appDataDir: "/data", timestamp: "now" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient({ baseUrl: "https://control.example.test/jackdaw/" });

    await expect(client.getHealth()).resolves.toMatchObject({ ok: true, service: "jackdaw-service" });

    expect(client.serviceBaseUrl).toBe("https://control.example.test/jackdaw");
    expect(fetchSpy).toHaveBeenCalledWith("https://control.example.test/jackdaw/health", expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it("encodes workspace and artifact identifiers as path segments", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ artifact: { id: "artifact/a b" }, preview: { kind: "text", text: "preview" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient("http://127.0.0.1:7345/api");

    await client.getArtifactDetail("workspace/a b", "artifact/a b");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7345/api/workspaces/workspace%2Fa%20b/artifacts/artifact%2Fa%20b",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("registers workspace worktrees through the explicit workspace API", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ workspace: { id: "workspace/a b", worktrees: [{ id: "wt-1" }] }, sessions: [], artifacts: [], recentAttention: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient("http://127.0.0.1:7345/api");

    await expect(client.addWorkspaceWorktree("workspace/a b", {
      repoRootId: "repo-1",
      path: "/workspace/repo/.worktrees/task-10",
      branch: "task-10",
      label: "Task 10",
    })).resolves.toMatchObject({ workspace: { worktrees: [{ id: "wt-1" }] } });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7345/api/workspaces/workspace%2Fa%20b/worktrees",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        body: JSON.stringify({
          repoRootId: "repo-1",
          path: "/workspace/repo/.worktrees/task-10",
          branch: "task-10",
          label: "Task 10",
        }),
      }),
    );
  });

  it("persists workspace preferences through the workspace update API", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ workspace: { id: "workspace/a b", preferences: { selectedSessionId: "session-2" } }, sessions: [], artifacts: [], recentAttention: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient("http://127.0.0.1:7345/api");

    await expect(client.updateWorkspace("workspace/a b", { preferences: { selectedSessionId: "session-2" } })).resolves.toMatchObject({
      workspace: { preferences: { selectedSessionId: "session-2" } },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7345/api/workspaces/workspace%2Fa%20b",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.any(Headers),
        body: JSON.stringify({ preferences: { selectedSessionId: "session-2" } }),
      }),
    );
  });

  it("attaches the renderer service token to API requests", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient({ baseUrl: "http://127.0.0.1:7345", serviceToken: "renderer-service-token" });

    await client.listWorkspaces();

    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    expect((requestInit?.headers as Headers).get("Authorization")).toBe("Bearer renderer-service-token");
  });

  it("surfaces service error payloads before generic response failures", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchSpy;
    const client = createApiClient("http://127.0.0.1:7345");

    await expect(client.getWorkspaceDetail("missing-workspace")).rejects.toThrow("Workspace not found");
  });

  it("rejects unsupported service URL schemes", () => {
    expect(() => createApiClient("file:///tmp/jackdaw.sock")).toThrow("Service base URL must use http or https");
  });
});
