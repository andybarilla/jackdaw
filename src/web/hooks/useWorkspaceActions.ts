import React from "react";
import type {
  AbortSessionCommand,
  FollowUpSessionCommand,
  OpenPathCommand,
  PinSummaryCommand,
  ShellFallbackCommand,
  SpawnSessionCommand,
  SteerSessionCommand,
} from "../../shared/domain/commands.js";
import type { MutationResponseDto } from "../../shared/transport/dto.js";

export interface WorkspaceActionResult {
  ok: boolean;
  acceptedAt: string;
  message: string;
  mode: "remote" | "local-fallback";
}

export interface WorkspaceActionHandlers {
  spawnSession(command: SpawnSessionCommand): Promise<WorkspaceActionResult>;
  steerSession(command: SteerSessionCommand): Promise<WorkspaceActionResult>;
  followUpSession(command: FollowUpSessionCommand): Promise<WorkspaceActionResult>;
  abortSession(command: AbortSessionCommand): Promise<WorkspaceActionResult>;
  pinSummary(command: PinSummaryCommand): Promise<WorkspaceActionResult>;
  openPath(command: OpenPathCommand, sessionId?: string): Promise<WorkspaceActionResult>;
  shellFallback(command: ShellFallbackCommand): Promise<WorkspaceActionResult>;
}

export interface WorkspaceActionsState {
  lastResult?: WorkspaceActionResult;
}

function createLocalFallbackResult(actionLabel: string): WorkspaceActionResult {
  return {
    ok: true,
    acceptedAt: new Date().toISOString(),
    message: `${actionLabel} accepted locally while service mutations remain read-only.`,
    mode: "local-fallback",
  };
}

async function getResponseErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string } | { result?: { ok?: boolean; reason?: string } };
    if ("error" in body && typeof body.error === "string") {
      return body.error;
    }
    if ("result" in body && typeof body.result === "object" && body.result !== null && typeof body.result.reason === "string") {
      return body.result.reason;
    }
  } catch {
    // ignored
  }

  return `${fallbackMessage} (${response.status})`;
}

function buildRequestBody<TBody>(body: TBody | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  return JSON.stringify(body);
}

export function useWorkspaceActions(serviceBaseUrl: string): WorkspaceActionHandlers & { state: WorkspaceActionsState } {
  const [state, setState] = React.useState<WorkspaceActionsState>({});

  const runMutation = React.useCallback(async <TBody,>(
    path: string,
    actionLabel: string,
    body?: TBody,
  ): Promise<WorkspaceActionResult> => {
    try {
      const response = await fetch(`${serviceBaseUrl}${path}`, {
        method: "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: buildRequestBody(body),
      });

      if ([404, 405, 501].includes(response.status)) {
        const localFallbackResult = createLocalFallbackResult(actionLabel);
        setState({ lastResult: localFallbackResult });
        return localFallbackResult;
      }

      if (!response.ok) {
        const errorResult: WorkspaceActionResult = {
          ok: false,
          acceptedAt: new Date().toISOString(),
          message: await getResponseErrorMessage(response, `${actionLabel} failed`),
          mode: "remote",
        };
        setState({ lastResult: errorResult });
        return errorResult;
      }

      const payload = (await response.json()) as MutationResponseDto;
      const result: WorkspaceActionResult = payload.result.ok
        ? {
            ok: true,
            acceptedAt: payload.result.acceptedAt,
            message: `${actionLabel} accepted.`,
            mode: "remote",
          }
        : {
            ok: false,
            acceptedAt: new Date().toISOString(),
            message: payload.result.reason,
            mode: "remote",
          };
      setState({ lastResult: result });
      return result;
    } catch (error) {
      const localFallbackResult = createLocalFallbackResult(actionLabel);
      const networkErrorResult: WorkspaceActionResult = {
        ...localFallbackResult,
        message: error instanceof Error
          ? `${localFallbackResult.message} Network error: ${error.message}`
          : localFallbackResult.message,
      };
      setState({ lastResult: networkErrorResult });
      return networkErrorResult;
    }
  }, [serviceBaseUrl]);

  const handlers = React.useMemo<WorkspaceActionHandlers & { state: WorkspaceActionsState }>(() => ({
    state,
    spawnSession: async (command: SpawnSessionCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/workspaces/${command.workspaceId}/sessions`, "Spawn session", command);
    },
    steerSession: async (command: SteerSessionCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/sessions/${command.sessionId}/steer`, "Steer", command);
    },
    followUpSession: async (command: FollowUpSessionCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/sessions/${command.sessionId}/follow-up`, "Follow-up", command);
    },
    abortSession: async (command: AbortSessionCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/sessions/${command.sessionId}/abort`, "Abort", command);
    },
    pinSummary: async (command: PinSummaryCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/sessions/${command.sessionId}/pin-summary`, "Pin summary", command);
    },
    openPath: async (command: OpenPathCommand, sessionId?: string): Promise<WorkspaceActionResult> => {
      if (sessionId === undefined) {
        return runMutation(`/workspaces/${command.workspaceId}/open-path`, "Open path", command);
      }

      return runMutation(`/sessions/${sessionId}/open-path`, "Open path", command);
    },
    shellFallback: async (command: ShellFallbackCommand): Promise<WorkspaceActionResult> => {
      return runMutation(`/sessions/${command.sessionId}/shell`, "Shell fallback", command);
    },
  }), [runMutation, state]);

  return handlers;
}
