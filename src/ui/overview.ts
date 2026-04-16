import type { WorkbenchSession, WorkbenchStatus } from "../types/workbench.js";

const OVERVIEW_STATUS_BADGES: Readonly<Record<WorkbenchStatus, string>> = {
  "awaiting-input": "◉ needs input",
  blocked: "◆ needs attention",
  failed: "✖ needs attention",
  running: "● running",
  idle: "○ idle",
  done: "✓ done",
};

export function renderOverviewLines(sessions: WorkbenchSession[], selectedSessionId?: string): string[] {
  if (sessions.length === 0) {
    return ["No sessions yet.", "Press n to start a tracked session."];
  }

  return sessions.map((session) => {
    const selected = session.id === selectedSessionId ? ">" : " ";
    const badge = formatStatusBadge(session.status);
    const reason = summarizeAttentionReason(session);
    const files = summarizeRecentFiles(session);
    const connection = session.connectionState === "historical" ? "historical" : undefined;
    return `${selected} ${badge} ${session.name} · ${reason}${files ? ` · ${files}` : ""}${connection ? ` · ${connection}` : ""}`;
  });
}

function formatStatusBadge(status: WorkbenchStatus): string {
  return OVERVIEW_STATUS_BADGES[status];
}

function summarizeAttentionReason(session: WorkbenchSession): string {
  const preferredSummary = session.pinnedSummary ?? session.summary;

  if (session.status === "awaiting-input") {
    const attentionText = session.latestText ?? session.summary ?? session.pinnedSummary ?? "asked a question";
    return compact(attentionText);
  }
  if (session.status === "blocked") {
    const attentionText = session.lastError ?? session.summary ?? session.pinnedSummary ?? "tool failed";
    return compact(attentionText);
  }
  if (session.status === "failed") {
    const attentionText = session.lastError ?? session.summary ?? session.pinnedSummary ?? "session failed";
    return compact(attentionText);
  }
  if (session.status === "running") {
    return compact(preferredSummary || (session.currentTool ? `running ${session.currentTool}` : "working"));
  }
  if (session.status === "done") {
    const completionContext = `finished ${relativeTime(session.lastUpdateAt)}`;
    return preferredSummary ? `${compact(preferredSummary)} · ${completionContext}` : completionContext;
  }
  return compact(preferredSummary || `updated ${relativeTime(session.lastUpdateAt)}`);
}

function summarizeRecentFiles(session: WorkbenchSession): string | undefined {
  if (!session.recentFiles || session.recentFiles.length === 0) return undefined;

  const [first, ...rest] = session.recentFiles;
  if (!first) return undefined;
  if (rest.length === 0) return `file ${compactPath(first)}`;
  return `files ${compactPath(first)} +${rest.length}`;
}

function compact(text: string, max = 44): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function compactPath(path: string, max = 26): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return compact(path, max);
  return compact(`…/${parts.slice(-2).join("/")}`, max);
}

function relativeTime(timestamp: number): string {
  const deltaMs = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
