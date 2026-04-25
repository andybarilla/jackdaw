import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import type { IntegrationSettingsDto } from "../../../shared/transport/dto.js";

let app: FastifyInstance | undefined;

async function createTestServer(): Promise<FastifyInstance> {
  app = createServer({ appDataDir: "/tmp/jackdaw-test" });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("settings routes", () => {
  it("reports HQ as not configured for the default local app state", async () => {
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
