import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../server.js";
import { createEmptyServiceState, removeSeededServiceState } from "../../test-helpers.js";
import type { ArtifactDetailDto, ArtifactListDto, WorkspaceDetailDto } from "../../../shared/transport/dto.js";

const tempDirs: string[] = [];
let app: FastifyInstance | undefined;
let appDataDir: string | undefined;

async function createTempRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jackdaw-artifact-routes-"));
  tempDirs.push(directory);
  return directory;
}

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

  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact routes", () => {
  it("opens an indexed file-backed artifact from a workspace repo", async () => {
    const repoPath = await createTempRepo();
    const artifactPath = path.join(repoPath, "docs/superpowers/plans/2026-04-24-route-plan.md");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "# Route plan\n\nSeeded content.", { encoding: "utf8" });

    const server = await createTestServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/workspaces",
      payload: {
        name: "Route Test Workspace",
        repoRoots: [repoPath],
      },
    });
    const createdWorkspace = createResponse.json<WorkspaceDetailDto>();

    const listResponse = await server.inject({
      method: "GET",
      url: `/workspaces/${createdWorkspace.workspace.id}/artifacts`,
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ArtifactListDto>();
    const artifact = listBody.artifacts.find((candidate) => candidate.filePath === "docs/superpowers/plans/2026-04-24-route-plan.md");

    expect(artifact).toBeDefined();

    const response = await server.inject({
      method: "GET",
      url: `/workspaces/${createdWorkspace.workspace.id}/artifacts/${artifact!.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ArtifactDetailDto>()).toEqual(expect.objectContaining({
      artifact: expect.objectContaining({ id: artifact!.id }),
      content: "# Route plan\n\nSeeded content.",
      readOnly: true,
    }));
  });
});
