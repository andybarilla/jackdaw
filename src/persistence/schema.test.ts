import { describe, expect, it } from "vitest";
import { parsePersistedWorkbenchState } from "./schema.js";
import type { PersistedWorkbenchState } from "./schema.js";

const validState: PersistedWorkbenchState = {
  version: 1,
  sessions: [
    {
      id: "session-1",
      name: "Session 1",
      cwd: "/repo",
      model: "gpt-5.4",
      taskLabel: "task",
      status: "idle",
      tags: ["alpha"],
      lastUpdateAt: 123,
      summary: "summary",
      recentFiles: ["src/index.ts"],
      connectionState: "historical",
      reconnectNote: "Could not reconnect after restart.",
      lastShellCommand: "pwd",
      lastShellExitCode: 0,
      lastIntervention: {
        kind: "steer",
        text: "Keep the scope tight",
        status: "pending-observation",
        requestedAt: 789,
        summary: "Steer",
      },
    },
  ],
  selectedSessionId: "session-1",
  lastOpenedAt: 456,
  preferences: {
    detailViewMode: "summary",
  },
};

describe("parsePersistedWorkbenchState", () => {
  it("parses valid persisted state", () => {
    expect(parsePersistedWorkbenchState(validState)).toEqual(validState);
  });

  it("rejects persisted state with an invalid session record", () => {
    expect(() =>
      parsePersistedWorkbenchState({
        ...validState,
        sessions: [
          validState.sessions[0],
          {
            id: "session-2",
            name: "Broken Session",
          },
        ],
      }),
    ).toThrow(/session/i);
  });

  it.each([
    ["tags", { tags: ["alpha", 7] }],
    ["recentFiles", { recentFiles: ["src/index.ts", 7] }],
    ["connectionState", { connectionState: "offline" }],
    ["reconnectNote", { reconnectNote: 7 }],
    ["lastShellCommand", { lastShellCommand: 7 }],
    ["lastShellExitCode", { lastShellExitCode: "oops" }],
    ["lastIntervention", { lastIntervention: { kind: "steer" } }],
  ])("rejects persisted state with malformed session %s", (_fieldName, sessionPatch) => {
    expect(() =>
      parsePersistedWorkbenchState({
        ...validState,
        sessions: [
          {
            ...validState.sessions[0],
            ...sessionPatch,
          },
        ],
      }),
    ).toThrow(/session/i);
  });

  it("drops legacy persisted shell output while keeping command metadata", () => {
    const session = parsePersistedWorkbenchState({
      ...validState,
      sessions: [
        {
          ...validState.sessions[0],
          lastShellOutput: "/repo",
        },
      ],
    }).sessions[0];

    expect(session).toMatchObject({
      lastShellCommand: "pwd",
      lastShellExitCode: 0,
    });
    expect(session).not.toHaveProperty("lastShellOutput");
  });


  it("rejects persisted state with an invalid detail view mode", () => {
    expect(() =>
      parsePersistedWorkbenchState({
        ...validState,
        preferences: {
          detailViewMode: "grid",
        },
      }),
    ).toThrow(/detailViewMode/i);
  });
});
