import type { WorkbenchActivity, WorkbenchDetailViewMode, WorkbenchSession } from "../types/workbench.js";
import { stripTerminalControlSequences } from "../utils/plain-text.js";

export function renderSessionDetailLines(
  session: WorkbenchSession | undefined,
  activities: WorkbenchActivity[],
  transcriptLines: string[] = [],
  viewMode: WorkbenchDetailViewMode = "summary",
  transcriptOffset = 0,
  transcriptWindow = 18,
  contentWidth = 84,
): string[] {
  if (!session) {
    return [
      "No session selected.",
      "",
      "Choose a session in the left column.",
      "Press n to start a tracked session.",
      "Use ↑/↓ or j/k to change selection.",
    ];
  }

  const recent = activities
    .slice(-4)
    .reverse()
    .map((activity) => `- ${compact(activity.summary, 84)}`);

  const lines = [
    `${session.status.toUpperCase()}${session.currentTool ? ` · ${session.currentTool}` : ""}`,
    "",
    `Name: ${compact(session.name, 88)}`,
    `Task: ${compact(session.taskLabel, 88)}`,
    `Live summary: ${compact(session.summary, 88)}`,
  ];

  if (session.pinnedSummary) {
    lines.push(`Pinned summary: ${compact(session.pinnedSummary, 88)}`);
  }

  if (session.latestText && session.latestText !== session.summary) {
    lines.push(`Latest: ${compact(session.latestText, 88)}`);
  }

  if (session.lastError && (session.status === "blocked" || session.status === "failed")) {
    lines.push(`Error: ${compact(session.lastError, 88)}`);
  }

  lines.push(`Model: ${session.model}`);
  lines.push(`Path: ${compact(session.cwd, 88)}`);

  if (session.connectionState === "historical") {
    lines.push("Connection: historical");
    lines.push("Shell: reconnect first");
    if (session.reconnectNote) {
      lines.push(`Reconnect: ${compact(session.reconnectNote, 88)}`);
    }
  }

  if (session.tags.length > 0) {
    lines.push(`Tags: ${session.tags.join(", ")}`);
  }

  if (session.recentFiles && session.recentFiles.length > 0) {
    lines.push(`Files: ${compact(session.recentFiles.join(", "), 88)}`);
  }

  if (session.lastShellCommand) {
    lines.push(`Shell: ${compact(session.lastShellCommand, 88)}`);
    lines.push(`Shell result: ${formatShellResult(session.lastShellExitCode)}`);
    if (session.lastShellOutput) {
      lines.push(`Shell output: ${compact(shellPreview(session.lastShellOutput), 88)}`);
    }
  }

  lines.push("");

  if (viewMode === "transcript" || viewMode === "log") {
    const wrapped = transcriptLines.flatMap((line) => wrapPrefixedLine("- ", line, contentWidth));
    const total = wrapped.length;
    const maxOffset = Math.max(0, total - transcriptWindow);
    const safeOffset = Math.max(0, Math.min(transcriptOffset, maxOffset));
    const visible = wrapped.slice(safeOffset, safeOffset + transcriptWindow);
    const label = viewMode === "transcript" ? "Transcript" : "Log";
    const above = safeOffset > 0 ? "↑ more above" : "↑ top";
    const below = safeOffset + visible.length < total ? "↓ more below" : "↓ end";
    lines.push(`${label} (${total} lines, showing ${safeOffset + 1}-${safeOffset + visible.length}${total > transcriptWindow ? ` • ${above} • ${below}` : " • no scrolling needed"})`);
    lines.push(...(visible.length > 0 ? visible : [`- No ${viewMode} yet`]));
    return lines;
  }

  lines.push("Recent activity:");
  lines.push(...(recent.length > 0 ? recent : ["- No recent activity"]));

  if (transcriptLines.length > 0) {
    lines.push("");
    lines.push("Transcript preview:");
    lines.push(...transcriptLines.slice(-4).flatMap((line) => wrapPrefixedLine("- ", line, contentWidth)).slice(-8));
  }

  return lines;
}

function wrapPrefixedLine(prefix: string, text: string, width: number): string[] {
  const available = Math.max(20, width - prefix.length);
  const normalized = stripTerminalControlSequences(text).replace(/\s+/g, " ").trim();
  if (!normalized) return [prefix.trimEnd()];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= available) {
      current = candidate;
      continue;
    }
    if (current) lines.push(`${prefix}${current}`);
    current = word;
  }

  if (current) lines.push(`${prefix}${current}`);
  return lines;
}

function compact(text: string, max = 72): string {
  const normalized = stripTerminalControlSequences(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function formatShellResult(exitCode: number | undefined): string {
  if (exitCode === 0) return "exit 0";
  if (exitCode === undefined) return "no exit code recorded";
  return `exit ${exitCode}`;
}

function shellPreview(output: string): string {
  return stripTerminalControlSequences(output).replace(/\s+/g, " ").trim();
}
