import type { Session } from '$lib/types';

type GroupItem = { type: 'group'; key: string; cwd: string; sessions: Session[] };
type SessionItem = { type: 'session'; key: string; session: Session };
export type RenderItem = GroupItem | SessionItem;

/** Group sessions by cwd for sidebar rendering. Groups only formed for 2+ sessions sharing a cwd. */
export function buildRenderList(sessions: Session[]): RenderItem[] {
  const sessionIds = new Set(sessions.map(s => s.session_id));

  // Separate children (those with a parent that exists in the current session list)
  const children = new Set<string>();
  for (const s of sessions) {
    if (s.parent_session_id && sessionIds.has(s.parent_session_id)) {
      children.add(s.session_id);
    }
  }

  // Only group top-level sessions (non-children)
  const topLevel = sessions.filter(s => !children.has(s.session_id));

  const byCwd = new Map<string, Session[]>();
  for (const s of topLevel) {
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
