import { deriveStatus } from "./status.js";
import type { WorkbenchActivity, WorkbenchPreferences, WorkbenchSession, WorkbenchState, WorkbenchStatus } from "../types/workbench.js";

const STATUS_BAND_ORDER: ReadonlyArray<WorkbenchStatus> = ["awaiting-input", "blocked", "failed", "running", "idle", "done"];

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
      sessions: [...state.sessions],
      selectedSessionId: state.selectedSessionId,
      lastOpenedAt: state.lastOpenedAt,
      preferences: state.preferences,
    };
  }

  getState(): WorkbenchState {
    return {
      ...this.state,
      preferences: { ...this.state.preferences },
      sessions: [...this.state.sessions],
    };
  }

  listSessions(): WorkbenchSession[] {
    return [...this.state.sessions];
  }

  upsertSession(session: WorkbenchSession): void {
    const index = this.state.sessions.findIndex((item) => item.id === session.id);
    if (index === -1) {
      this.insertSessionAtBandTop(session);
    } else {
      this.replaceSession(index, session);
    }

    if (!this.state.selectedSessionId) {
      this.state.selectedSessionId = session.id;
    }
  }

  patchSession(sessionId: string, patch: Partial<WorkbenchSession>): void {
    const index = this.state.sessions.findIndex((item) => item.id === sessionId);
    if (index === -1) return;

    const session = this.state.sessions[index]!;
    const previousBand = getStatusBand(session.status);
    const nextSession: WorkbenchSession = { ...session, ...patch };
    this.replaceSession(index, nextSession, previousBand);
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

    const index = this.state.sessions.findIndex((item) => item.id === activity.sessionId);
    if (index === -1) return;

    const session = this.state.sessions[index]!;
    const nextSession: WorkbenchSession = {
      ...session,
      status: deriveStatus(activity),
      lastUpdateAt: activity.timestamp,
      summary: activity.summary,
    };
    this.replaceSession(index, nextSession, getStatusBand(session.status));
  }

  getActivities(sessionId: string): WorkbenchActivity[] {
    return [...(this.activities.get(sessionId) ?? [])];
  }

  private replaceSession(index: number, session: WorkbenchSession, previousBand = getStatusBand(this.state.sessions[index]!.status)): void {
    const nextBand = getStatusBand(session.status);
    if (previousBand === nextBand) {
      this.state.sessions[index] = session;
      return;
    }

    this.state.sessions.splice(index, 1);
    this.insertSessionAtBandTop(session);
  }

  private insertSessionAtBandTop(session: WorkbenchSession): void {
    const insertionIndex = findBandTopInsertionIndex(this.state.sessions, getStatusBand(session.status));
    this.state.sessions.splice(insertionIndex, 0, session);
  }
}

function getStatusBand(status: WorkbenchStatus): number {
  return STATUS_BAND_ORDER.indexOf(status);
}

function findBandTopInsertionIndex(sessions: WorkbenchSession[], targetBand: number): number {
  const index = sessions.findIndex((session) => getStatusBand(session.status) >= targetBand);
  return index === -1 ? sessions.length : index;
}
