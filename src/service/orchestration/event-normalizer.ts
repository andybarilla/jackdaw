import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type {
  SessionRecentFile,
  WorkspaceSession,
  WorkspaceSessionStatus,
} from "../../shared/domain/session.js";

export const NORMALIZED_SESSION_ACTIVITY_TYPES = [
  "agent-started",
  "message-streaming",
  "assistant-update",
  "tool-running",
  "tool-finished",
  "awaiting-input",
  "blocked",
  "failed",
  "completed",
  "idle",
  "compaction",
  "retrying",
] as const;

export type NormalizedSessionActivityType = (typeof NORMALIZED_SESSION_ACTIVITY_TYPES)[number];

export interface NormalizeSessionEventContext {
  workspaceId: string;
  sessionId: string;
  occurredAt?: string;
}

export interface NormalizedSessionActivity {
  id: string;
  workspaceId: string;
  sessionId: string;
  type: NormalizedSessionActivityType;
  summary: string;
  occurredAt: string;
  source: "runtime" | "operator" | "system";
  meaningful: boolean;
}

export interface NormalizedSessionPatch {
  status?: WorkspaceSessionStatus;
  liveSummary?: string;
  latestMeaningfulUpdate?: string;
  currentActivity?: string;
  currentTool?: string;
  completedAt?: string;
}

export interface NormalizedSessionEvent {
  activity?: NormalizedSessionActivity;
  patch?: NormalizedSessionPatch;
  recentFiles?: SessionRecentFile[];
}

export interface PiSessionHistoryEntry {
  type?: unknown;
  timestamp?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

export function normalizeAgentSessionEvent(
  context: NormalizeSessionEventContext,
  event: AgentSessionEvent | unknown,
): NormalizedSessionEvent {
  const occurredAt = context.occurredAt ?? new Date().toISOString();
  const eventType = readEventType(event);

  switch (eventType) {
    case "agent_start":
      return {
        activity: createActivity(context, "agent-started", "Agent started working", occurredAt, false),
        patch: {
          status: "running",
          currentActivity: "Agent started working",
        },
      };

    case "message_update":
      return normalizeMessageUpdate(context, event, occurredAt);

    case "message_end":
      return normalizeMessageEnd(context, event, occurredAt);

    case "tool_execution_start":
      return normalizeToolExecutionStart(context, event, occurredAt);

    case "tool_execution_update":
      return normalizeToolExecutionUpdate(context, event, occurredAt);

    case "tool_execution_end":
      return normalizeToolExecutionEnd(context, event, occurredAt);

    case "agent_end":
      return {
        activity: createActivity(context, "idle", "Agent turn completed", occurredAt, false),
        patch: {
          status: "idle",
          currentTool: undefined,
          currentActivity: "Agent turn completed",
        },
      };

    case "compaction_start":
      return {
        activity: createActivity(context, "compaction", "Compaction started", occurredAt, false),
        patch: {
          currentActivity: "Compaction started",
        },
      };

    case "compaction_end":
      return {
        activity: createActivity(context, "compaction", "Compaction finished", occurredAt, false),
        patch: {
          currentActivity: "Compaction finished",
        },
      };

    case "auto_retry_start":
      return {
        activity: createActivity(context, "retrying", "Retrying after provider/runtime error", occurredAt, true),
        patch: {
          status: "running",
          currentActivity: "Retrying after provider/runtime error",
        },
      };

    case "auto_retry_end":
      return normalizeAutoRetryEnd(context, event, occurredAt);

    default:
      return {};
  }
}

export function deriveStatusFromActivityType(type: NormalizedSessionActivityType): WorkspaceSessionStatus | undefined {
  switch (type) {
    case "agent-started":
    case "message-streaming":
    case "tool-running":
    case "retrying":
      return "running";
    case "awaiting-input":
      return "awaiting-input";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    case "idle":
    case "tool-finished":
      return "idle";
    case "assistant-update":
    case "compaction":
      return undefined;
  }
}

export function isMeaningfulObservedActivity(activity: Pick<NormalizedSessionActivity, "type" | "source" | "meaningful">): boolean {
  return activity.source !== "operator" && activity.meaningful !== false && activity.type !== "idle";
}

export function findObservedHistoryTimestamp(
  requestedAt: string,
  entries: readonly PiSessionHistoryEntry[],
): string | undefined {
  const requestedAtMs = Date.parse(requestedAt);
  if (Number.isNaN(requestedAtMs)) {
    return undefined;
  }

  for (const entry of entries) {
    if (!isMeaningfulHistoryEntry(entry)) {
      continue;
    }

    const timestamp = getHistoryEntryTimestamp(entry);
    if (timestamp === undefined) {
      continue;
    }

    const timestampMs = Date.parse(timestamp);
    if (!Number.isNaN(timestampMs) && timestampMs > requestedAtMs) {
      return timestamp;
    }
  }

  return undefined;
}

export function extractRecentFilesFromHistory(
  entries: readonly PiSessionHistoryEntry[],
  limit: number = 10,
): SessionRecentFile[] {
  const files: SessionRecentFile[] = [];

  for (const entry of entries) {
    const timestamp = getHistoryEntryTimestamp(entry);
    const message = readObject(entry.message);
    const role = readString(message?.role);

    if (role === "bashExecution") {
      const command = readString(message?.command);
      const output = readString(message?.output);
      const filePath = extractPathFromText([command, output].filter(Boolean).join("\n"));
      if (filePath !== undefined) {
        files.unshift({ path: filePath, operation: "unknown", timestamp });
      }
      continue;
    }

    const serialized = stringifyUnknown(message ?? entry);
    const filePath = extractPathFromText(serialized);
    if (filePath !== undefined) {
      files.unshift({ path: filePath, operation: "unknown", timestamp });
    }
  }

  return dedupeRecentFiles(files).slice(0, limit);
}

function normalizeMessageUpdate(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  const assistantMessageEvent = readObject(eventObject?.assistantMessageEvent);
  if (readString(assistantMessageEvent?.type) !== "text_delta") {
    return {};
  }

  const delta = compactWhitespace(readString(assistantMessageEvent?.delta) ?? "");
  if (delta.length === 0) {
    return {};
  }

  const summary = `Assistant: ${clip(delta)}`;
  return {
    activity: createActivity(context, "message-streaming", summary, occurredAt, false),
    patch: {
      status: "running",
      liveSummary: summary,
      currentActivity: summary,
    },
  };
}

function normalizeMessageEnd(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  const text = assistantTextFromMessage(eventObject?.message);
  if (text.length === 0) {
    return {};
  }

  const clipped = clip(text);
  if (looksLikeAwaitingUser(text)) {
    const summary = `Awaiting input: ${clipped}`;
    return {
      activity: createActivity(context, "awaiting-input", summary, occurredAt, true),
      patch: {
        status: "awaiting-input",
        liveSummary: clipped,
        latestMeaningfulUpdate: clipped,
        currentActivity: summary,
      },
    };
  }

  if (looksLikeBlocked(text)) {
    const summary = `Blocked: ${clipped}`;
    return {
      activity: createActivity(context, "blocked", summary, occurredAt, true),
      patch: {
        status: "blocked",
        liveSummary: clipped,
        latestMeaningfulUpdate: clipped,
        currentActivity: summary,
      },
    };
  }

  if (looksLikeCompleted(text)) {
    const summary = `Completed: ${clipped}`;
    return {
      activity: createActivity(context, "completed", summary, occurredAt, true),
      patch: {
        status: "done",
        liveSummary: clipped,
        latestMeaningfulUpdate: clipped,
        currentActivity: summary,
        currentTool: undefined,
        completedAt: occurredAt,
      },
    };
  }

  return {
    activity: createActivity(context, "assistant-update", clipped, occurredAt, true),
    patch: {
      liveSummary: clipped,
      latestMeaningfulUpdate: clipped,
      currentActivity: clipped,
    },
  };
}

function normalizeToolExecutionStart(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  const toolName = readString(eventObject?.toolName) ?? "tool";
  const targetPath = extractTargetPath(toolName, eventObject?.args);
  const summary = targetPath === undefined ? `Running ${toolName}` : `Running ${toolName} on ${targetPath}`;
  const recentFile = targetPath === undefined ? undefined : createRecentFile(toolName, targetPath, occurredAt);

  return {
    activity: createActivity(context, "tool-running", summary, occurredAt, true),
    patch: {
      status: "running",
      currentTool: toolName,
      liveSummary: summary,
      currentActivity: summary,
      latestMeaningfulUpdate: summary,
    },
    recentFiles: recentFile === undefined ? undefined : [recentFile],
  };
}

function normalizeToolExecutionUpdate(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  const toolName = readString(eventObject?.toolName) ?? "tool";
  const summary = `Running ${toolName}`;

  return {
    activity: createActivity(context, "tool-running", summary, occurredAt, false),
    patch: {
      status: "running",
      currentTool: toolName,
      liveSummary: summary,
      currentActivity: summary,
    },
  };
}

function normalizeToolExecutionEnd(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  const toolName = readString(eventObject?.toolName) ?? "tool";
  const targetPath = extractTargetPath(toolName, eventObject?.result);
  const isError = eventObject?.isError === true;

  if (isError) {
    const summary = `Tool failed: ${toolName}`;
    return {
      activity: createActivity(context, "blocked", summary, occurredAt, true),
      patch: {
        status: "blocked",
        currentTool: undefined,
        liveSummary: summary,
        latestMeaningfulUpdate: stringifyResult(eventObject?.result),
        currentActivity: summary,
      },
    };
  }

  const summary = targetPath === undefined ? `Finished ${toolName}` : `Finished ${toolName} on ${targetPath}`;
  const recentFile = targetPath === undefined ? undefined : createRecentFile(toolName, targetPath, occurredAt);
  return {
    activity: createActivity(context, "tool-finished", summary, occurredAt, true),
    patch: {
      status: "idle",
      currentTool: undefined,
      liveSummary: summary,
      latestMeaningfulUpdate: summary,
      currentActivity: summary,
    },
    recentFiles: recentFile === undefined ? undefined : [recentFile],
  };
}

function normalizeAutoRetryEnd(
  context: NormalizeSessionEventContext,
  event: unknown,
  occurredAt: string,
): NormalizedSessionEvent {
  const eventObject = readObject(event);
  if (eventObject?.success === false) {
    const finalError = readString(eventObject.finalError) ?? "Auto retry failed";
    return {
      activity: createActivity(context, "failed", finalError, occurredAt, true),
      patch: {
        status: "failed",
        liveSummary: finalError,
        latestMeaningfulUpdate: finalError,
        currentActivity: finalError,
      },
    };
  }

  return {
    activity: createActivity(context, "tool-finished", "Retry completed", occurredAt, true),
    patch: {
      status: "running",
      currentActivity: "Retry completed",
    },
  };
}

function createActivity(
  context: NormalizeSessionEventContext,
  type: NormalizedSessionActivityType,
  summary: string,
  occurredAt: string,
  meaningful: boolean,
): NormalizedSessionActivity {
  return {
    id: `${context.workspaceId}:${context.sessionId}:${type}:${occurredAt}`,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    type,
    summary,
    occurredAt,
    source: "runtime",
    meaningful,
  };
}

function createRecentFile(toolName: string, targetPath: string, timestamp: string): SessionRecentFile | undefined {
  switch (toolName) {
    case "edit":
      return { path: targetPath, operation: "edited", timestamp };
    case "write":
      return { path: targetPath, operation: "created", timestamp };
    case "delete":
    case "rm":
      return { path: targetPath, operation: "deleted", timestamp };
    default:
      return { path: targetPath, operation: "unknown", timestamp };
  }
}

function extractTargetPath(toolName: string, source: unknown): string | undefined {
  const sourceObject = readObject(source);
  if (sourceObject === undefined) {
    return undefined;
  }

  const directPath = readString(sourceObject.path) ?? readString(sourceObject.filePath) ?? readString(sourceObject.targetPath);
  if (directPath !== undefined && directPath.length > 0) {
    return directPath;
  }

  if (toolName === "bash") {
    const output = readString(sourceObject.output) ?? readString(sourceObject.command);
    return output === undefined ? undefined : extractPathFromText(output);
  }

  return undefined;
}

function assistantTextFromMessage(message: unknown): string {
  const messageObject = readObject(message);
  if (messageObject === undefined || messageObject.role !== "assistant") {
    return "";
  }

  const content = messageObject.content;
  if (typeof content === "string") {
    return compactWhitespace(content);
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return compactWhitespace(
    content
      .map((item: unknown): string => {
        const itemObject = readObject(item);
        if (itemObject?.type === "text") {
          return readString(itemObject.text) ?? "";
        }
        return "";
      })
      .join(" "),
  );
}

function looksLikeAwaitingUser(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.includes("?")
    || lower.includes("let me know")
    || lower.includes("what would you like")
    || lower.includes("which option")
    || lower.includes("please confirm")
    || lower.includes("please provide")
    || lower.includes("i need your input")
    || lower.includes("tell me which")
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
  if (looksLikeAwaitingUser(text) || looksLikeBlocked(text)) {
    return false;
  }

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

function isMeaningfulHistoryEntry(entry: PiSessionHistoryEntry): boolean {
  if (entry.type !== "message") {
    return false;
  }

  const message = readObject(entry.message);
  const role = readString(message?.role);
  return role === "assistant" || role === "toolResult" || role === "bashExecution";
}

function getHistoryEntryTimestamp(entry: PiSessionHistoryEntry): string | undefined {
  const message = readObject(entry.message);
  const messageTimestamp = message?.timestamp;
  if (typeof messageTimestamp === "number") {
    return new Date(messageTimestamp).toISOString();
  }
  if (typeof messageTimestamp === "string" && !Number.isNaN(Date.parse(messageTimestamp))) {
    return new Date(messageTimestamp).toISOString();
  }

  const entryTimestamp = entry.timestamp;
  if (typeof entryTimestamp === "string" && !Number.isNaN(Date.parse(entryTimestamp))) {
    return new Date(entryTimestamp).toISOString();
  }

  return undefined;
}

function dedupeRecentFiles(files: readonly SessionRecentFile[]): SessionRecentFile[] {
  const seenPaths = new Set<string>();
  const dedupedFiles: SessionRecentFile[] = [];

  for (const file of files) {
    if (seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    dedupedFiles.push(file);
  }

  return dedupedFiles;
}

function readEventType(event: unknown): string | undefined {
  return readString(readObject(event)?.type);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clip(text: string, limit: number = 160): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractPathFromText(text: string): string | undefined {
  const match = text.match(/(?:[A-Za-z]:)?(?:[\w.-]+\/)+[\w.@-]+\.[A-Za-z0-9]+|[\w.@-]+\.[A-Za-z0-9]+/);
  return match?.[0];
}
