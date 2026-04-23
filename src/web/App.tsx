import React from "react";
import type { HealthResponse, RendererBootstrap } from "../shared/transport/api.js";
import type { WorkspaceSummaryDto, WorkspaceDetailDto } from "../shared/transport/dto.js";
import type { WorkspaceSession } from "../shared/domain/session.js";

declare global {
  interface Window {
    jackdaw?: {
      bootstrap: RendererBootstrap;
    };
  }
}

type Loadable<TData> =
  | { status: "loading" }
  | { status: "ready"; data: TData }
  | { status: "error"; message: string };

const bootstrap = window.jackdaw?.bootstrap ?? {
  serviceBaseUrl: "http://127.0.0.1:7345",
  appDataDir: "",
  platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux",
};

function getResponseErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  return response
    .json()
    .then((body: unknown) => {
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
        return body.error;
      }

      return `${fallbackMessage} (${response.status})`;
    })
    .catch(() => `${fallbackMessage} (${response.status})`);
}

async function fetchJson<TData>(path: string, fallbackMessage: string): Promise<TData> {
  const response = await fetch(`${bootstrap.serviceBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response, fallbackMessage));
  }

  return (await response.json()) as TData;
}

function sessionSummaryForRail(session: WorkspaceSession): string {
  return session.pinnedSummary ?? session.liveSummary;
}

function sessionContext(session: WorkspaceSession): string {
  return session.branch ? `${session.repoRoot} · ${session.branch}` : session.repoRoot;
}

function findSelectedWorkspaceSummary(
  summariesState: Loadable<WorkspaceSummaryDto[]>,
  selectedWorkspaceId: string | undefined,
): WorkspaceSummaryDto | undefined {
  if (summariesState.status !== "ready" || selectedWorkspaceId === undefined) {
    return undefined;
  }

  return summariesState.data.find((summary) => summary.id === selectedWorkspaceId);
}

function findSelectedSession(
  detailState: Loadable<WorkspaceDetailDto>,
  selectedSessionId: string | undefined,
): WorkspaceSession | undefined {
  if (detailState.status !== "ready" || selectedSessionId === undefined) {
    return undefined;
  }

  return detailState.data.sessions.find((session) => session.id === selectedSessionId);
}

export function App(): React.JSX.Element {
  const [health, setHealth] = React.useState<Loadable<HealthResponse>>({ status: "loading" });
  const [workspaceSummaries, setWorkspaceSummaries] = React.useState<Loadable<WorkspaceSummaryDto[]>>({ status: "loading" });
  const [workspaceDetail, setWorkspaceDetail] = React.useState<Loadable<WorkspaceDetailDto>>({ status: "loading" });
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | undefined>(undefined);
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const data = await fetchJson<HealthResponse>("/health", "Health check failed");
        if (!cancelled) {
          setHealth({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    void (async (): Promise<void> => {
      try {
        const data = await fetchJson<WorkspaceSummaryDto[]>("/workspaces", "Workspace fetch failed");
        if (!cancelled) {
          setWorkspaceSummaries({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceSummaries({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (workspaceSummaries.status !== "ready") {
      return;
    }

    setSelectedWorkspaceId(workspaceSummaries.data[0]?.id);
    if (workspaceSummaries.data.length === 0) {
      setSelectedSessionId(undefined);
    }
  }, [workspaceSummaries]);

  React.useEffect(() => {
    if (selectedWorkspaceId === undefined) {
      if (workspaceSummaries.status === "ready" && workspaceSummaries.data.length === 0) {
        setSelectedSessionId(undefined);
      }
      return;
    }

    let cancelled = false;
    setWorkspaceDetail({ status: "loading" });

    void (async (): Promise<void> => {
      try {
        const data = await fetchJson<WorkspaceDetailDto>(
          `/workspaces/${selectedWorkspaceId}`,
          "Workspace detail fetch failed",
        );

        if (cancelled) {
          return;
        }

        setWorkspaceDetail({ status: "ready", data });
        setSelectedSessionId((currentSelectedSessionId: string | undefined) => {
          const hasCurrentSelection = data.sessions.some((session) => session.id === currentSelectedSessionId);
          if (hasCurrentSelection) {
            return currentSelectedSessionId;
          }

          const preferredSelectedSessionId = data.workspace.preferences.selectedSessionId;
          const hasPreferredSelection = data.sessions.some((session) => session.id === preferredSelectedSessionId);
          if (hasPreferredSelection) {
            return preferredSelectedSessionId;
          }

          return data.sessions[0]?.id;
        });
      } catch (error) {
        if (!cancelled) {
          setWorkspaceDetail({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          setSelectedSessionId(undefined);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId, workspaceSummaries.status]);

  const selectedWorkspaceSummary = findSelectedWorkspaceSummary(workspaceSummaries, selectedWorkspaceId);
  const selectedSession = findSelectedSession(workspaceDetail, selectedSessionId);
  const workspaceSessions = workspaceDetail.status === "ready" ? workspaceDetail.data.sessions : [];
  const workspaceErrorMessage = workspaceSummaries.status === "error"
    ? workspaceSummaries.message
    : workspaceDetail.status === "error"
      ? workspaceDetail.message
      : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Jackdaw</p>
          <h1>Operator Workbench</h1>
          {selectedWorkspaceSummary !== undefined && <p className="workspace-title">{selectedWorkspaceSummary.name}</p>}
        </div>
        <div className="topbar-meta">
          <span>{bootstrap.platform}</span>
          <span>{bootstrap.serviceBaseUrl}</span>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel" aria-label="Service health panel">
          <div className="panel-header">
            <p className="eyebrow">Service health</p>
            <span className={`status-pill status-${health.status}`}>{health.status}</span>
          </div>
          <div className="health-card">
            {health.status === "loading" && <p>Checking local orchestration service…</p>}
            {health.status === "error" && <p>Service unavailable: {health.message}</p>}
            {health.status === "ready" && (
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{health.data.ok ? "Healthy" : "Unhealthy"}</dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>{health.data.service}</dd>
                </div>
                <div>
                  <dt>App data</dt>
                  <dd>{health.data.appDataDir}</dd>
                </div>
                <div>
                  <dt>Checked at</dt>
                  <dd>{new Date(health.data.timestamp).toLocaleString()}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <section className="panel" aria-label="Workspace summary panel">
          <div className="panel-header">
            <p className="eyebrow">Workspace</p>
          </div>
          {workspaceSummaries.status === "loading" && <p>Loading workspace…</p>}
          {workspaceErrorMessage !== undefined && (
            <div className="error-card" role="alert">
              <p className="error-title">Workspace unavailable</p>
              <p>{workspaceErrorMessage}</p>
            </div>
          )}
          {workspaceSummaries.status === "ready" && selectedWorkspaceSummary !== undefined && workspaceErrorMessage === undefined && (
            <div className="workspace-summary">
              <h2>{selectedWorkspaceSummary.name}</h2>
              {selectedWorkspaceSummary.description !== undefined && <p>{selectedWorkspaceSummary.description}</p>}
              <dl className="workspace-stats">
                <div>
                  <dt>Repo roots</dt>
                  <dd>{selectedWorkspaceSummary.repoRootCount}</dd>
                </div>
                <div>
                  <dt>Worktrees</dt>
                  <dd>{selectedWorkspaceSummary.worktreeCount}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{selectedWorkspaceSummary.sessionCount}</dd>
                </div>
                <div>
                  <dt>Attention</dt>
                  <dd>{selectedWorkspaceSummary.attentionBand}</dd>
                </div>
              </dl>
            </div>
          )}
          {workspaceSummaries.status === "ready" && workspaceSummaries.data.length === 0 && workspaceErrorMessage === undefined && (
            <p>No workspaces available.</p>
          )}
        </section>

        <section className="panel attention-panel" aria-label="Attention rail panel">
          <div className="panel-header">
            <p className="eyebrow">Attention rail</p>
            <span className="muted">{workspaceDetail.status === "ready" ? `${workspaceSessions.length} sessions` : "loading"}</span>
          </div>
          {workspaceSummaries.status === "loading" && <p>Loading workspace sessions…</p>}
          {workspaceDetail.status === "loading" && workspaceSummaries.status === "ready" && workspaceSummaries.data.length > 0 && (
            <p>Loading workspace sessions…</p>
          )}
          {workspaceDetail.status === "ready" && (
            workspaceSessions.length > 0 ? (
              <ul className="session-list" aria-label="Attention rail">
                {workspaceSessions.map((session) => {
                  const isSelected = session.id === selectedSessionId;

                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        className={`session-card session-row${isSelected ? " selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={(): void => setSelectedSessionId(session.id)}
                      >
                        <div className="session-card-header">
                          <strong>{session.name}</strong>
                          <span className={`status-pill status-${session.status}`}>{session.status}</span>
                        </div>
                        <p>{sessionSummaryForRail(session)}</p>
                        <small>{sessionContext(session)}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No sessions in this workspace yet.</p>
            )
          )}
        </section>

        <section className="panel session-detail-panel" aria-label="Selected session detail panel">
          <div className="panel-header">
            <p className="eyebrow">Selected session</p>
            {selectedSession !== undefined && <span className={`status-pill status-${selectedSession.status}`}>{selectedSession.status}</span>}
          </div>
          {workspaceSummaries.status === "loading" && <p>Loading session detail…</p>}
          {workspaceDetail.status === "loading" && workspaceSummaries.status === "ready" && workspaceSummaries.data.length > 0 && (
            <p>Loading session detail…</p>
          )}
          {workspaceDetail.status === "ready" && workspaceSessions.length === 0 && <p>No sessions in this workspace yet.</p>}
          {selectedSession !== undefined && (
            <div className="session-detail">
              <h2>{selectedSession.name}</h2>
              <dl className="session-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{selectedSession.status}</dd>
                </div>
                {selectedSession.liveSummary.length > 0 && (
                  <div>
                    <dt>Live summary</dt>
                    <dd>{selectedSession.liveSummary}</dd>
                  </div>
                )}
                {selectedSession.pinnedSummary !== undefined && (
                  <div>
                    <dt>Pinned summary</dt>
                    <dd>{selectedSession.pinnedSummary}</dd>
                  </div>
                )}
                <div>
                  <dt>Repo root</dt>
                  <dd>{selectedSession.repoRoot}</dd>
                </div>
                <div>
                  <dt>Working directory</dt>
                  <dd>{selectedSession.cwd}</dd>
                </div>
                {selectedSession.branch !== undefined && (
                  <div>
                    <dt>Branch</dt>
                    <dd>{selectedSession.branch}</dd>
                  </div>
                )}
                {selectedSession.currentActivity !== undefined && (
                  <div>
                    <dt>Current activity</dt>
                    <dd>{selectedSession.currentActivity}</dd>
                  </div>
                )}
                {selectedSession.currentTool !== undefined && (
                  <div>
                    <dt>Current tool</dt>
                    <dd>{selectedSession.currentTool}</dd>
                  </div>
                )}
              </dl>

              <div className="detail-section">
                <h3>Recent files</h3>
                {selectedSession.recentFiles.length > 0 ? (
                  <ul className="detail-list">
                    {selectedSession.recentFiles.map((file) => (
                      <li key={`${file.path}-${file.timestamp ?? ""}`}>{file.path}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No recent files.</p>
                )}
              </div>

              {selectedSession.lastIntervention !== undefined && (
                <div className="detail-section">
                  <h3>Last intervention</h3>
                  <dl className="session-facts compact">
                    <div>
                      <dt>Kind</dt>
                      <dd>{selectedSession.lastIntervention.kind}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{selectedSession.lastIntervention.status}</dd>
                    </div>
                    <div>
                      <dt>Text</dt>
                      <dd>{selectedSession.lastIntervention.text}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
