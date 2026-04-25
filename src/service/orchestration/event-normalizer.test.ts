import { describe, expect, it } from "vitest";
import {
  deriveStatusFromActivityType,
  isMeaningfulObservedActivity,
  normalizeAgentSessionEvent,
} from "./event-normalizer.js";

const context = {
  workspaceId: "ws-1",
  sessionId: "ses-1",
  occurredAt: "2026-04-25T10:00:00.000Z",
};

describe("normalizeAgentSessionEvent", () => {
  it("derives awaiting-input status from assistant questions", () => {
    const normalized = normalizeAgentSessionEvent(context, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Which option should I implement next?" }],
      },
    });

    expect(normalized.activity?.type).toBe("awaiting-input");
    expect(normalized.patch?.status).toBe("awaiting-input");
    expect(normalized.patch?.liveSummary).toContain("Which option");
    expect(deriveStatusFromActivityType(normalized.activity!.type)).toBe("awaiting-input");
  });

  it("derives blocked and done statuses from meaningful assistant summaries", () => {
    const blocked = normalizeAgentSessionEvent(context, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I cannot proceed because the migration file is missing." }],
      },
    });
    const done = normalizeAgentSessionEvent(context, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Implemented the changes and finished the task." }],
      },
    });

    expect(blocked.activity?.type).toBe("blocked");
    expect(blocked.patch?.status).toBe("blocked");
    expect(done.activity?.type).toBe("completed");
    expect(done.patch?.status).toBe("done");
    expect(done.patch?.completedAt).toBe(context.occurredAt);
  });

  it("captures changed-file metadata from pi tool activity", () => {
    const normalized = normalizeAgentSessionEvent(context, {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "edit",
      args: { path: "src/service/orchestration/runtime-manager.ts" },
    });

    expect(normalized.activity).toMatchObject({
      type: "tool-running",
      meaningful: true,
      source: "runtime",
    });
    expect(normalized.patch).toMatchObject({
      status: "running",
      currentTool: "edit",
    });
    expect(normalized.recentFiles).toEqual([{
      path: "src/service/orchestration/runtime-manager.ts",
      operation: "edited",
      timestamp: context.occurredAt,
    }]);
  });

  it("treats streaming and idle churn as non-observing noise", () => {
    const streaming = normalizeAgentSessionEvent(context, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "still thinking" },
    });
    const idle = normalizeAgentSessionEvent(context, { type: "agent_end", messages: [] });

    expect(streaming.activity?.meaningful).toBe(false);
    expect(isMeaningfulObservedActivity(streaming.activity!)).toBe(false);
    expect(idle.activity?.meaningful).toBe(false);
    expect(isMeaningfulObservedActivity(idle.activity!)).toBe(false);
  });

  it("marks runtime tool failures as blocked operator-facing status", () => {
    const normalized = normalizeAgentSessionEvent(context, {
      type: "tool_execution_end",
      toolCallId: "call-2",
      toolName: "bash",
      result: { error: "exit 1" },
      isError: true,
    });

    expect(normalized.activity?.type).toBe("blocked");
    expect(normalized.patch).toMatchObject({
      status: "blocked",
      currentTool: undefined,
      liveSummary: "Tool failed: bash",
    });
  });
});
