import type { Session } from '$lib/types';

type GroupItem = { type: 'group'; key: string; cwd: string; sessions: Session[] };
type SessionItem = { type: 'session'; key: string; session: Session };
export type RenderItem = GroupItem | SessionItem;

/** Group sessions by cwd for sidebar rendering. Groups only formed for 2+ sessions sharing a cwd. */
export function buildRenderList(sessions: Session[]): RenderItem[] {
  const byCwd = new Map<string, Session[]>();
  for (const s of sessions) {
    const group = byCwd.get(s.cwd);
    if (group) {
      group.push(s);
    } else {
      byCwd.set(s.cwd, [s]);
    }
  }

  const items: RenderItem[] = [];
  for (const [cwd, group] of byCwd) {
    if (group.length >= 2) {
      items.push({ type: 'group', key: `group:${cwd}`, cwd, sessions: group });
    } else {
      items.push({ type: 'session', key: group[0].session_id, session: group[0] });
    }
  }

  // Sort by most recent started_at descending (groups use max of their sessions)
  items.sort((a, b) => {
    const aTime = a.type === 'group'
      ? Math.max(...a.sessions.map(s => new Date(s.started_at).getTime()))
      : new Date(a.session.started_at).getTime();
    const bTime = b.type === 'group'
      ? Math.max(...b.sessions.map(s => new Date(s.started_at).getTime()))
      : new Date(b.session.started_at).getTime();
    return bTime - aTime;
  });

  return items;
}
