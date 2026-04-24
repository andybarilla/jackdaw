import React from "react";
import { AppProviders } from "./app/providers.js";
import { AppRoutes } from "./app/routes.js";

export function App(): React.JSX.Element {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
