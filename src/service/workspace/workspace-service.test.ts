import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../shared/domain/commands.js";
import type { WorkspaceSession } from "../../shared/domain/session.js";
import type { RuntimeManager } from "../orchestration/runtime-manager.js";
import {
  createSeededServiceState,
  removeSeededServiceState,
  TEST_AWAITING_INPUT_SESSION_ID,
  TEST_WORKSPACE_ID,
} from "../test-helpers.js";
import { WorkspaceService, type WorkspaceMutationEvent } from "./workspace-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath: string) => removeSeededServiceState(directoryPath)));
});

async function createSeededWorkspaceService(): Promise<WorkspaceService> {
  const serviceState = await createSeededServiceState();
  temporaryDirectories.push(serviceState.appDataDir);
  return await WorkspaceService.load({ appDataDir: serviceState.appDataDir });
}

function requireSession(service: WorkspaceService, sessionId: string): WorkspaceSession {
  const session = service
    .getRuntimeRegistry()
    .getWorkspaceDetail(TEST_WORKSPACE_ID)
    ?.sessions.find((candidate: WorkspaceSession) => candidate.id === sessionId);
  if (session === undefined) {
    throw new Error(`Missing test session: ${sessionId}`);
  }

  return session;
}

describe("WorkspaceService session command failures", () => {
  it("emits intervention events from the fresh persisted rejection state", async () => {
    const service = await createSeededWorkspaceService();
    const registry = service.getRuntimeRegistry();
    const runtimeManager = {
      steerSession: vi.fn(async (): Promise<CommandResult> => {
        const session = requireSession(service, TEST_AWAITING_INPUT_SESSION_ID);
        await registry.upsertSession({
          ...session,
          lastIntervention: {
            kind: "steer",
            status: "failed-locally",
            text: "Try another approach.",
            requestedAt: "2026-04-25T10:00:00.000Z",
            errorMessage: "Session is historical and cannot be controlled.",
          },
          updatedAt: "2026-04-25T10:00:00.000Z",
        });

        return {
          ok: false,
          reason: "Session is historical and cannot be controlled.",
        };
      }),
    } as unknown as RuntimeManager;
    service.setRuntimeManager(runtimeManager);

    const mutation = await service.steerSession(TEST_AWAITING_INPUT_SESSION_ID, {
      sessionId: TEST_AWAITING_INPUT_SESSION_ID,
      text: "Try another approach.",
    });

    const interventionEvent = mutation?.events.find(
      (candidate: WorkspaceMutationEvent): boolean => candidate.event.type === "session.intervention-changed",
    );
    expect(interventionEvent?.event.payload).toMatchObject({
      sessionId: TEST_AWAITING_INPUT_SESSION_ID,
      intervention: {
        kind: "steer",
        status: "failed-locally",
        text: "Try another approach.",
        errorMessage: "Session is historical and cannot be controlled.",
      },
    });
  });

  it("emits status and summary events from the fresh shell fallback rejection state", async () => {
    const service = await createSeededWorkspaceService();
    const registry = service.getRuntimeRegistry();
    const runtimeManager = {
      runShellFallback: vi.fn(async (): Promise<CommandResult> => {
        const session = requireSession(service, TEST_AWAITING_INPUT_SESSION_ID);
        await registry.upsertSession({
          ...session,
          status: "failed",
          currentActivity: "Shell fallback failed: command unavailable",
          liveSummary: "Shell fallback failed: npm test",
          latestMeaningfulUpdate: "command unavailable",
          updatedAt: "2026-04-25T10:05:00.000Z",
        });

        return {
          ok: false,
          reason: "command unavailable",
        };
      }),
    } as unknown as RuntimeManager;
    service.setRuntimeManager(runtimeManager);

    const mutation = await service.runSessionShell(TEST_AWAITING_INPUT_SESSION_ID, "npm test");

    const statusEvent = mutation?.events.find(
      (candidate: WorkspaceMutationEvent): boolean => candidate.event.type === "session.status-changed",
    );
    const summaryEvent = mutation?.events.find(
      (candidate: WorkspaceMutationEvent): boolean => candidate.event.type === "session.summary-updated",
    );
    expect(statusEvent?.event.payload).toMatchObject({
      sessionId: TEST_AWAITING_INPUT_SESSION_ID,
      status: "failed",
    });
    expect(summaryEvent?.event.payload).toMatchObject({
      sessionId: TEST_AWAITING_INPUT_SESSION_ID,
      liveSummary: "Shell fallback failed: npm test",
    });
  });
});
