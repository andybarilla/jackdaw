import React from "react";
import type { WorkspaceSummaryDto } from "../../shared/transport/dto.js";

const WORKSPACE_ROUTE_PATTERN = /^\/workspaces\/([^/]+)\/?$/;

export interface WorkspaceSelectionState {
  routePath: string;
  selectedWorkspaceId?: string;
  selectWorkspace: (workspaceId: string) => void;
}

function getCurrentPath(): string {
  return window.location.pathname || "/";
}

function parseWorkspaceIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(WORKSPACE_ROUTE_PATTERN);
  return match?.[1];
}

export function workspaceHomePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}`;
}

export function useWorkspaceSelection(workspaces: WorkspaceSummaryDto[] | undefined): WorkspaceSelectionState {
  const [routePath, setRoutePath] = React.useState<string>(getCurrentPath());

  React.useEffect(() => {
    const handlePopState = (): void => {
      setRoutePath(getCurrentPath());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const selectedWorkspaceId = React.useMemo<string | undefined>(() => {
    const requestedWorkspaceId = parseWorkspaceIdFromPath(routePath);
    if (requestedWorkspaceId !== undefined && workspaces?.some((workspace) => workspace.id === requestedWorkspaceId) === true) {
      return requestedWorkspaceId;
    }

    return workspaces?.[0]?.id;
  }, [routePath, workspaces]);

  React.useEffect(() => {
    if (selectedWorkspaceId === undefined) {
      return;
    }

    const canonicalPath = workspaceHomePath(selectedWorkspaceId);
    if (routePath === canonicalPath) {
      return;
    }

    window.history.replaceState({}, "", canonicalPath);
    setRoutePath(canonicalPath);
  }, [routePath, selectedWorkspaceId]);

  const selectWorkspace = React.useCallback((workspaceId: string): void => {
    const nextPath = workspaceHomePath(workspaceId);
    if (nextPath === getCurrentPath()) {
      setRoutePath(nextPath);
      return;
    }

    window.history.pushState({}, "", nextPath);
    setRoutePath(nextPath);
  }, []);

  return {
    routePath,
    selectedWorkspaceId,
    selectWorkspace,
  };
}
