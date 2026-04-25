import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDetailDto, WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";
import type { ApiClient } from "../../lib/api-client.js";
import { useWorkspaceStream } from "../../hooks/useWorkspaceStream.js";
import { WorkspaceHomeScreen } from "./workspace-home-screen.js";
import type { WorkspaceActionHandlers, WorkspaceActionResult } from "../../hooks/useWorkspaceActions.js";

class FakeEventSource implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
    if (callback === null) {
      return;
    }

    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
    if (callback === null) {
      return;
    }

    this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type) ?? new Set<EventListenerOrEventListenerObject>();
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }

    return true;
  }

  close(): void {
    this.listeners.clear();
  }
}

const WORKSPACE_SUMMARIES = [
  {
    id: "ws-demo",
    name: "Demo Workspace",
    description: "Read-only demo workspace",
    repoRootCount: 2,
    worktreeCount: 1,
    sessionCount: 3,
    attentionBand: "active" as const,
    updatedAt: "2026-04-23T12:00:00.000Z",
  },
];

const WORKSPACE_DETAIL: WorkspaceDetailDto = {
  workspace: {
    id: "ws-demo",
    name: "Demo Workspace",
    description: "Read-only demo workspace",
    repoRoots: [
      { id: "repo-1", path: "/repos/jackdaw", name: "jackdaw", defaultBranch: "main" },
      { id: "repo-2", path: "/repos/hq", name: "hq", defaultBranch: "main" },
    ],
    worktrees: [{ id: "wt-1", repoRootId: "repo-1", path: "/worktrees/jackdaw-live", branch: "feat/live" }],
    sessionIds: ["session-alpha", "session-beta", "session-idle"],
    artifactIds: ["artifact-1"],
    preferences: { selectedSessionId: "session-alpha", attentionView: "all", detailView: "summary" },
    optionalIntegrations: { hqProjectId: "hq-123" },
    createdAt: "2026-04-23T11:00:00.000Z",
    updatedAt: "2026-04-23T12:00:00.000Z",
  },
  sessions: [
    {
      id: "session-alpha",
      workspaceId: "ws-demo",
      name: "Alpha",
      repoRoot: "/repos/jackdaw",
      cwd: "/repos/jackdaw",
      branch: "feat/alpha",
      runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
      status: "running",
      liveSummary: "Alpha is moving.",
      latestMeaningfulUpdate: "Alpha update.",
      currentActivity: "Editing alpha.ts",
      recentFiles: [{ path: "src/alpha.ts", operation: "edited", timestamp: "2026-04-23T11:50:00.000Z" }],
      linkedResources: { artifactIds: ["artifact-1"], workItemIds: ["task-7"], reviewIds: [] },
      connectionState: "live",
      updatedAt: "2026-04-23T11:50:00.000Z",
    },
    {
      id: "session-beta",
      workspaceId: "ws-demo",
      name: "Beta",
      repoRoot: "/repos/hq",
      cwd: "/repos/hq",
      branch: "feat/beta",
      runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
      status: "running",
      liveSummary: "Beta is moving.",
      latestMeaningfulUpdate: "Beta update.",
      currentActivity: "Editing beta.ts",
      recentFiles: [{ path: "src/beta.ts", operation: "edited", timestamp: "2026-04-23T11:52:00.000Z" }],
      linkedResources: { artifactIds: [], workItemIds: ["task-8"], reviewIds: [] },
      connectionState: "live",
      updatedAt: "2026-04-23T11:52:00.000Z",
    },
    {
      id: "session-idle",
      workspaceId: "ws-demo",
      name: "Idle",
      repoRoot: "/repos/jackdaw",
      cwd: "/repos/jackdaw/docs",
      branch: "chore/idle",
      runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
      status: "idle",
      liveSummary: "Idle done.",
      latestMeaningfulUpdate: "Idle done.",
      currentActivity: "Waiting for next task",
      recentFiles: [],
      linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
      connectionState: "historical",
      updatedAt: "2026-04-23T10:45:00.000Z",
      completedAt: "2026-04-23T10:50:00.000Z",
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      workspaceId: "ws-demo",
      kind: "plan",
      title: "Live workspace slice plan",
      filePath: "docs/superpowers/plans/2026-04-23-service-backed-live-workspace.md",
      sourceSessionId: "session-alpha",
      linkedSessionIds: ["session-alpha"],
      linkedWorkItemIds: ["task-7"],
      createdAt: "2026-04-23T11:20:00.000Z",
      updatedAt: "2026-04-23T11:20:00.000Z",
    },
  ],
  recentAttention: [],
};

function createActions(): WorkspaceActionHandlers {
  const result: WorkspaceActionResult = {
    ok: true,
    acceptedAt: "2026-04-23T11:55:00.000Z",
    message: "accepted",
    mode: "remote",
  };

  return {
    spawnSession: vi.fn(async () => result),
    steerSession: vi.fn(async () => result),
    followUpSession: vi.fn(async () => result),
    abortSession: vi.fn(async () => result),
    pinSummary: vi.fn(async () => result),
    openPath: vi.fn(async () => result),
    shellFallback: vi.fn(async () => result),
  };
}

interface HarnessProps {
  apiClient: ApiClient;
  eventSource: FakeEventSource;
}

function WorkspaceHomeHarness({ apiClient, eventSource }: HarnessProps): React.JSX.Element {
  const eventSourceFactory = React.useCallback(() => eventSource, [eventSource]);
  const stream = useWorkspaceStream("ws-demo", apiClient, {
    eventSourceFactory,
  });
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const currentDetail = stream.detail;
    if (currentDetail.status !== "ready") {
      return;
    }

    setSelectedSessionId((currentSelectedSessionId: string | undefined) => {
      return currentDetail.data.sessions.some((session) => session.id === currentSelectedSessionId)
        ? currentSelectedSessionId
        : currentDetail.data.sessions[0]?.id;
    });
  }, [stream.detail]);

  return (
    <WorkspaceHomeScreen
      platform="linux"
      health={{ ok: true, service: "jackdaw-service", version: "0.1.0", appDataDir: "/tmp/jackdaw", timestamp: "2026-04-23T12:00:00.000Z" }}
      workspaceSummaries={{ status: "ready", data: WORKSPACE_SUMMARIES }}
      workspaceDetail={stream.detail}
      selectedWorkspaceId="ws-demo"
      selectedSessionId={selectedSessionId}
      connectionState={stream.connectionState}
      onSelectWorkspace={vi.fn()}
      onSelectSession={setSelectedSessionId}
      actions={createActions()}
    />
  );
}

function createApiClient(): ApiClient {
  return {
    serviceBaseUrl: "http://127.0.0.1:7345",
    getHealth: vi.fn(async () => ({ ok: true, service: "jackdaw-service" as const, version: "0.1.0", appDataDir: "/tmp/jackdaw", timestamp: "2026-04-23T12:00:00.000Z" })),
    listWorkspaces: vi.fn(async () => WORKSPACE_SUMMARIES),
    getWorkspaceDetail: vi.fn(async () => WORKSPACE_DETAIL),
    listWorkspaceArtifacts: vi.fn(async () => ({ workspaceId: "ws-demo", artifacts: WORKSPACE_DETAIL.artifacts })),
    getArtifactDetail: vi.fn(async () => ({ artifact: WORKSPACE_DETAIL.artifacts[0], content: "# Live workspace slice plan", readOnly: true as const })),
    getIntegrationSettings: vi.fn(async () => ({ hq: { status: "configured" as const, linkedIds: { projectId: "hq-123", workItemIds: [], sessionIds: [] } } })),
  };
}

interface Deferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve: ((value: TValue) => void) | undefined;
  const promise = new Promise<TValue>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return {
    promise,
    resolve: (value: TValue) => {
      resolve?.(value);
    },
  };
}

function publishEvent(eventSource: FakeEventSource, event: WorkspaceStreamEventDto): void {
  eventSource.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }));
}

describe("WorkspaceHomeScreen", () => {
  it("renders the home route layout with attention rail, command center preview, and workspace context", async () => {
    const eventSource = new FakeEventSource();
    const apiClient = createApiClient();

    render(<WorkspaceHomeHarness apiClient={apiClient} eventSource={eventSource} />);

    expect(await screen.findByText("What needs me right now?")).toBeVisible();
    expect(screen.getByLabelText("Session command center")).toBeVisible();
    expect(screen.getByLabelText("Workspace context panel")).toBeVisible();
  });

  it("keeps same-band ordering stable during live updates, then re-bands when status changes", async () => {
    const eventSource = new FakeEventSource();
    const apiClient = createApiClient();

    render(<WorkspaceHomeHarness apiClient={apiClient} eventSource={eventSource} />);

    const activeGroup = await screen.findByLabelText("Active sessions");
    const initialButtons = within(activeGroup).getAllByRole("button");
    expect(initialButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Beta"),
    ]);

    act(() => {
      publishEvent(eventSource, {
        version: 1,
        type: "session.summary-updated",
        payload: {
          workspaceId: "ws-demo",
          sessionId: "session-beta",
          liveSummary: "Beta is moving faster now.",
          updatedAt: "2026-04-23T12:05:00.000Z",
        },
      });
    });

    await waitFor(() => {
      const buttons = within(screen.getByLabelText("Active sessions")).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual([
        expect.stringContaining("Alpha"),
        expect.stringContaining("Beta"),
      ]);
    });

    act(() => {
      publishEvent(eventSource, {
        version: 1,
        type: "session.status-changed",
        payload: {
          workspaceId: "ws-demo",
          sessionId: "session-beta",
          status: "awaiting-input",
          changedAt: "2026-04-23T12:06:00.000Z",
        },
      });
    });

    await waitFor(() => {
      const needsOperatorButtons = within(screen.getByLabelText("Needs operator sessions")).getAllByRole("button");
      expect(needsOperatorButtons[0]).toHaveTextContent("Beta");
    });
  });

  it("ignores malformed or unsupported SSE payloads and preserves newer live session state over stale detail refreshes", async () => {
    const eventSource = new FakeEventSource();
    const staleWorkspaceDetailRefresh = createDeferred<WorkspaceDetailDto>();
    const apiClient = {
      ...createApiClient(),
      getWorkspaceDetail: vi.fn()
        .mockResolvedValueOnce(WORKSPACE_DETAIL)
        .mockImplementationOnce(async () => staleWorkspaceDetailRefresh.promise),
    } satisfies ApiClient;

    render(<WorkspaceHomeHarness apiClient={apiClient} eventSource={eventSource} />);

    const liveSummaryPanel = await screen.findByLabelText("Live summary panel");
    expect(within(liveSummaryPanel).getByText("Alpha is moving.")).toBeVisible();

    expect(() => {
      act(() => {
        eventSource.dispatchEvent(new MessageEvent("session.summary-updated", { data: "{" }));
      });
    }).not.toThrow();
    expect(within(screen.getByLabelText("Live summary panel")).getByText("Alpha is moving.")).toBeVisible();

    act(() => {
      eventSource.dispatchEvent(new MessageEvent("session.summary-updated", {
        data: JSON.stringify({
          version: 2,
          type: "session.summary-updated",
          payload: {
            workspaceId: "ws-demo",
            sessionId: "session-alpha",
            liveSummary: "Ignored unsupported event version.",
            updatedAt: "2026-04-23T12:04:00.000Z",
          },
        }),
      }));
    });
    expect(screen.queryByText("Ignored unsupported event version.")).toBeNull();

    act(() => {
      publishEvent(eventSource, {
        version: 1,
        type: "workspace.updated",
        payload: {
          workspaceId: "ws-demo",
          updatedAt: "2026-04-23T12:05:00.000Z",
        },
      });
    });

    act(() => {
      publishEvent(eventSource, {
        version: 1,
        type: "session.summary-updated",
        payload: {
          workspaceId: "ws-demo",
          sessionId: "session-alpha",
          liveSummary: "Alpha is the newest summary.",
          updatedAt: "2026-04-23T12:06:00.000Z",
        },
      });
    });

    expect(await within(await screen.findByLabelText("Live summary panel")).findByText("Alpha is the newest summary.")).toBeVisible();

    act(() => {
      staleWorkspaceDetailRefresh.resolve({
        ...WORKSPACE_DETAIL,
        sessions: WORKSPACE_DETAIL.sessions.map((session) => {
          if (session.id !== "session-alpha") {
            return session;
          }

          return {
            ...session,
            liveSummary: "Alpha stale detail refresh.",
            latestMeaningfulUpdate: "Alpha stale detail refresh.",
            updatedAt: "2026-04-23T12:05:00.000Z",
          };
        }),
      });
    });

    await waitFor(() => {
      expect(within(screen.getByLabelText("Live summary panel")).getByText("Alpha is the newest summary.")).toBeVisible();
    });
    expect(screen.queryByText("Alpha stale detail refresh.")).toBeNull();
  });
});
