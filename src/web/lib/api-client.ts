import type { HealthResponse, RendererBootstrap } from "../../shared/transport/api.js";
import type { WorkspaceDetailDto, WorkspaceSummaryDto } from "../../shared/transport/dto.js";

declare global {
  interface Window {
    jackdaw?: {
      bootstrap: RendererBootstrap;
    };
  }
}

export interface ApiClient {
  serviceBaseUrl: string;
  getHealth(): Promise<HealthResponse>;
  listWorkspaces(): Promise<WorkspaceSummaryDto[]>;
  getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetailDto>;
}

export function resolveBootstrap(): RendererBootstrap {
  return window.jackdaw?.bootstrap ?? {
    serviceBaseUrl: "http://127.0.0.1:7345",
    appDataDir: "",
    platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux",
  };
}

async function getResponseErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // ignored
  }

  return `${fallbackMessage} (${response.status})`;
}

async function fetchJson<TData>(serviceBaseUrl: string, path: string, fallbackMessage: string): Promise<TData> {
  const response = await fetch(`${serviceBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response, fallbackMessage));
  }

  return (await response.json()) as TData;
}

export function createApiClient(serviceBaseUrl: string): ApiClient {
  return {
    serviceBaseUrl,
    getHealth: async (): Promise<HealthResponse> => {
      return fetchJson<HealthResponse>(serviceBaseUrl, "/health", "Health check failed");
    },
    listWorkspaces: async (): Promise<WorkspaceSummaryDto[]> => {
      return fetchJson<WorkspaceSummaryDto[]>(serviceBaseUrl, "/workspaces", "Workspace fetch failed");
    },
    getWorkspaceDetail: async (workspaceId: string): Promise<WorkspaceDetailDto> => {
      return fetchJson<WorkspaceDetailDto>(serviceBaseUrl, `/workspaces/${workspaceId}`, "Workspace detail fetch failed");
    },
  };
}
