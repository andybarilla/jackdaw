import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { WorkbenchActivity, WorkbenchActivityOrigin, WorkbenchActivityType, WorkbenchSession } from "../types/workbench.js";

export interface NormalizedWorkbenchEvent {
  activity?: WorkbenchActivity;
  patch?: Partial<WorkbenchSession>;
  changedFiles?: string[];
}

export interface CreateWorkbenchActivityOptions {
  timestamp?: number;
  origin?: WorkbenchActivityOrigin;
  meaningful?: boolean;
}

export function createActivity(
  sessionId: string,
  type: WorkbenchActivityType,
  summary: string,
  options: number | CreateWorkbenchActivityOptions = {},
): WorkbenchActivity {
  const timestamp = typeof options === "number" ? options : (options.timestamp ?? Date.now());
  const origin = typeof options === "number" ? undefined : options.origin;
  const meaningful = typeof options === "number" ? undefined : options.meaningful;

  return {
    id: `${sessionId}:${type}:${timestamp}`,
    sessionId,
    type,
    summary,
    timestamp,
    origin,
    meaningful: meaningful ?? type !== "message_streaming",
  };
}

export function normalizeAgentSessionEvent(sessionId: string, event: AgentSessionEvent): NormalizedWorkbenchEvent {
  switch (event.type) {
    case "agent_start":
      return {
        activity: createActivity(sessionId, "message_streaming", "Agent started working"),
      };

    case "message_update": {
      if (event.assistantMessageEvent.type === "text_delta") {
        const delta = compactWhitespace(event.assistantMessageEvent.delta);
        if (!delta) return {};
        return {
          activity: createActivity(sessionId, "message_streaming", `Assistant: ${delta}`),
          patch: {
            latestText: delta,
            summary: `Assistant: ${delta}`,
          },
        };
      }
      return {};
    }

    case "message_end": {
      const text = assistantTextFromMessage(event.message);
      if (!text) return {};
      const clipped = clip(text);

      if (looksLikeAwaitingUser(text)) {
        return {
          activity: createActivity(sessionId, "awaiting_user", `Awaiting input: ${clipped}`),
          patch: {
            latestText: clipped,
            summary: clipped,
            lastError: undefined,
          },
        };
      }

      if (looksLikeBlocked(text)) {
        return {
          activity: createActivity(sessionId, "session_blocked", `Blocked: ${clipped}`),
          patch: {
            latestText: clipped,
            summary: clipped,
            lastError: clipped,
          },
        };
      }

      if (looksLikeCompleted(text)) {
        return {
          activity: createActivity(sessionId, "session_completed", `Completed: ${clipped}`),
          patch: {
            latestText: clipped,
            summary: clipped,
            lastError: undefined,
          },
        };
      }

      return {
        patch: {
          latestText: clipped,
          summary: clipped,
          lastError: undefined,
        },
      };
    }

    case "tool_execution_start": {
      const target = extractTargetPath(event.toolName, event.args);
      return {
        activity: createActivity(sessionId, "tool_running", target ? `Running ${event.toolName} on ${target}` : `Running ${event.toolName}`),
        patch: {
          currentTool: event.toolName,
          summary: target ? `Running ${event.toolName} on ${target}` : `Running ${event.toolName}`,
        },
        changedFiles: target && (event.toolName === "edit" || event.toolName === "write") ? [target] : undefined,
      };
    }

    case "tool_execution_update":
      return {
        patch: {
          currentTool: event.toolName,
          summary: `Running ${event.toolName}`,
        },
      };

    case "tool_execution_end": {
      const target = extractTargetPath(event.toolName, event.result);
      if (event.isError) {
        return {
          activity: createActivity(sessionId, "session_blocked", `Tool failed: ${event.toolName}`),
          patch: {
            currentTool: undefined,
            lastError: stringifyResult(event.result),
            summary: `Tool failed: ${event.toolName}`,
          },
        };
      }
      return {
        activity: createActivity(sessionId, "tool_finished", target ? `Finished ${event.toolName} on ${target}` : `Finished ${event.toolName}`),
        patch: {
          currentTool: undefined,
          summary: target ? `Finished ${event.toolName} on ${target}` : `Finished ${event.toolName}`,
        },
        changedFiles: target ? [target] : undefined,
      };
    }

    case "agent_end":
      return {
        activity: createActivity(sessionId, "session_idle", "Agent turn completed"),
        patch: {
          currentTool: undefined,
        },
      };

    default:
      return {};
  }
}

function extractTargetPath(toolName: string, source: unknown): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;

  if ((toolName === "edit" || toolName === "write" || toolName === "read") && typeof record.path === "string") {
    return record.path;
  }

  if (toolName === "bash") {
    const output = typeof record.output === "string" ? record.output : typeof record.command === "string" ? record.command : undefined;
    if (!output) return undefined;
    const match = output.match(/[\w./-]+\.[A-Za-z0-9]+/);
    return match?.[0];
  }

  return undefined;
}

function assistantTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") {
    return "";
  }

  const content = "content" in message ? message.content : [];
  if (!Array.isArray(content)) return "";

  return compactWhitespace(
    content
      .filter((item): item is { type: string; text?: string } => !!item && typeof item === "object" && "type" in item)
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join(" "),
  );
}

function looksLikeAwaitingUser(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.includes("?") ||
    lower.includes("let me know") ||
    lower.includes("what would you like") ||
    lower.includes("which option") ||
    lower.includes("please confirm") ||
    lower.includes("please provide") ||
    lower.includes("i need your input") ||
    lower.includes("tell me which")
  );
}

function looksLikeBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "cannot proceed",
    "can't proceed",
    "blocked",
    "fatal:",
    "permission denied",
    "not found",
    "missing",
    "failed to",
    "unable to",
    "requires manual",
    "needs manual",
  ].some((needle) => lower.includes(needle));
}

function looksLikeCompleted(text: string): boolean {
  const lower = text.toLowerCase();
  if (looksLikeAwaitingUser(text) || looksLikeBlocked(text)) return false;

  return [
    "done",
    "completed",
    "finished",
    "implemented",
    "ready for review",
    "ready to merge",
    "all set",
    "wrapped up",
  ].some((needle) => lower.includes(needle));
}

function clip(text: string, limit = 120): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
