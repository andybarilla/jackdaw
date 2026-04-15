import { deriveStatus } from "./status.js";
import type { WorkbenchActivity, WorkbenchPreferences, WorkbenchSession, WorkbenchState } from "../types/workbench.js";

export class WorkbenchRegistry {
  private state: WorkbenchState;
  private activities = new Map<string, WorkbenchActivity[]>();

  constructor(initialState?: Partial<WorkbenchState>) {
    this.state = {
      sessions: [],
      selectedSessionId: initialState?.selectedSessionId,
      lastOpenedAt: initialState?.lastOpenedAt,
      preferences: initialState?.preferences ?? { detailViewMode: "summary" },
    };
  }

  hydrate(state: WorkbenchState): void {
    this.state = {
      sessions: [...state.sessions].sort(sortByRecentUpdate),
      selectedSessionId: state.selectedSessionId,
      lastOpenedAt: state.lastOpenedAt,
      preferences: state.preferences,
    };
  }

  getState(): WorkbenchState {
    return {
      ...this.state,
      preferences: { ...this.state.preferences },
      sessions: [...this.state.sessions].sort(sortByRecentUpdate),
    };
  }

  listSessions(): WorkbenchSession[] {
    return [...this.state.sessions].sort(sortByRecentUpdate);
  }

  upsertSession(session: WorkbenchSession): void {
    const index = this.state.sessions.findIndex((item) => item.id === session.id);
    if (index === -1) this.state.sessions.push(session);
    else this.state.sessions[index] = session;

    this.state.sessions.sort(sortByRecentUpdate);

    if (!this.state.selectedSessionId) {
      this.state.selectedSessionId = session.id;
    }
  }

  patchSession(sessionId: string, patch: Partial<WorkbenchSession>): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    Object.assign(session, patch);
    this.state.sessions.sort(sortByRecentUpdate);
  }

  selectSession(sessionId: string): void {
    this.state.selectedSessionId = sessionId;
    this.touchOpenedAt();
  }

  selectNextSession(direction: 1 | -1): void {
    const sessions = this.listSessions();
    if (sessions.length === 0) return;
    const index = sessions.findIndex((session) => session.id === this.state.selectedSessionId);
    const currentIndex = index === -1 ? 0 : index;
    const nextIndex = (currentIndex + direction + sessions.length) % sessions.length;
    this.selectSession(sessions[nextIndex]!.id);
  }

  getSelectedSession(): WorkbenchSession | undefined {
    return this.state.sessions.find((session) => session.id === this.state.selectedSessionId);
  }

  updatePreferences(patch: Partial<WorkbenchPreferences>): void {
    this.state.preferences = {
      ...this.state.preferences,
      ...patch,
    };
  }

  touchOpenedAt(): void {
    this.state.lastOpenedAt = Date.now();
  }

  addActivity(activity: WorkbenchActivity): void {
    const items = this.activities.get(activity.sessionId) ?? [];
    items.push(activity);
    this.activities.set(activity.sessionId, items.slice(-50));

    const session = this.state.sessions.find((item) => item.id === activity.sessionId);
    if (!session) return;

    session.status = deriveStatus(activity);
    session.lastUpdateAt = activity.timestamp;
    session.summary = activity.summary;
    this.state.sessions.sort(sortByRecentUpdate);
  }

  getActivities(sessionId: string): WorkbenchActivity[] {
    return [...(this.activities.get(sessionId) ?? [])];
  }
}

function sortByRecentUpdate(a: WorkbenchSession, b: WorkbenchSession): number {
  return b.lastUpdateAt - a.lastUpdateAt;
}
