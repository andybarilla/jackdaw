import { describe, expect, it } from "vitest";
import { normalizeAgentSessionEvent } from "./activity.js";
import { deriveStatus } from "./status.js";

describe("normalizeAgentSessionEvent", () => {
  it("maps tool start to running", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
    });

    expect(normalized.activity?.type).toBe("tool_running");
    expect(deriveStatus(normalized.activity)).toBe("running");
  });

  it("maps tool error to blocked", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: { error: "boom" },
      isError: true,
    });

    expect(normalized.activity?.type).toBe("session_blocked");
    expect(deriveStatus(normalized.activity)).toBe("blocked");
  });

  it("detects assistant questions as awaiting input", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Which option would you like?" }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as never,
    });

    expect(normalized.activity?.type).toBe("awaiting_user");
    expect(deriveStatus(normalized.activity)).toBe("awaiting-input");
  });

  it("tracks edited files from edit tool events", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "tool_execution_start",
      toolCallId: "call-2",
      toolName: "edit",
      args: { path: "src/ui/dashboard.ts" },
    });

    expect(normalized.changedFiles).toEqual(["src/ui/dashboard.ts"]);
    expect(normalized.patch?.summary).toContain("src/ui/dashboard.ts");
  });

  it("detects assistant completion messages as done", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Implemented the requested changes and finished the task." }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as never,
    });

    expect(normalized.activity?.type).toBe("session_completed");
    expect(deriveStatus(normalized.activity)).toBe("done");
  });

  it("detects assistant blocked messages as blocked", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I cannot proceed because the config file is missing." }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as never,
    });

    expect(normalized.activity?.type).toBe("session_blocked");
    expect(deriveStatus(normalized.activity)).toBe("blocked");
  });

  it("clears stale lastError on normal assistant messages", () => {
    const normalized = normalizeAgentSessionEvent("s1", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Based on the roadmap, the next step is to add shell fallback." }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as never,
    });

    expect(normalized.patch?.lastError).toBeUndefined();
    expect(normalized.activity).toBeUndefined();
  });
});
