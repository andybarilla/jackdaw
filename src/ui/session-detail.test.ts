import { describe, expect, it } from "vitest";
import type { WorkbenchSession } from "../types/workbench.js";
import { renderSessionDetailLines } from "./session-detail.js";

function session(overrides: Partial<WorkbenchSession>): WorkbenchSession {
  return {
    id: overrides.id ?? "s1",
    name: overrides.name ?? "Session 1",
    cwd: overrides.cwd ?? "/tmp/project",
    model: overrides.model ?? "gpt-5.4",
    taskLabel: overrides.taskLabel ?? "task",
    status: overrides.status ?? "idle",
    tags: overrides.tags ?? [],
    lastUpdateAt: overrides.lastUpdateAt ?? Date.now(),
    summary: overrides.summary ?? "summary",
    pinnedSummary: overrides.pinnedSummary,
    currentTool: overrides.currentTool,
    sessionFile: overrides.sessionFile,
    latestText: overrides.latestText,
    lastError: overrides.lastError,
    recentFiles: overrides.recentFiles,
    connectionState: overrides.connectionState,
    reconnectNote: overrides.reconnectNote,
    lastShellCommand: overrides.lastShellCommand,
    lastShellOutput: overrides.lastShellOutput,
    lastShellExitCode: overrides.lastShellExitCode,
  };
}

describe("renderSessionDetailLines", () => {
  it("shows an actionable empty state when nothing is selected", () => {
    const lines = renderSessionDetailLines(undefined, []);

    expect(lines).toEqual([
      "No session selected.",
      "",
      "Choose a session in the left column.",
      "Press n to start a tracked session.",
      "Use ↑/↓ or j/k to change selection.",
    ]);
  });

  it("shows separate live summary, pinned summary, current activity, and latest update lines", () => {
    const lines = renderSessionDetailLines(
      session({
        status: "running",
        summary: "latest generated summary",
        pinnedSummary: "operator-pinned summary",
        currentTool: "edit",
        latestText: "streaming text still changing",
      }),
      [
        {
          id: "a1",
          sessionId: "s1",
          type: "message_streaming",
          summary: "Assistant: still streaming",
          timestamp: 100,
        },
        {
          id: "a2",
          sessionId: "s1",
          type: "tool_finished",
          summary: "Finished edit on src/ui/session-detail.ts",
          timestamp: 200,
        },
      ],
    );

    expect(lines).toContain("RUNNING · edit");
    expect(lines).toContain("Live summary: latest generated summary");
    expect(lines).toContain("Pinned summary: operator-pinned summary");
    expect(lines).toContain("Current activity: edit");
    expect(lines).toContain("Latest update: Finished edit on src/ui/session-detail.ts");
  });

  it("uses compact status-derived current activity when no tool is running", () => {
    const lines = renderSessionDetailLines(
      session({
        status: "awaiting-input",
        summary: "Need your input on the release plan",
      }),
      [
        {
          id: "a1",
          sessionId: "s1",
          type: "awaiting_user",
          summary: "Awaiting input: Need your input on the release plan",
          timestamp: 200,
        },
      ],
    );

    expect(lines).toContain("AWAITING-INPUT");
    expect(lines).toContain("Current activity: waiting for input");
    expect(lines).toContain("Latest update: Awaiting input: Need your input on the release plan");
  });

  it("ignores plain streaming churn when choosing the latest update", () => {
    const lines = renderSessionDetailLines(
      session({
        status: "running",
        summary: "Applying the final code changes",
        latestText: "delta that should not be trusted as the latest update",
      }),
      [
        {
          id: "a1",
          sessionId: "s1",
          type: "tool_running",
          summary: "Running edit on src/ui/session-detail.ts",
          timestamp: 100,
        },
        {
          id: "a2",
          sessionId: "s1",
          type: "message_streaming",
          summary: "Assistant: adding one more sentence",
          timestamp: 200,
        },
      ],
    );

    expect(lines).toContain("Latest update: Running edit on src/ui/session-detail.ts");
    expect(lines).not.toContain("Latest update: delta that should not be trusted as the latest update");
  });

  it("shows a fallback latest update when only streaming activity exists", () => {
    const lines = renderSessionDetailLines(
      session({
        status: "running",
        summary: "Streaming a response",
        latestText: "Assistant: partial answer",
      }),
      [
        {
          id: "a1",
          sessionId: "s1",
          type: "message_streaming",
          summary: "Assistant: partial answer",
          timestamp: 200,
        },
      ],
    );

    expect(lines).toContain("Latest update: No meaningful update yet");
  });

  it("shows recent files when present", () => {
    const lines = renderSessionDetailLines(
      session({
        recentFiles: ["src/ui/dashboard.ts", "src/orchestration/activity.ts"],
      }),
      [],
    );

    expect(lines.some((line) => line.startsWith("Files: src/ui/dashboard.ts"))).toBe(true);
  });

  it("shows shell fallback preview when present", () => {
    const lines = renderSessionDetailLines(
      session({
        lastShellCommand: "git status --short",
        lastShellOutput: "M src/ui/dashboard.ts\n?? src/ui/dashboard.test.ts",
        lastShellExitCode: 0,
      }),
      [],
    );

    expect(lines).toContain("Shell: git status --short");
    expect(lines).toContain("Shell result: exit 0");
    expect(lines).toContain("Shell output: M src/ui/dashboard.ts ?? src/ui/dashboard.test.ts");
  });

  it("strips terminal control sequences from shell fallback preview", () => {
    const lines = renderSessionDetailLines(
      session({
        lastShellCommand: "git status --short",
        lastShellOutput: "M src/ui/dashboard.ts\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n?? src/ui/dashboard.test.ts\u001b[31m",
        lastShellExitCode: 0,
      }),
      [],
    );

    expect(lines).toContain("Shell output: M src/ui/dashboard.tslink ?? src/ui/dashboard.test.ts");
  });

  it("shows reconnect guidance instead of shell availability for historical sessions", () => {
    const lines = renderSessionDetailLines(
      session({
        connectionState: "historical",
        reconnectNote: "Could not reconnect after restart.",
      }),
      [],
    );

    expect(lines).toContain("Connection: historical");
    expect(lines).toContain("Shell: reconnect first");
  });

  it("shows recent activity entries separately from the latest update line", () => {
    const lines = renderSessionDetailLines(
      session({
        summary: "Completed the dashboard polish",
      }),
      [
        {
          id: "a1",
          sessionId: "s1",
          type: "tool_running",
          summary: "Running edit on src/ui/dashboard.ts",
          timestamp: 100,
        },
        {
          id: "a2",
          sessionId: "s1",
          type: "tool_finished",
          summary: "Finished edit on src/ui/dashboard.ts",
          timestamp: 200,
        },
      ],
    );

    expect(lines).toContain("Recent activity:");
    expect(lines).toContain("- Finished edit on src/ui/dashboard.ts");
    expect(lines).toContain("- Running edit on src/ui/dashboard.ts");
  });

  it("shows transcript preview when provided", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["User: Please inspect the repo", "Assistant: I found two issues to fix"],
    );

    expect(lines).toContain("Transcript preview:");
    expect(lines).toContain("- User: Please inspect the repo");
  });

  it("strips terminal control sequences from transcript rendering", () => {
    const lines = renderSessionDetailLines(session({}), [], ["Assistant: ok\u001b[31m now\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007"], "transcript");

    expect(lines).toContain("- Assistant: ok nowlink");
  });

  it("shows transcript window in transcript mode", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["User: one", "Assistant: two", "User: three"],
      "transcript",
      1,
      2,
    );

    expect(lines).toContain("Transcript (3 lines, showing 2-3 • ↑ more above • ↓ end)");
    expect(lines).toContain("- Assistant: two");
    expect(lines).toContain("- User: three");
  });

  it("wraps long transcript lines instead of clipping them", () => {
    const lines = renderSessionDetailLines(
      session({}),
      [],
      ["Assistant: This is a much longer line that should wrap across multiple visual rows in transcript mode"],
      "transcript",
      0,
      5,
      24,
    );

    expect(lines.some((line) => line === "- Assistant: This is a")).toBe(true);
    expect(lines.some((line) => line.includes("should wrap across"))).toBe(true);
  });

  it("shows when scrolling is not needed", () => {
    const lines = renderSessionDetailLines(session({}), [], ["User: one"], "log", 0, 8);
    expect(lines).toContain("Log (1 lines, showing 1-1 • no scrolling needed)");
  });
});
