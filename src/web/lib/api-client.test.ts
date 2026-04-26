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
        appDataDir: "/tmp/jackdaw",
        platform: "linux",
      },
    };

    expect(resolveBootstrap()).toEqual({
      serviceBaseUrl: "https://jackdaw.example.test/runtime",
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
    expect(fetchSpy).toHaveBeenCalledWith("https://control.example.test/jackdaw/health");
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

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:7345/api/workspaces/workspace%2Fa%20b/artifacts/artifact%2Fa%20b");
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
