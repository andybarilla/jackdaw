import type { ToolEvent } from './types';

/** Format a started_at timestamp as relative uptime like "5m ago" or "1h 30m ago" */
export function getUptime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

/** Extract last directory segment from a path (handles both Unix and Windows separators) */
export function getProjectName(path: string, displayName?: string | null): string {
  if (displayName) return displayName;
  const trimmed = path.replace(/[/\\]+$/, '');
  if (!trimmed) return '/';
  return trimmed.split(/[/\\]/).pop()!;
}

/** Replace /home/<user>/ prefix with ~ */
export function shortenPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, '~');
}

/** Truncate session ID to 8 characters */
export function shortenSessionId(id: string): string {
  return id.length > 8 ? id.substring(0, 8) : id;
}

/** Format an ended_at timestamp as a relative time like "just now", "3h ago", "2d ago", or a date */
export function formatEndedAt(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString();
}

/** Format an ISO timestamp as a relative time: "just now", "5m ago", "3h ago", "2d ago" */
export function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export type SessionState = 'approval' | 'input' | 'running';

/** Derive the visual state of an active session */
export function getSessionState(session: { pending_approval: boolean; current_tool: unknown | null; active_subagents: number; processing: boolean }): SessionState {
  if (session.pending_approval) return 'approval';
  if (session.current_tool !== null || session.active_subagents > 0 || session.processing) return 'running';
  return 'input';
}

/** Compute tool count and recent rate (tools/min over last 5 minutes) */
export function computeToolVelocity(
  toolHistory: ToolEvent[],
  currentTool: ToolEvent | null,
  startedAt: string
): { total: number; rate: number } {
  const total = toolHistory.length + (currentTool ? 1 : 0);
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const recentCount = toolHistory.filter(
    (t) => new Date(t.timestamp).getTime() > fiveMinAgo
  ).length;
  const startTime = new Date(startedAt).getTime();
  const windowMinutes =
    startTime > fiveMinAgo ? (now - startTime) / 60000 : 5;
  const rate =
    windowMinutes > 0
      ? Math.round((recentCount / windowMinutes) * 10) / 10
      : 0;
  return { total, rate };
}
