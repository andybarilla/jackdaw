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
export function getProjectName(path: string): string {
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
