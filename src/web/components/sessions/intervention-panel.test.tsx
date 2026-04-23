import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(() => {
  vi.useRealTimers();
});

describe("InterventionPanel", () => {
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
});
