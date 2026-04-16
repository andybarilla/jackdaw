import type { WorkbenchSession, WorkbenchStatus } from "../types/workbench.js";

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
  return {
    "awaiting-input": "◉ input",
    blocked: "◆ blocked",
    running: "● running",
    failed: "✖ failed",
    idle: "○ idle",
    done: "✓ done",
  }[status];
}

function summarizeAttentionReason(session: WorkbenchSession): string {
  const preferredSummary = session.pinnedSummary ?? session.summary;

  if (session.status === "awaiting-input") {
    return compact(preferredSummary || session.latestText || "asked a question");
  }
  if (session.status === "blocked") {
    return compact(preferredSummary || session.lastError || "tool failed");
  }
  if (session.status === "running") {
    return compact(preferredSummary || (session.currentTool ? `running ${session.currentTool}` : "working"));
  }
  if (session.status === "failed") {
    return compact(preferredSummary || session.lastError || "session failed");
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
