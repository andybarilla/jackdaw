import type { FastifyInstance } from "fastify";
import type { DemoStateStore } from "../../demo-state.js";
import type { IntegrationSettingsDto } from "../../../shared/transport/dto.js";

export interface SettingsRoutesOptions {
  store: DemoStateStore;
}

export async function registerSettingsRoutes(app: FastifyInstance, options: SettingsRoutesOptions): Promise<void> {
  app.get("/settings/integrations", async (): Promise<IntegrationSettingsDto> => {
    const workspaces = options.store.listWorkspaces();
    const details = workspaces
      .map((workspace) => options.store.getWorkspaceDetail(workspace.id))
      .filter((detail): detail is NonNullable<typeof detail> => detail !== undefined);
    const projectIds = details
      .map((detail) => detail.workspace.optionalIntegrations?.hqProjectId)
      .filter((projectId): projectId is string => projectId !== undefined && projectId.length > 0);
    const workItemIds = details.flatMap((detail) => detail.sessions.map((session) => session.linkedResources.hqWorkItemId).filter((workItemId): workItemId is string => workItemId !== undefined && workItemId.length > 0));
    const sessionIds = details.flatMap((detail) => detail.sessions.map((session) => session.hqSessionId).filter((sessionId): sessionId is string => sessionId !== undefined && sessionId.length > 0));

    return {
      hq: {
        status: projectIds.length > 0 || workItemIds.length > 0 || sessionIds.length > 0 ? "configured" : "not-configured",
        linkedIds: {
          projectId: projectIds[0],
          workItemIds,
          sessionIds,
        },
      },
    };
  });
}
