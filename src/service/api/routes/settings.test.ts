import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import { createEmptyServiceState, removeSeededServiceState } from "../../test-helpers.js";
import type { IntegrationSettingsDto } from "../../../shared/transport/dto.js";

let app: FastifyInstance | undefined;
let appDataDir: string | undefined;

async function createTestServer(): Promise<FastifyInstance> {
  const serviceState = await createEmptyServiceState();
  appDataDir = serviceState.appDataDir;
  app = createServer({ appDataDir });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }

  if (appDataDir !== undefined) {
    await removeSeededServiceState(appDataDir);
    appDataDir = undefined;
  }
});

describe("settings routes", () => {
  it("reports HQ as not configured for an empty local app state", async () => {
    const server = await createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/settings/integrations",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<IntegrationSettingsDto>();

    expect(body.hq.status).toBe("not-configured");
    expect(body.hq.linkedIds).toEqual({
      workItemIds: [],
      sessionIds: [],
    });
  });
});
