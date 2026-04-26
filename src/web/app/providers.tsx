import React from "react";
import type { RendererBootstrap } from "../../shared/transport/api.js";
import { createApiClient, resolveBootstrap, type ApiClient } from "../lib/api-client.js";

export interface AppServices {
  bootstrap: RendererBootstrap;
  apiClient: ApiClient;
}

const AppServicesContext = React.createContext<AppServices | undefined>(undefined);

export interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps): React.JSX.Element {
  const services = React.useMemo<AppServices>(() => {
    const bootstrap = resolveBootstrap();
    return {
      bootstrap,
      apiClient: createApiClient({ baseUrl: bootstrap.serviceBaseUrl, serviceToken: bootstrap.serviceToken }),
    };
  }, []);

  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  const services = React.useContext(AppServicesContext);
  if (services === undefined) {
    throw new Error("useAppServices must be used within AppProviders.");
  }

  return services;
}
