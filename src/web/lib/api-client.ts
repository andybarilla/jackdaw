import type { HealthResponse, RendererBootstrap } from "../../shared/transport/api.js";
import type {
  AddWorkspaceWorktreeDto,
  ArtifactDetailDto,
  ArtifactListDto,
  IntegrationSettingsDto,
  UpdateWorkspaceDto,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from "../../shared/transport/dto.js";

declare global {
  interface Window {
    jackdaw?: {
      bootstrap: RendererBootstrap;
    };
  }
}

export const DEFAULT_LOCAL_SERVICE_BASE_URL = "http://127.0.0.1:7345";

export interface ServiceApiConfig {
  baseUrl: string;
  serviceToken?: string;
}

export interface ApiClient {
  serviceBaseUrl: string;
  serviceToken?: string;
  getHealth(): Promise<HealthResponse>;
  listWorkspaces(): Promise<WorkspaceSummaryDto[]>;
  getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetailDto>;
  updateWorkspace(workspaceId: string, update: UpdateWorkspaceDto): Promise<WorkspaceDetailDto>;
  addWorkspaceWorktree(workspaceId: string, worktree: AddWorkspaceWorktreeDto): Promise<WorkspaceDetailDto>;
  listWorkspaceArtifacts(workspaceId: string): Promise<ArtifactListDto>;
  getArtifactDetail(workspaceId: string, artifactId: string): Promise<ArtifactDetailDto>;
  getIntegrationSettings(): Promise<IntegrationSettingsDto>;
}

export function normalizeServiceBaseUrl(serviceBaseUrl: string): string {
  const trimmedBaseUrl = serviceBaseUrl.trim();
  if (trimmedBaseUrl.length === 0) {
    throw new Error("Service base URL must not be empty.");
  }

  const url = new URL(trimmedBaseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Service base URL must use http or https: ${serviceBaseUrl}`);
  }

  url.hash = "";
  url.search = "";
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function createServiceApiConfig(serviceBaseUrl: string = DEFAULT_LOCAL_SERVICE_BASE_URL, serviceToken?: string): ServiceApiConfig {
  return {
    baseUrl: normalizeServiceBaseUrl(serviceBaseUrl),
    serviceToken: serviceToken === undefined || serviceToken.length === 0 ? undefined : serviceToken,
  };
}

export function resolveBootstrap(): RendererBootstrap {
  const bootstrap = window.jackdaw?.bootstrap ?? {
    serviceBaseUrl: DEFAULT_LOCAL_SERVICE_BASE_URL,
    serviceToken: "",
    appDataDir: "",
    platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux",
  };

  return {
    ...bootstrap,
    serviceBaseUrl: normalizeServiceBaseUrl(bootstrap.serviceBaseUrl),
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

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function createServiceUrl(config: ServiceApiConfig, apiPath: string): string {
  const url = new URL(config.baseUrl);
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const endpointPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  url.pathname = `${basePath}${endpointPath}`;
  return url.toString();
}

function createAuthorizedRequestInit(config: ServiceApiConfig, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (config.serviceToken !== undefined) {
    headers.set("Authorization", `Bearer ${config.serviceToken}`);
  }

  return {
    ...init,
    headers,
  };
}

async function fetchJson<TData>(config: ServiceApiConfig, path: string, fallbackMessage: string, init?: RequestInit): Promise<TData> {
  const url = createServiceUrl(config, path);
  const response = await fetch(url, createAuthorizedRequestInit(config, init));
  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response, fallbackMessage));
  }

  return (await response.json()) as TData;
}

function resolveApiConfig(configOrBaseUrl: string | ServiceApiConfig): ServiceApiConfig {
  return typeof configOrBaseUrl === "string" ? createServiceApiConfig(configOrBaseUrl) : createServiceApiConfig(configOrBaseUrl.baseUrl, configOrBaseUrl.serviceToken);
}

export function createApiClient(configOrBaseUrl: string | ServiceApiConfig): ApiClient {
  const config = resolveApiConfig(configOrBaseUrl);

  return {
    serviceBaseUrl: config.baseUrl,
    serviceToken: config.serviceToken,
    getHealth: async (): Promise<HealthResponse> => {
      return fetchJson<HealthResponse>(config, "/health", "Health check failed");
    },
    listWorkspaces: async (): Promise<WorkspaceSummaryDto[]> => {
      return fetchJson<WorkspaceSummaryDto[]>(config, "/workspaces", "Workspace fetch failed");
    },
    getWorkspaceDetail: async (workspaceId: string): Promise<WorkspaceDetailDto> => {
      return fetchJson<WorkspaceDetailDto>(config, `/workspaces/${encodePathSegment(workspaceId)}`, "Workspace detail fetch failed");
    },
    updateWorkspace: async (workspaceId: string, update: UpdateWorkspaceDto): Promise<WorkspaceDetailDto> => {
      return fetchJson<WorkspaceDetailDto>(
        config,
        `/workspaces/${encodePathSegment(workspaceId)}`,
        "Workspace update failed",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        },
      );
    },
    addWorkspaceWorktree: async (workspaceId: string, worktree: AddWorkspaceWorktreeDto): Promise<WorkspaceDetailDto> => {
      return fetchJson<WorkspaceDetailDto>(
        config,
        `/workspaces/${encodePathSegment(workspaceId)}/worktrees`,
        "Worktree registration failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(worktree),
        },
      );
    },
    listWorkspaceArtifacts: async (workspaceId: string): Promise<ArtifactListDto> => {
      return fetchJson<ArtifactListDto>(config, `/workspaces/${encodePathSegment(workspaceId)}/artifacts`, "Artifact index fetch failed");
    },
    getArtifactDetail: async (workspaceId: string, artifactId: string): Promise<ArtifactDetailDto> => {
      return fetchJson<ArtifactDetailDto>(
        config,
        `/workspaces/${encodePathSegment(workspaceId)}/artifacts/${encodePathSegment(artifactId)}`,
        "Artifact fetch failed",
      );
    },
    getIntegrationSettings: async (): Promise<IntegrationSettingsDto> => {
      return fetchJson<IntegrationSettingsDto>(config, "/settings/integrations", "Settings fetch failed");
    },
  };
}
