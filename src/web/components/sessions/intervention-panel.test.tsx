import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "../../../shared/domain/session.js";
import { InterventionPanel } from "./intervention-panel.js";
import type { AttentionEvent } from "../../../shared/domain/attention.js";
import type { WorkspaceActionHandlers, WorkspaceActionResult } from "../../hooks/useWorkspaceActions.js";

const SESSION: WorkspaceSession = {
  id: "session-1",
  workspaceId: "ws-demo",
  name: "Investigate intervention state",
  repoRoot: "/repos/jackdaw",
  cwd: "/repos/jackdaw",
  branch: "feat/intervention-state",
  runtime: { agent: "pi", model: "sonnet", runtime: "pi" },
  status: "running",
  liveSummary: "Implementing the command center.",
  latestMeaningfulUpdate: "Initial command center rendering landed.",
  currentActivity: "Editing intervention-panel.tsx",
  currentTool: "edit",
  recentFiles: [],
  linkedResources: { artifactIds: [], workItemIds: [], reviewIds: [] },
  connectionState: "live",
  updatedAt: "2026-04-23T11:40:00.000Z",
};

const OBSERVATION_EVENTS: AttentionEvent[] = [
  {
    id: "attention-runtime-observed",
    sessionId: "session-1",
    workspaceId: "ws-demo",
    band: "active",
    title: "Runtime progress",
    detail: "Addressed the steering request in the command center layout.",
    occurredAt: "2026-04-23T11:43:30.000Z",
    source: "runtime",
    meaningful: true,
  },
];

function createResult(message: string, ok = true): WorkspaceActionResult {
  return {
    ok,
    acceptedAt: "2026-04-23T11:41:00.000Z",
    message,
    mode: "remote",
  };
}

function createActions(overrides?: Partial<WorkspaceActionHandlers>): WorkspaceActionHandlers {
  return {
    spawnSession: vi.fn(async () => createResult("spawned")),
    steerSession: vi.fn(async () => createResult("steered")),
    followUpSession: vi.fn(async () => createResult("followed up")),
    abortSession: vi.fn(async () => createResult("aborted")),
    pinSummary: vi.fn(async () => createResult("pinned")),
    openPath: vi.fn(async () => createResult("opened")),
    shellFallback: vi.fn(async () => createResult("shell")),
    ...overrides,
  };
}

function createDeferredResult(): {
  promise: Promise<WorkspaceActionResult>;
  resolve: (result: WorkspaceActionResult) => void;
} {
  let resolvePromise: ((result: WorkspaceActionResult) => void) | undefined;
  const promise = new Promise<WorkspaceActionResult>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (result: WorkspaceActionResult) => {
      resolvePromise?.(result);
    },
  };
}

interface InterventionPanelHarnessProps {
  session: WorkspaceSession;
  actions: WorkspaceActionHandlers;
  onSessionCommit?: () => void;
}

function InterventionPanelHarness({ session, actions, onSessionCommit }: InterventionPanelHarnessProps): React.JSX.Element {
  React.useLayoutEffect(() => {
    onSessionCommit?.();
  }, [onSessionCommit, session.id]);

  return <InterventionPanel session={session} actions={actions} />;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("InterventionPanel", () => {
  it("resets session-scoped draft and intervention state when the session changes", async () => {
    vi.useFakeTimers();
    const actions = createActions();
    const firstSession: WorkspaceSession = {
      ...SESSION,
      lastIntervention: {
        kind: "steer",
        status: "pending-observation",
        text: "Finish the review fixes before lunch.",
        requestedAt: "2026-04-23T11:39:00.000Z",
      },
    };
    const secondSession: WorkspaceSession = {
      ...SESSION,
      id: "session-2",
      name: "Fresh session",
      lastIntervention: undefined,
      updatedAt: "2026-04-23T12:05:00.000Z",
    };
    const { rerender } = render(<InterventionPanel session={firstSession} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "This draft should not leak." },
    });
    fireEvent.change(screen.getByLabelText("Spawn task"), {
      target: { value: "Follow-up task draft" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abort" }));
    });

    expect(screen.getByText("accepted-locally")).toBeVisible();
    expect(screen.getByDisplayValue("This draft should not leak.")).toBeVisible();
    expect(screen.getByDisplayValue("Follow-up task draft")).toBeVisible();

    await act(async () => {
      rerender(<InterventionPanel session={secondSession} actions={actions} />);
    });

    expect(screen.getByText("No intervention recorded yet.")).toBeVisible();
    expect(screen.queryByText("accepted-locally")).toBeNull();
    expect(screen.queryByText("Finish the review fixes before lunch.")).toBeNull();
    expect(screen.getByLabelText("Intervention text")).toHaveValue("");
    expect(screen.getByLabelText("Spawn task")).toHaveValue("");
  });

  it("moves a successful intervention from accepted locally to pending observation to observed after later meaningful non-operator activity", async () => {
    vi.useFakeTimers();
    const actions = createActions();
    const { rerender } = render(<InterventionPanel session={SESSION} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Please tighten the latest copy before merging." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    });

    expect(screen.getByText("accepted-locally")).toBeVisible();
    expect(actions.steerSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      text: "Please tighten the latest copy before merging.",
    });

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("pending-observation")).toBeVisible();

    await act(async () => {
      rerender(
        <InterventionPanel
          session={{
            ...SESSION,
            latestMeaningfulUpdate: "Addressed the steering request in the command center layout.",
            updatedAt: "2026-04-23T11:43:30.000Z",
          }}
          recentAttention={OBSERVATION_EVENTS}
          actions={actions}
        />,
      );
    });

    expect(screen.getByText("observed")).toBeVisible();
  });

  it("does not mark a pending intervention observed after later operator-only activity", async () => {
    vi.useFakeTimers();
    const actions = createActions();
    const operatorOnlyAttention: AttentionEvent[] = [
      {
        id: "attention-operator-later",
        sessionId: "session-1",
        workspaceId: "ws-demo",
        band: "needs-operator",
        title: "Operator reply",
        detail: "Please hold this for release sign-off.",
        occurredAt: "2026-04-23T11:43:30.000Z",
        source: "operator",
        meaningful: true,
      },
    ];
    const { rerender } = render(<InterventionPanel session={SESSION} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Please tighten the latest copy before merging." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    });

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("pending-observation")).toBeVisible();

    await act(async () => {
      rerender(
        <InterventionPanel
          session={{
            ...SESSION,
            latestMeaningfulUpdate: "Operator asked for release sign-off before merging.",
            updatedAt: "2026-04-23T11:43:30.000Z",
          }}
          recentAttention={operatorOnlyAttention}
          actions={actions}
        />,
      );
    });

    expect(screen.getByText("pending-observation")).toBeVisible();
    expect(screen.queryByText("observed")).toBeNull();
  });

  it("surfaces a failed locally state when the action request is rejected", async () => {
    const actions = createActions({
      followUpSession: vi.fn(async () => createResult("Route unavailable", false)),
    });

    render(<InterventionPanel session={SESSION} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Need a final confirmation before shipping." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Follow-up" }));

    expect(await screen.findByText("failed-locally")).toBeVisible();
    expect(screen.getAllByText("Route unavailable")[0]).toBeVisible();
  });

  it("ignores older in-flight intervention completions within the same session", async () => {
    const firstDeferredResult = createDeferredResult();
    const secondDeferredResult = createDeferredResult();
    const actions = createActions({
      steerSession: vi.fn(async () => firstDeferredResult.promise),
      followUpSession: vi.fn(async () => secondDeferredResult.promise),
    });

    render(<InterventionPanel session={SESSION} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Handle the first request." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Use the newer request instead." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Follow-up" }));

    await waitFor(() => {
      expect(actions.steerSession).toHaveBeenCalledTimes(1);
      expect(actions.followUpSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      secondDeferredResult.resolve(createResult("second completion"));
      await secondDeferredResult.promise;
    });

    expect(screen.getByText("accepted-locally")).toBeVisible();
    expect(screen.getByText("follow-up")).toBeVisible();
    expect(screen.getByText("Use the newer request instead.")).toBeVisible();
    expect(screen.getByText("second completion")).toBeVisible();

    await act(async () => {
      firstDeferredResult.resolve(createResult("first completion"));
      await firstDeferredResult.promise;
    });

    expect(screen.queryByText("Handle the first request.")).toBeNull();
    expect(screen.queryByText("first completion")).toBeNull();
    expect(screen.getByText("Use the newer request instead.")).toBeVisible();
  });

  it("ignores stale intervention completions that resolve during the next session commit before passive effects run", async () => {
    const deferredResult = createDeferredResult();
    const actions = createActions({
      steerSession: vi.fn(async () => deferredResult.promise),
    });
    const secondSession: WorkspaceSession = {
      ...SESSION,
      id: "session-2",
      name: "Newly selected session",
      liveSummary: "A different session is selected.",
      updatedAt: "2026-04-23T12:10:00.000Z",
    };
    const { rerender } = render(<InterventionPanelHarness session={SESSION} actions={actions} />);

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Finish the stale request." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() => {
      expect(actions.steerSession).toHaveBeenCalledTimes(1);
    });

    act(() => {
      rerender(
        <InterventionPanelHarness
          session={secondSession}
          actions={actions}
          onSessionCommit={() => {
            queueMicrotask(() => {
              deferredResult.resolve(createResult("stale steer result"));
            });
          }}
        />,
      );
    });

    await act(async () => {
      await deferredResult.promise;
    });

    expect(screen.queryByText("accepted-locally")).toBeNull();
    expect(screen.queryByText("stale steer result")).toBeNull();
    expect(screen.getByText("No intervention recorded yet.")).toBeVisible();
  });

  it("keeps new-session intervention completions live when the next session acts before passive effects run", async () => {
    const firstDeferredResult = createDeferredResult();
    const secondDeferredResult = createDeferredResult();
    const actions = createActions({
      abortSession: vi
        .fn<WorkspaceActionHandlers["abortSession"]>()
        .mockImplementationOnce(async () => firstDeferredResult.promise)
        .mockImplementationOnce(async () => secondDeferredResult.promise),
    });
    const secondSession: WorkspaceSession = {
      ...SESSION,
      id: "session-2",
      name: "Newly selected session",
      liveSummary: "A different session is selected.",
      updatedAt: "2026-04-23T12:10:00.000Z",
    };
    const { rerender } = render(<InterventionPanelHarness session={SESSION} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Abort" }));

    await waitFor(() => {
      expect(actions.abortSession).toHaveBeenCalledTimes(1);
    });

    act(() => {
      rerender(
        <InterventionPanelHarness
          session={secondSession}
          actions={actions}
          onSessionCommit={() => {
            const abortButton = screen.getByRole("button", { name: "Abort" });
            abortButton.click();
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(actions.abortSession).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondDeferredResult.resolve(createResult("current session abort result"));
      await secondDeferredResult.promise;
    });

    expect(screen.getByText("accepted-locally")).toBeVisible();
    expect(screen.getByText("current session abort result")).toBeVisible();

    await act(async () => {
      firstDeferredResult.resolve(createResult("stale abort result"));
      await firstDeferredResult.promise;
    });

    expect(screen.queryByText("stale abort result")).toBeNull();
    expect(screen.getByText("current session abort result")).toBeVisible();
  });

  it("only fires the latest spawn-session callback within the same session", async () => {
    const firstDeferredResult = createDeferredResult();
    const secondDeferredResult = createDeferredResult();
    const onOpenSpawnSession = vi.fn();
    const actions = createActions({
      spawnSession: vi
        .fn<WorkspaceActionHandlers["spawnSession"]>()
        .mockImplementationOnce(async () => firstDeferredResult.promise)
        .mockImplementationOnce(async () => secondDeferredResult.promise),
    });

    render(
      <InterventionPanel
        session={SESSION}
        actions={actions}
        onOpenSpawnSession={onOpenSpawnSession}
      />,
    );

    fireEvent.change(screen.getByLabelText("Spawn task"), {
      target: { value: "First follow-on task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Spawn session" }));

    fireEvent.change(screen.getByLabelText("Spawn task"), {
      target: { value: "Second follow-on task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Spawn session" }));

    await waitFor(() => {
      expect(actions.spawnSession).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondDeferredResult.resolve(createResult("second spawn completion"));
      await secondDeferredResult.promise;
    });

    expect(onOpenSpawnSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("second spawn completion")).toBeVisible();

    await act(async () => {
      firstDeferredResult.resolve(createResult("first spawn completion"));
      await firstDeferredResult.promise;
    });

    expect(onOpenSpawnSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("first spawn completion")).toBeNull();
    expect(screen.getByText("second spawn completion")).toBeVisible();
  });

  it("does not let an older spawn completion overwrite newer steer feedback in the same session", async () => {
    const spawnDeferredResult = createDeferredResult();
    const steerDeferredResult = createDeferredResult();
    const onOpenSpawnSession = vi.fn();
    const actions = createActions({
      spawnSession: vi.fn(async () => spawnDeferredResult.promise),
      steerSession: vi.fn(async () => steerDeferredResult.promise),
    });

    render(
      <InterventionPanel
        session={SESSION}
        actions={actions}
        onOpenSpawnSession={onOpenSpawnSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Spawn session" }));

    await waitFor(() => {
      expect(actions.spawnSession).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("Intervention text"), {
      target: { value: "Use the newer steering request." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() => {
      expect(actions.steerSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      steerDeferredResult.resolve(createResult("newer steer completion"));
      await steerDeferredResult.promise;
    });

    expect(screen.getByText("Use the newer steering request.")).toBeVisible();
    expect(screen.getByText("newer steer completion")).toBeVisible();

    await act(async () => {
      spawnDeferredResult.resolve(createResult("older spawn completion"));
      await spawnDeferredResult.promise;
    });

    expect(onOpenSpawnSession).not.toHaveBeenCalled();
    expect(screen.queryByText("older spawn completion")).toBeNull();
    expect(screen.getByText("newer steer completion")).toBeVisible();
  });

  it("does not fire the spawn-session callback when the backend rejects the request", async () => {
    const onOpenSpawnSession = vi.fn();
    const actions = createActions({
      spawnSession: vi.fn(async () => createResult("Spawn failed", false)),
    });

    render(
      <InterventionPanel
        session={SESSION}
        actions={actions}
        onOpenSpawnSession={onOpenSpawnSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Spawn session" }));

    expect(await screen.findByText("Spawn failed")).toBeVisible();
    expect(onOpenSpawnSession).not.toHaveBeenCalled();
  });
});
